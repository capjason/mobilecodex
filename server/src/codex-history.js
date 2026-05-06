import { readFile } from 'node:fs/promises';

const defaultLimit = 300;
const maxPreviewLength = 1600;

export async function readCodexThreadMessages(threadPath, { limit = defaultLimit } = {}) {
  const raw = await readThreadFile(threadPath);
  if (!raw) return [];

  return parseCodexThreadMessages(raw, { limit });
}

export async function readCodexThreadMessagesSlice(threadPath, { offset = 0, limit = defaultLimit } = {}) {
  const raw = await readThreadFile(threadPath);
  if (!raw) return { events: [], hasMore: false, nextOffset: 0 };

  const all = parseCodexThreadMessages(raw, { limit: null });
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || defaultLimit));
  const end = Math.max(0, all.length - safeOffset);
  const start = Math.max(0, end - safeLimit);
  const events = all.slice(start, end);

  return {
    events,
    hasMore: start > 0,
    nextOffset: safeOffset + events.length
  };
}

export function parseCodexThreadMessages(raw, { limit = defaultLimit } = {}) {
  const messages = [];
  const pendingCalls = new Map();

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;

    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    for (const event of toChatEvents(row, pendingCalls)) {
      messages.push(event);
    }
  }

  if (typeof limit !== 'number' || !Number.isFinite(limit)) return messages;
  return messages.slice(-Math.max(0, limit));
}

async function readThreadFile(threadPath) {
  if (!threadPath) return '';
  try {
    return await readFile(threadPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function toChatEvents(row, pendingCalls) {
  const payload = row.payload || {};
  const at = row.timestamp;

  if (row.type === 'event_msg' && payload.type === 'user_message') {
    const content = cleanText(payload.message);
    return content ? [{ type: 'user', content, at }] : [];
  }

  if (row.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
    const content = cleanText(extractContentText(payload.content));
    return content ? [{ type: 'assistant_message', content, at }] : [];
  }

  if (row.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
    const started = buildStartedItem(payload);
    if (started.callId) pendingCalls.set(started.callId, started);
    return [{
      type: 'tool_started',
      toolType: started.toolType,
      item: started,
      at
    }];
  }

  if (row.type === 'event_msg' && isToolEndEvent(payload.type)) {
    const eventItem = buildEventCompletion(payload);
    if (eventItem.callId) {
      const pending = pendingCalls.get(eventItem.callId);
      if (pending) pending.event = eventItem;
    }

    const result = [];

    if (!eventItem.callId || !pendingCalls.has(eventItem.callId)) {
      result.push({
        type: 'tool_completed',
        toolType: eventItem.toolType,
        item: eventItem,
        at
      });
    }
    return result;
  }

  if (row.type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) {
    const callId = payload.call_id || '';
    const pending = callId ? pendingCalls.get(callId) : null;
    if (callId) pendingCalls.delete(callId);
    const completed = buildCompletedItem(payload, pending);

    const result = [{
      type: 'tool_completed',
      toolType: completed.toolType,
      item: completed,
      at
    }];

    const outputPreview = cleanText(extractOutputPreview(payload));
    const hasEventOutput = cleanText(pending?.event?.outputPreview || '');
    if (outputPreview && !hasEventOutput) {
      result.push({
        type: 'tool_output_delta',
        itemId: callId,
        content: outputPreview,
        at
      });
    }
    return result;
  }

  return [];
}

function buildStartedItem(payload) {
  const name = cleanText(payload.name || 'tool');
  const callId = payload.call_id || '';
  const args = payload.arguments || payload.input || '';
  const parsedArgs = parseJson(args);
  const command = parsedArgs?.cmd || parsedArgs?.command || '';
  const cwd = parsedArgs?.workdir || parsedArgs?.cwd || '';

  return {
    type: payload.type,
    toolType: normalizeToolType(name),
    name,
    callId,
    command,
    cwd,
    argsPreview: truncate(cleanText(typeof args === 'string' ? args : JSON.stringify(args)))
  };
}

function buildEventCompletion(payload) {
  const command = Array.isArray(payload.command)
    ? payload.command.join(' ')
    : payload.command || '';
  const durationMs = durationToMs(payload.duration);
  const outputPreview = pickBestOutputPreview(payload);

  return {
    type: payload.type,
    toolType: normalizeToolType(eventTypeToToolName(payload.type)),
    name: eventTypeToToolName(payload.type),
    callId: payload.call_id || '',
    status: cleanText(payload.status || ''),
    command: cleanText(command),
    exitCode: numberOrNull(payload.exit_code),
    success: payload.success === true ? true : payload.success === false ? false : null,
    durationMs,
    outputPreview: truncate(outputPreview)
  };
}

function buildCompletedItem(payload, pending) {
  const event = pending?.event;
  const outputPreview = truncate(event?.outputPreview || extractOutputPreview(payload));

  return {
    type: payload.type,
    toolType: pending?.toolType || event?.toolType || 'tool',
    name: pending?.name || event?.name || 'tool',
    callId: payload.call_id || pending?.callId || event?.callId || '',
    status: event?.status || 'completed',
    command: pending?.command || event?.command || '',
    cwd: pending?.cwd || '',
    exitCode: event?.exitCode ?? null,
    success: event?.success ?? null,
    durationMs: event?.durationMs ?? null,
    outputPreview
  };
}

function isToolEndEvent(type) {
  return type === 'exec_command_end' || type === 'patch_apply_end' || type === 'web_search_end';
}

function eventTypeToToolName(type) {
  if (type === 'exec_command_end') return 'exec_command';
  if (type === 'patch_apply_end') return 'apply_patch';
  if (type === 'web_search_end') return 'web_search';
  return 'tool';
}

function normalizeToolType(name) {
  return cleanText(name || '').toLowerCase() || 'tool';
}

function parseJson(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractOutputPreview(payload) {
  if (typeof payload.output === 'string') {
    const parsed = parseJson(payload.output);
    if (parsed && typeof parsed.output === 'string') return parsed.output;
    return payload.output;
  }
  if (typeof payload.output === 'object' && payload.output !== null) {
    return JSON.stringify(payload.output);
  }
  return '';
}

function pickBestOutputPreview(payload) {
  return cleanText(
    payload.formatted_output
      || payload.stdout
      || payload.stderr
      || payload.aggregated_output
      || ''
  );
}

function durationToMs(duration) {
  if (!duration || typeof duration !== 'object') return null;
  const secs = Number(duration.secs || 0);
  const nanos = Number(duration.nanos || 0);
  return Math.round(secs * 1000 + nanos / 1e6);
}

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function extractContentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item?.type === 'output_text' || item?.type === 'text') return item.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function cleanText(value) {
  return String(value || '').replace(/\s+$/g, '').trimStart();
}

function truncate(value) {
  const text = cleanText(value);
  if (!text) return '';
  return text.length > maxPreviewLength
    ? `${text.slice(0, maxPreviewLength)}\n...[truncated]`
    : text;
}
