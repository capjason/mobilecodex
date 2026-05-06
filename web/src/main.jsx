import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import {
  createSession,
  getSessionHistory,
  listAgentSessions,
  listSessions,
  scanRepos,
  sendSessionInput,
  stopSession,
  structuredChatWebSocketUrl,
  terminalWebSocketUrl
} from './api.js';

const configuredDefaultRoot = import.meta.env.VITE_DEFAULT_WORKDIR;
const defaultRoot = configuredDefaultRoot && configuredDefaultRoot.trim()
  ? configuredDefaultRoot.trim()
  : '~';
const stateStorageKey = 'mobilecodex.state.v1';
const defaultBrowserState = {
  agent: 'codex',
  profile: 'normal',
  model: 'gpt-5.5',
  reasoningEffort: 'high',
  launchDirectory: defaultRoot,
  activeSessionId: ''
};
const maxTranscriptItems = 2000;
const transcriptCacheVersion = 8;

function transcriptCursorKey(sessionId) {
  return `mobilecodex.cursor.${sessionId}`;
}

function loadSavedState() {
  try {
    const raw = window.localStorage.getItem(stateStorageKey);
    if (!raw) return defaultBrowserState;
    const merged = { ...defaultBrowserState, ...JSON.parse(raw) };
    if (!['low', 'medium', 'high'].includes(merged.reasoningEffort)) {
      merged.reasoningEffort = 'high';
    }
    return merged;
  } catch {
    return defaultBrowserState;
  }
}

function saveState(state) {
  try {
    window.localStorage.setItem(stateStorageKey, JSON.stringify(state));
  } catch {
    // Private browsing or storage pressure should not break the terminal.
  }
}

function stripAnsi(value) {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function loadTranscript(sessionId) {
  try {
    const raw = window.localStorage.getItem(`mobilecodex.transcript.${sessionId}`);
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows)
      ? rows.map((item) => {
          if (item.role === 'tool' && item.version !== transcriptCacheVersion) return null;
          return {
            id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            role: item.role || 'system',
            content: item.content || '',
            sourceKey: item.sourceKey || '',
            toolCallId: item.toolCallId || extractToolCallId(item.content),
            toolStatus: item.toolStatus || ''
          };
        }).filter((item) => item?.content)
      : [];
  } catch {
    return [];
  }
}

function saveTranscript(sessionId, transcript) {
  try {
    window.localStorage.setItem(
      `mobilecodex.transcript.${sessionId}`,
      JSON.stringify(transcript.slice(-maxTranscriptItems).map((item) => ({
        version: transcriptCacheVersion,
        id: item.id,
        role: item.role,
        content: item.content,
        sourceKey: item.sourceKey || '',
        toolCallId: item.toolCallId || '',
        toolStatus: item.toolStatus || ''
      })))
    );
  } catch {
    // Transcript persistence is best-effort; live terminal streaming still works.
  }
}

function loadTranscriptCursor(sessionId) {
  try {
    return window.localStorage.getItem(transcriptCursorKey(sessionId)) || '';
  } catch {
    return '';
  }
}

function saveTranscriptCursor(sessionId, cursor) {
  if (!cursor) return;
  try {
    window.localStorage.setItem(transcriptCursorKey(sessionId), cursor);
  } catch {
    // Cursor caching is an optimization; reconnect still works without it.
  }
}

function newestEventAt(events) {
  let newest = '';
  for (const event of events || []) {
    if (event?.at && (!newest || event.at > newest)) newest = event.at;
  }
  return newest;
}

function messageRoleLabel(role) {
  if (role === 'agent') return 'Agent';
  if (role === 'user') return 'You';
  if (role === 'tool') return 'Tool';
  if (role === 'plan') return 'Plan';
  return 'System';
}

function tryParseJson(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (!(value.startsWith('{') || value.startsWith('['))) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function summarizeJsonValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') return `Object(${Object.keys(value).length})`;
  if (typeof value === 'string') return `\`${value.length > 160 ? `${value.slice(0, 160)}...` : value}\``;
  return `\`${String(value)}\``;
}

function flattenToolPayload(prefix, value, rows, depth = 0) {
  if (rows.length >= 24) return;
  if (value === null || typeof value !== 'object') {
    rows.push(`- ${prefix}: ${summarizeJsonValue(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      rows.push(`- ${prefix}: \`[]\``);
      return;
    }
    const primitive = value.every((item) => item === null || typeof item !== 'object');
    if (primitive) {
      rows.push(`- ${prefix}: ${summarizeJsonValue(value.join(' '))}`);
      return;
    }
    rows.push(`- ${prefix}: \`Array(${value.length})\``);
    value.slice(0, 6).forEach((item, index) => {
      flattenToolPayload(`${prefix}[${index}]`, item, rows, depth + 1);
    });
    return;
  }

  const keys = Object.keys(value);
  if (!keys.length) {
    rows.push(`- ${prefix}: \`{}\``);
    return;
  }
  if (depth >= 2) {
    rows.push(`- ${prefix}: ${summarizeJsonValue(value)}`);
    return;
  }
  for (const key of keys.slice(0, 12)) {
    flattenToolPayload(prefix ? `${prefix}.${key}` : key, value[key], rows, depth + 1);
  }
  if (keys.length > 12) rows.push(`- ${prefix || 'payload'}.more: \`${keys.length - 12}\``);
}

function renderStructuredToolPayload(rawText) {
  const parsed = tryParseJson(rawText);
  if (!parsed || typeof parsed !== 'object') return null;
  const rows = [];
  if (Array.isArray(parsed)) {
    rows.push(`- items: \`${parsed.length}\``);
    parsed.slice(0, 8).forEach((item, index) => {
      flattenToolPayload(`[${index}]`, item, rows);
    });
    if (parsed.length > 8) rows.push(`- more: \`${parsed.length - 8}\``);
    return rows;
  }

  flattenToolPayload('', parsed, rows);
  return rows;
}

function cleanToolOutputText(value) {
  const lines = String(value || '').replace(/\r/g, '\n').split('\n');
  const cleaned = [];
  let skippingHeader = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      skippingHeader &&
      (
        /^Chunk ID:/i.test(trimmed) ||
        /^Wall time:/i.test(trimmed) ||
        /^Process exited with code/i.test(trimmed) ||
        /^Original token count:/i.test(trimmed) ||
        /^Output:\s*$/i.test(trimmed)
      )
    ) {
      continue;
    }
    if (trimmed) skippingHeader = false;
    cleaned.push(line);
  }
  return cleaned.join('\n').replace(/^\n+/, '').trimEnd();
}

function formatToolEventMessage(message) {
  const item = message.item || {};
  const callId = toolCallIdFromItem(item);
  const toolName = message.toolType || item.toolType || item.name || item.type || 'tool';
  const state = message.type === 'tool_completed'
    ? (item.success === false || item.exitCode ? 'failed' : 'completed')
    : 'running';
  const label = item.command || toolName;
  const summaryParts = [label, state];
  if (typeof item.success === 'boolean') summaryParts.push(item.success ? 'success' : 'failed');
  if (typeof item.exitCode === 'number') summaryParts.push(`exit ${item.exitCode}`);
  if (typeof item.durationMs === 'number') summaryParts.push(`${item.durationMs}ms`);
  const rows = [summaryParts.join(' · ')];

  if (item.command) rows.push(`Command: \`${item.command}\``);
  if (item.cwd) rows.push(`Directory: \`${item.cwd}\``);
  if (callId) rows.push(`Call: \`${callId}\``);
  if (typeof item.exitCode === 'number') rows.push(`Exit Code: \`${item.exitCode}\``);
  if (typeof item.success === 'boolean') rows.push(`Success: \`${item.success}\``);
  if (typeof item.durationMs === 'number') rows.push(`Duration: \`${item.durationMs}ms\``);
  if (item.status) rows.push(`Status: \`${item.status}\``);

  const output = cleanToolOutputText(item.outputPreview || item.argsPreview || '');
  if (output) {
    rows.push('');
    const structured = renderStructuredToolPayload(output);
    if (structured) {
      rows.push('Payload:');
      rows.push(...structured);
    } else {
      rows.push('```text');
      rows.push(output);
      rows.push('```');
    }
  }

  return rows.join('\n');
}

function formatToolOutputMessage(message) {
  const raw = cleanToolOutputText(message?.content || '').trim();
  if (!raw) return '';
  const rows = ['Running tool'];
  if (message?.itemId) rows.push(`Call: \`${message.itemId}\``);
  rows.push('');
  const structured = renderStructuredToolPayload(raw);
  if (structured) {
    rows.push(...structured);
  } else {
    rows.push('```text');
    rows.push(raw);
    rows.push('```');
  }
  return rows.join('\n');
}

function extractToolCallId(content) {
  return String(content || '').match(/Call: `([^`]+)`/)?.[1] || '';
}

function sourceKeySet(sourceKey) {
  return new Set(String(sourceKey || '').split('|').filter(Boolean));
}

function entryHasSourceKey(entry, sourceKey) {
  return Boolean(sourceKey && sourceKeySet(entry?.sourceKey).has(sourceKey));
}

function mergeSourceKeys(left, right) {
  return [...new Set([...sourceKeySet(left), ...sourceKeySet(right)])].join('|');
}

function toolCallIdFromItem(item) {
  return item?.callId || item?.call_id || item?.id || '';
}

function toolCallIdFromMessage(message) {
  return toolCallIdFromItem(message?.item) || message?.itemId || '';
}

function toolStatusFromMessage(message) {
  if (message?.type === 'tool_completed') {
    return message.item?.success === false || message.item?.exitCode ? 'failed' : 'completed';
  }
  if (message?.type === 'tool_started') return 'running';
  if (message?.type === 'tool_output_delta') return 'running';
  return '';
}

function toolStatusRank(status) {
  if (status === 'completed') return 3;
  if (status === 'failed') return 3;
  if (status === 'running') return 2;
  return 1;
}

function toolHeaderRank(line) {
  if (/\b(completed|failed)\b/.test(line)) return 4;
  if (/\brunning\b/.test(line)) return 2;
  if (/^Running tool\b/.test(line)) return 1;
  return 0;
}

function splitToolContent(content) {
  const lines = String(content || '').trim().split('\n');
  const first = lines[0] || '';
  if (toolHeaderRank(first)) {
    return { header: first, body: lines.slice(1).join('\n').trim() };
  }
  return { header: '', body: lines.join('\n').trim() };
}

function mergeUniqueBlocks(...blocks) {
  const rows = [];
  for (const block of blocks) {
    const text = String(block || '').trim();
    if (!text) continue;
    if (rows.some((row) => row.includes(text) || text.includes(row))) continue;
    rows.push(text);
  }
  return rows.join('\n\n');
}

function mergeToolTranscriptContent(previousContent, incomingContent) {
  const previous = String(previousContent || '').trimEnd();
  const incoming = String(incomingContent || '').trim();
  if (!incoming) return previous;
  if (!previous) return incoming;
  if (previous.includes(incoming)) return previous;

  const previousCall = extractToolCallId(previous);
  const incomingCall = extractToolCallId(incoming);
  if (!previousCall || !incomingCall || previousCall !== incomingCall) return null;

  const incomingWithoutHeader = incoming
    .split('\n')
    .filter((line, index) => {
      if (index === 0 && (toolHeaderRank(line) || /^Running tool\b/.test(line))) return false;
      if (line === `Call: \`${incomingCall}\`` && previous.includes(line)) return false;
      return true;
    })
    .join('\n')
    .trim();
  if (!incomingWithoutHeader || previous.includes(incomingWithoutHeader)) return previous;
  return `${previous}\n\n${incomingWithoutHeader}`;
}

function mergeToolEntries(previous, incoming) {
  if (!previous) return incoming;
  if (!incoming) return previous;
  if (incoming.sourceKey && entryHasSourceKey(previous, incoming.sourceKey)) return previous;

  const previousParts = splitToolContent(previous.content);
  const incomingParts = splitToolContent(incoming.content);
  const header = toolHeaderRank(incomingParts.header) >= toolHeaderRank(previousParts.header)
    ? incomingParts.header || previousParts.header
    : previousParts.header || incomingParts.header;
  const content = [header, mergeUniqueBlocks(previousParts.body, incomingParts.body)].filter(Boolean).join('\n');
  const status = toolStatusRank(incoming.toolStatus) >= toolStatusRank(previous.toolStatus)
    ? incoming.toolStatus || previous.toolStatus
    : previous.toolStatus || incoming.toolStatus;

  return {
    ...previous,
    content,
    toolCallId: previous.toolCallId || incoming.toolCallId || '',
    toolStatus: status,
    sourceKey: mergeSourceKeys(previous.sourceKey, incoming.sourceKey)
  };
}

function toolEntryFromMessage(message, sourceKey = structuredEventKey(message)) {
  const content = message.type === 'tool_output_delta'
    ? formatToolOutputMessage(message) || (message.content || '')
    : formatToolEventMessage(message);
  const toolCallId = toolCallIdFromMessage(message) || extractToolCallId(content);
  return {
    id: toolCallId ? `tool-${toolCallId}` : (sourceKey || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    role: 'tool',
    content,
    sourceKey,
    toolCallId,
    toolStatus: toolStatusFromMessage(message)
  };
}

function toolSummaryLine(content) {
  const firstLine = String(content || '').split('\n').find((line) => line.trim()) || 'Tool details';
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
}

function normalizeLifecycleStatus(status) {
  const key = String(status || '').trim().toLowerCase();
  if (key === 'completed' || key === 'done' || key === 'complete') return 'completed';
  if (key === 'inprogress' || key === 'in_progress' || key === 'in-progress' || key === 'working') return 'inProgress';
  if (key === 'pending' || key === 'todo') return 'pending';
  return key || 'pending';
}

function parseLifecycleLines(content) {
  const lines = String(content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, ''));

  const items = [];
  for (const line of lines) {
    const match = line.match(/^(completed|inprogress|in_progress|in-progress|pending)\s*[:：]\s*(.+)$/i);
    if (!match) return null;
    items.push({
      status: normalizeLifecycleStatus(match[1]),
      text: match[2].trim()
    });
  }
  return items.length ? items : null;
}

function sessionIdentityKey(session) {
  const threadTarget = session.threadId || session.resumeTarget;
  if (session.status === 'running' && threadTarget) {
    return [session.agent, session.repoPath, threadTarget].join(':');
  }
  return session.sessionId;
}

function dedupeSessionRows(rows) {
  const unique = new Map();
  for (const row of rows) {
    const key = sessionIdentityKey(row);
    const previous = unique.get(key);
    if (!previous || new Date(row.createdAt || 0) >= new Date(previous.createdAt || 0)) {
      unique.set(key, row);
    }
  }
  return [...unique.values()];
}

function mergeHistoryTitleMap(currentMap, historyRows) {
  const next = { ...currentMap };
  for (const row of historyRows || []) {
    const title = String(row?.title || '').trim();
    if (!title) continue;
    if (row.resumeTarget) next[row.resumeTarget] = title;
    if (row.id) next[row.id] = title;
  }
  return next;
}

function sessionDisplayName(session, titleMap) {
  const threadTarget = session.threadId || session.resumeTarget || '';
  const mappedTitle = (threadTarget && titleMap[threadTarget]) || titleMap[session.sessionId] || '';
  if (mappedTitle) return mappedTitle;
  return session.repoName || session.sessionId;
}

function structuredEventKey(message) {
  const at = message?.at || '';
  if (!at) return '';
  // Delta events are stream chunks. They may repeat content in the same millisecond
  // during replay/live overlap, so deduping by timestamp can drop real output.
  if (
    message.type === 'assistant_delta' ||
    message.type === 'thinking_delta' ||
    message.type === 'tool_output_delta'
  ) {
    return '';
  }
  if (message.type === 'status') return `${message.type}:${at}:${message.status || ''}`;
  if (message.type === 'plan') return `${message.type}:${at}:${message.explanation || ''}`;
  if (message.type === 'tool_started' || message.type === 'tool_completed') {
    return `${message.type}:${at}:${toolCallIdFromMessage(message) || message.item?.type || ''}`;
  }
  return `${message.type}:${at}:${message.content || ''}`;
}

function transcriptEntryKey(entry) {
  if (entry.role === 'tool' && entry.toolCallId) return `tool:${entry.toolCallId}`;
  if (entry.sourceKey) return `source:${entry.sourceKey}`;
  return `content:${entry.role}:${entry.content}`;
}

function trimTranscriptEntries(entries) {
  return entries.slice(-maxTranscriptItems);
}

function mergeTranscriptEntries(baseEntries, incomingEntries) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...baseEntries, ...incomingEntries]) {
    if (!entry?.content) continue;
    const toolCallId = entry.role === 'tool' ? (entry.toolCallId || extractToolCallId(entry.content)) : '';
    if (toolCallId) {
      const index = merged.findIndex((item) => item.role === 'tool' && (item.toolCallId || extractToolCallId(item.content)) === toolCallId);
      const normalized = { ...entry, toolCallId };
      if (index >= 0) {
        merged[index] = mergeToolEntries(merged[index], normalized);
        continue;
      }
      merged.push(normalized);
      continue;
    }
    const key = transcriptEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return trimTranscriptEntries(merged);
}

function transcriptEntriesFromStructuredEvents(events) {
  const entries = [];
  for (const message of events || []) {
    const sourceKey = structuredEventKey(message);
    if (message.type === 'assistant_message') {
      entries.push({ role: 'agent', content: message.content || '', sourceKey });
      continue;
    }
    if (message.type === 'assistant_delta') {
      entries.push({ role: 'agent', content: message.content || '' });
      continue;
    }
    if (message.type === 'thinking_delta') {
      entries.push({ role: 'agent', content: message.content ? `> ${message.content}` : '' });
      continue;
    }
    if (message.type === 'user') {
      entries.push({ role: 'user', content: message.content || '', sourceKey });
      continue;
    }
    if (message.type === 'tool_started' || message.type === 'tool_completed') {
      entries.push(toolEntryFromMessage(message, sourceKey));
      continue;
    }
    if (message.type === 'tool_output_delta') {
      entries.push(toolEntryFromMessage(message, sourceKey));
      continue;
    }
    if (message.type === 'plan') {
      const rows = (message.plan || []).map((item) => `- ${item.status}: ${item.step}`).join('\n');
      entries.push({ role: 'agent', content: [message.explanation, rows].filter(Boolean).join('\n'), sourceKey });
      continue;
    }
    if (message.type === 'error') {
      entries.push({ role: 'system', content: `Error: ${message.message || message.content || 'Unknown error'}`, sourceKey });
      continue;
    }
    if (message.type === 'exit') {
      entries.push({ role: 'system', content: `Session exited: ${message.code ?? 'unknown'}`, sourceKey });
    }
  }

  return entries
    .map((item) => ({ ...item, content: stripAnsi(item.content || '') }))
    .filter((item) => item.content);
}

function App() {
  const savedState = useMemo(() => loadSavedState(), []);
  const [agent, setAgent] = useState(savedState.agent);
  const [profile, setProfile] = useState(savedState.profile);
  const [model, setModel] = useState(savedState.model);
  const [reasoningEffort, setReasoningEffort] = useState(savedState.reasoningEffort);
  const [repoRoot] = useState(defaultRoot);
  const [repos, setRepos] = useState([]);
  const [launchDirectory, setLaunchDirectory] = useState(savedState.launchDirectory);
  const [sessions, setSessions] = useState([]);
  const [historySessions, setHistorySessions] = useState([]);
  const [sessionTitles, setSessionTitles] = useState({});
  const [activeSessionId, setActiveSessionId] = useState(savedState.activeSessionId);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const currentRepo = launchDirectory.trim() || repoRoot;
  const filteredSessions = useMemo(
    () => dedupeSessionRows(sessions.filter((session) => session.agent === agent && session.repoPath === currentRepo && session.status === 'running')),
    [agent, currentRepo, sessions]
  );
  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId && session.status === 'running') || null,
    [activeSessionId, sessions]
  );
  const runningSessions = useMemo(
    () => {
      return dedupeSessionRows(sessions.filter((item) => item.status === 'running'));
    },
    [sessions]
  );

  const refreshSessions = React.useCallback(async () => {
    setIsBusy(true);
    setError('');
    try {
      const [managed, history] = await Promise.all([
        listSessions(),
        listAgentSessions({ agent, repo: currentRepo })
      ]);
      const runningPairs = [...new Map(
        dedupeSessionRows(managed.filter((session) => session.status === 'running'))
          .map((session) => [`${session.agent}:${session.repoPath}`, { agent: session.agent, repo: session.repoPath }])
      ).values()];
      const extraPairs = runningPairs.filter((item) => !(item.agent === agent && item.repo === currentRepo));
      const extraHistoryRows = (await Promise.all(
        extraPairs.map((item) => (
          listAgentSessions({ agent: item.agent, repo: item.repo }).catch(() => [])
        ))
      )).flat();
      setSessionTitles((current) => mergeHistoryTitleMap(current, [...history, ...extraHistoryRows]));
      setSessions(managed);
      setHistorySessions(history);
      if (activeSessionId) {
        const visibleRunning = dedupeSessionRows(managed.filter((session) => session.status === 'running'));
        const stillVisible = visibleRunning.some((session) => session.sessionId === activeSessionId);
        if (!stillVisible) {
          const replacement =
            visibleRunning.find((session) => session.agent === agent && session.repoPath === currentRepo) ||
            visibleRunning[0];
          setActiveSessionId(replacement?.sessionId || '');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsBusy(false);
    }
  }, [activeSessionId, agent, currentRepo]);

  async function loadRepos() {
    setIsBusy(true);
    setError('');
    try {
      const repoList = await scanRepos(repoRoot, 2);
      setRepos(repoList);
      setLaunchDirectory((current) => current || repoRoot);
    } catch (err) {
      setError(err.message);
      setLaunchDirectory((current) => current || repoRoot);
    } finally {
      setIsBusy(false);
    }
  }

  async function launchSession({ agent: nextAgent, repo, profile: nextProfile, model: nextModel = model, launchMode = 'new', resumeTarget = '' }) {
    setIsBusy(true);
    setError('');
    try {
      const session = await createSession({
        agent: nextAgent,
        repo,
        profile: nextProfile,
        model: nextModel,
        reasoningEffort,
        launchMode,
        resumeTarget
      });
      setAgent(nextAgent);
      setProfile(nextProfile);
      setModel(nextModel);
      setLaunchDirectory(repo);
      setSessions((current) => [session, ...current.filter((item) => item.sessionId !== session.sessionId)]);
      setActiveSessionId(session.sessionId);
      await refreshSessions();
      return session;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsBusy(false);
    }
  }

  async function startNewSession() {
    await launchSession({
      agent,
      repo: currentRepo,
      profile,
      launchMode: 'new'
    });
  }

  async function resumeHistorySession(historySession) {
    await launchSession({
      agent,
      repo: currentRepo,
      profile,
      launchMode: 'resume-id',
      resumeTarget: historySession.resumeTarget
    });
  }

  async function closeSession() {
    if (!activeSessionId) return;
    setIsBusy(true);
    setError('');
    try {
      await stopSession(activeSessionId);
      setActiveSessionId('');
      await refreshSessions();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsBusy(false);
    }
  }

  function changeAgent(nextAgent) {
    setAgent(nextAgent);
    setActiveSessionId('');
  }

  function changeLaunchDirectory(nextDirectory) {
    setLaunchDirectory(nextDirectory);
    setActiveSessionId('');
  }

  useEffect(() => {
    loadRepos();
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    saveState({ agent, profile, model, reasoningEffort, launchDirectory, activeSessionId });
  }, [agent, profile, model, reasoningEffort, launchDirectory, activeSessionId]);

  useEffect(() => {
    function refreshOnResume() {
      if (document.visibilityState === 'hidden') return;
      refreshSessions();
    }

    window.addEventListener('pageshow', refreshOnResume);
    document.addEventListener('visibilitychange', refreshOnResume);
    window.addEventListener('focus', refreshOnResume);
    window.addEventListener('online', refreshOnResume);

    return () => {
      window.removeEventListener('pageshow', refreshOnResume);
      document.removeEventListener('visibilitychange', refreshOnResume);
      window.removeEventListener('focus', refreshOnResume);
      window.removeEventListener('online', refreshOnResume);
    };
  }, [refreshSessions]);

  return (
    <main className={activeSession ? 'app-shell session-mode' : 'app-shell'}>
      {!activeSession ? (
        <header className="control-bar">
          <label>
            <span>CLI</span>
            <select value={agent} onChange={(event) => changeAgent(event.target.value)}>
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </label>
          <label>
            <span>Launch Directory</span>
            <input
              list="repo-suggestions"
              value={launchDirectory}
              onChange={(event) => changeLaunchDirectory(event.target.value)}
              placeholder={defaultRoot === '~' ? '~/workspace/project' : `${defaultRoot.replace(/\/$/, '')}/project`}
            />
            <datalist id="repo-suggestions">
              {repos.map((repo) => (
                <option value={repo.path} key={repo.path}>
                  {repo.name}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            <span>Permission</span>
            <select value={profile} onChange={(event) => setProfile(event.target.value)}>
              <option value="safe_plan">Safe Plan</option>
              <option value="normal">Normal</option>
              <option value="full_auto">Full Auto</option>
              <option value="bypass">Bypass</option>
              <option value="review">Review</option>
            </select>
          </label>
        </header>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="main-surface">
        {activeSession ? (
          <AgentConsole
            session={activeSession}
            onClose={closeSession}
            availableSessions={runningSessions}
            onSelectSession={setActiveSessionId}
            onCreateSession={launchSession}
            onCanonicalSession={setActiveSessionId}
            model={model}
            onModelChange={setModel}
            sessionTitles={sessionTitles}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={setReasoningEffort}
          />
        ) : (
          <SessionPicker
            agent={agent}
            repoPath={currentRepo}
            sessions={filteredSessions}
            historySessions={historySessions}
            isBusy={isBusy}
            onRefresh={refreshSessions}
            onSelect={setActiveSessionId}
            onNewSession={startNewSession}
            onResumeHistory={resumeHistorySession}
            sessionTitles={sessionTitles}
          />
        )}
      </section>
    </main>
  );
}

function SessionPicker({
  agent,
  repoPath,
  sessions,
  historySessions,
  isBusy,
  onRefresh,
  onSelect,
  onNewSession,
  onResumeHistory,
  sessionTitles
}) {
  return (
    <div className="session-picker">
      <div className="session-picker-header">
        <div>
          <h1>{agent === 'codex' ? 'Codex' : 'Claude Code'}</h1>
          <p>{repoPath}</p>
        </div>
        <button onClick={onRefresh} disabled={isBusy} title="Refresh sessions">Refresh</button>
      </div>

      <div className="session-actions-row">
        <button className="primary" onClick={onNewSession} disabled={isBusy || !repoPath}>
          New Session
        </button>
      </div>

      <div className="session-list">
        {sessions.map((session) => (
          <button className="session-card" key={session.sessionId} onClick={() => onSelect(session.sessionId)}>
            <strong>{sessionDisplayName(session, sessionTitles)}</strong>
            <span>running session · {session.status} · {session.launchMode || 'new'}</span>
            <small>{session.repoName} · {session.sessionId}</small>
          </button>
        ))}
        {historySessions.map((session) => (
          <button className="session-card" key={`${session.source}:${session.id}`} onClick={() => onResumeHistory(session)}>
            <strong>{session.title}</strong>
            <span>resume history · {formatDate(session.lastActivityAt)}</span>
            <small>{session.resumeTarget}</small>
          </button>
        ))}
        {!sessions.length && !historySessions.length ? (
          <div className="empty-state">
            <p>No sessions for this CLI and directory.</p>
            <span>Create a new one to start chatting.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return 'unknown';
  return new Date(value).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function isMarkdownBoundary(line) {
  return /^(```|#{1,4}\s+|[-*]\s+|\d+\.\s+|>\s?)/.test(line);
}

function parseMarkdownBlocks(markdown) {
  const lines = markdown.replace(/\t/g, '  ').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\S*)/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += lines[index]?.startsWith('```') ? 1 : 0;
      blocks.push({ type: 'code', language: fence[1] || 'text', content: code.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: heading[2] });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', content: quote.join('\n') });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isMarkdownBoundary(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', content: paragraph.join('\n') });
  }

  return blocks;
}

function InlineMarkdown({ text }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = /^(https?:|mailto:|#)/.test(link[2]) ? link[2] : '#';
      return <a key={index} href={href} target="_blank" rel="noreferrer">{link[1]}</a>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function CodeBlock({ language, content }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard?.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language || 'text'}</span>
        <button onClick={copyCode}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre><code>{content}</code></pre>
    </div>
  );
}

function LifecycleChecklist({ items }) {
  return (
    <div className="lifecycle-list">
      {items.map((item, index) => (
        <div className={`lifecycle-item ${item.status}`} key={`${item.status}-${index}-${item.text}`}>
          <span className="lifecycle-icon" aria-hidden>
            {item.status === 'completed' ? '✓' : item.status === 'inProgress' ? '◔' : '○'}
          </span>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

function RichMessageContent({ content }) {
  return (
    <div className="rich-message-content">
      {parseMarkdownBlocks(content).map((block, index) => {
        if (block.type === 'code') {
          return <CodeBlock key={index} language={block.language} content={block.content} />;
        }
        if (block.type === 'heading') {
          const Tag = block.level <= 2 ? 'h3' : 'h4';
          return <Tag key={index}><InlineMarkdown text={block.content} /></Tag>;
        }
        if (block.type === 'quote') {
          return <blockquote key={index}><InlineMarkdown text={block.content} /></blockquote>;
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}><InlineMarkdown text={item} /></li>
              ))}
            </Tag>
          );
        }
        return <p key={index}><InlineMarkdown text={block.content} /></p>;
      })}
    </div>
  );
}

function AgentConsole({
  session,
  onClose,
  availableSessions,
  onSelectSession,
  onCreateSession,
  onCanonicalSession,
  model,
  onModelChange,
  sessionTitles,
  reasoningEffort,
  onReasoningEffortChange
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftAgent, setDraftAgent] = useState(session.agent || 'codex');
  const [draftRepo, setDraftRepo] = useState(session.repoPath || '');
  const [draftProfile, setDraftProfile] = useState(session.profile || 'normal');
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [historyChoices, setHistoryChoices] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const touchStartRef = React.useRef({ x: 0, y: 0, side: '' });

  useEffect(() => {
    setDrawerOpen(false);
    setSettingsOpen(false);
    setDraftAgent(session.agent || 'codex');
    setDraftRepo(session.repoPath || '');
    setDraftProfile(session.profile || 'normal');
    setCustomizeOpen(false);
  }, [session.sessionId]);

  useEffect(() => {
    if (!drawerOpen) return;
    refreshHistory(draftAgent, draftRepo);
  }, [drawerOpen, draftAgent, draftRepo]);

  useEffect(() => {
    if (!drawerOpen) setCustomizeOpen(false);
  }, [drawerOpen]);

  async function refreshHistory(nextAgent, nextRepo) {
    const repo = (nextRepo || '').trim();
    if (!repo) {
      setHistoryChoices([]);
      return;
    }
    setHistoryLoading(true);
    setDrawerError('');
    try {
      const rows = await listAgentSessions({ agent: nextAgent, repo });
      setHistoryChoices(rows);
    } catch (error) {
      setDrawerError(error.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function createFromDrawer() {
    const repo = draftRepo.trim();
    if (!repo) {
      setDrawerError('Working directory is required.');
      return;
    }
    setDrawerError('');
    await onCreateSession({
      agent: draftAgent,
      repo,
      profile: draftProfile,
      model,
      reasoningEffort,
      launchMode: 'new'
    });
    setDrawerOpen(false);
  }

  async function resumeFromHistory(item) {
    const repo = draftRepo.trim() || session.repoPath || '';
    await onCreateSession({
      agent: draftAgent,
      repo,
      profile: draftProfile,
      model,
      reasoningEffort,
      launchMode: 'resume-id',
      resumeTarget: item.resumeTarget
    });
    setDrawerOpen(false);
  }

  const currentResumeTarget = session.threadId || session.resumeTarget || '';
  const visibleHistoryChoices = historyChoices.filter((item) => item.resumeTarget !== currentResumeTarget);
  const activeSessionTitle = sessionDisplayName(session, sessionTitles);

  function onTouchStart(event) {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      side: touch.clientX <= 24 || drawerOpen ? 'left' : (width - touch.clientX <= 24 || settingsOpen ? 'right' : '')
    };
  }

  function onTouchMove(event) {
    const touch = event.changedTouches?.[0];
    if (!touch || !touchStartRef.current.side) return;
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (dy > 48) return;
    if (touchStartRef.current.side === 'left' && !drawerOpen && dx > 42) {
      setDrawerOpen(true);
      touchStartRef.current.side = '';
    }
    if (touchStartRef.current.side === 'left' && drawerOpen && dx < -42) {
      setDrawerOpen(false);
      touchStartRef.current.side = '';
    }
    if (touchStartRef.current.side === 'right' && !settingsOpen && dx < -42) {
      setSettingsOpen(true);
      touchStartRef.current.side = '';
    }
    if (touchStartRef.current.side === 'right' && settingsOpen && dx > 42) {
      setSettingsOpen(false);
      touchStartRef.current.side = '';
    }
  }

  return (
    <section className="agent-panel" onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
      <button
        className="session-drawer-handle"
        onClick={() => setDrawerOpen((open) => !open)}
        aria-label="Open session drawer"
      >
        ≡
      </button>
      {drawerOpen ? (
        <>
          <button
            className="session-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close session drawer"
          />
          <aside className="session-drawer">
            <div className="session-drawer-header">
              <span>Sessions</span>
            </div>
            <div className="session-drawer-form">
              <div className="session-drawer-form-top">
                <button className="session-drawer-new" onClick={createFromDrawer}>
                  New Session
                </button>
                <button
                  className="session-drawer-customize"
                  onClick={() => setCustomizeOpen((open) => !open)}
                >
                  {customizeOpen ? 'Hide Options' : 'Customize'}
                </button>
              </div>
              {customizeOpen ? (
                <div className="session-drawer-form-fields">
                  <label>
                    <span>CLI</span>
                    <select value={draftAgent} onChange={(event) => setDraftAgent(event.target.value)}>
                      <option value="codex">Codex</option>
                      <option value="claude">Claude Code</option>
                    </select>
                  </label>
                  <label>
                    <span>CWD</span>
                    <input value={draftRepo} onChange={(event) => setDraftRepo(event.target.value)} />
                  </label>
                  <label>
                    <span>Permission</span>
                    <select value={draftProfile} onChange={(event) => setDraftProfile(event.target.value)}>
                      <option value="safe_plan">Safe Plan</option>
                      <option value="normal">Normal</option>
                      <option value="full_auto">Full Auto</option>
                      <option value="bypass">Bypass</option>
                      <option value="review">Review</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
            <div className="session-drawer-list">
              {availableSessions.map((item) => (
                <button
                  key={item.sessionId}
                  className={item.sessionId === session.sessionId ? 'session-drawer-item active' : 'session-drawer-item'}
                  onClick={() => onSelectSession(item.sessionId)}
                >
                  <strong>{sessionDisplayName(item, sessionTitles)}</strong>
                  <span>{item.agent} · {item.repoName}</span>
                </button>
              ))}
              <div className="session-drawer-subhead">Resume Previous</div>
              {historyLoading ? <div className="session-drawer-note">Loading...</div> : null}
              {drawerError ? <div className="session-drawer-note error">{drawerError}</div> : null}
              {!historyLoading && !visibleHistoryChoices.length ? (
                <div className="session-drawer-note">No history for this CLI/CWD.</div>
              ) : null}
              {visibleHistoryChoices.map((item) => (
                <button
                  key={`${item.source}:${item.id}`}
                  className="session-drawer-item history"
                  onClick={() => resumeFromHistory(item)}
                >
                  <strong>{item.title || 'Untitled session'}</strong>
                  <span>{item.resumeTarget}</span>
                </button>
              ))}
            </div>
          </aside>
        </>
      ) : null}
      {settingsOpen ? (
        <>
          <button
            className="settings-drawer-backdrop"
            onClick={() => setSettingsOpen(false)}
            aria-label="Close settings drawer"
          />
          <aside className="settings-drawer">
            <div className="settings-drawer-header">
              <span>Settings</span>
            </div>
            <div className="settings-drawer-body">
              <label className="settings-field">
                <span>Model</span>
                <select value={model} onChange={(event) => onModelChange(event.target.value)}>
                  <option value="gpt-5.5">GPT-5.5</option>
                  <option value="gpt-5.4">GPT-5.4</option>
                  <option value="gpt-5.3-codex">GPT-5.3 Codex</option>
                  <option value="gpt-5.3-codex-spark">GPT-5.3 Codex Spark</option>
                </select>
              </label>
              <label className="settings-field">
                <span>Reasoning</span>
                <select value={reasoningEffort} onChange={(event) => onReasoningEffortChange(event.target.value)}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
            </div>
          </aside>
        </>
      ) : null}
      <div className="chat-toolbar">
        <div>
          <h1>{activeSessionTitle}</h1>
          <p>{session.agent === 'codex' ? 'Codex' : 'Claude Code'} · {session.repoName}</p>
        </div>
        <div className="toolbar-actions">
          <button className="settings-icon" onClick={() => setSettingsOpen(true)} aria-label="Open settings">⚙</button>
          <button className="close-icon" onClick={onClose} aria-label="Close session">×</button>
        </div>
      </div>
      <AgentStream session={session} onCanonicalSession={onCanonicalSession} />
    </section>
  );
}

function AgentStream({ session, onCanonicalSession }) {
  const sessionId = session.sessionId;
  const isStructured = session.runtime === 'structured';
  const historyPageSize = 300;
  const transcriptRef = React.useRef(null);
  const transcriptEndRef = React.useRef(null);
  const socketRef = React.useRef(null);
  const reconnectTimerRef = React.useRef(null);
  const reconnectAttemptRef = React.useRef(0);
  const shouldReconnectRef = React.useRef(false);
  const outputBufferRef = React.useRef('');
  const outputFlushTimerRef = React.useRef(null);
  const shouldAutoScrollRef = React.useRef(true);
  const seenStructuredEventsRef = React.useRef(new Set());
  const lastStructuredAtRef = React.useRef(loadTranscriptCursor(sessionId));
  const [input, setInput] = useState('');
  const [transcript, setTranscript] = useState(() => loadTranscript(sessionId));
  const [hasUnread, setHasUnread] = useState(false);
  const [sessionStatus, setSessionStatus] = useState('connecting');
  const [historySyncStatus, setHistorySyncStatus] = useState(() => (
    isStructured && loadTranscript(sessionId).length ? 'cached' : ''
  ));
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const appendTranscript = React.useCallback((role, content, sourceKey = '') => {
    const text = stripAnsi(content);
    if (!text) return;
    setTranscript((current) => {
      const nextEntry = {
        id: sourceKey || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role,
        content: text,
        sourceKey
      };
      if (sourceKey && current.some((item) => item.sourceKey === sourceKey)) return current;
      const last = current[current.length - 1];
      const mergedToolContent = role === 'tool' && last?.role === 'tool'
        ? mergeToolTranscriptContent(last.content, text)
        : null;
      if (mergedToolContent) {
        return [
          ...current.slice(0, -1),
          {
            ...last,
            content: mergedToolContent
          }
        ];
      }
      return mergeTranscriptEntries(current, [nextEntry]);
    });
  }, []);

  const appendToolTranscript = React.useCallback((message) => {
    const sourceKey = structuredEventKey(message);
    const entry = toolEntryFromMessage(message, sourceKey);
    if (!entry.content) return;
    setTranscript((current) => mergeTranscriptEntries(current, [entry]));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapTranscript() {
      outputBufferRef.current = '';
      seenStructuredEventsRef.current = new Set();
      lastStructuredAtRef.current = loadTranscriptCursor(sessionId);
      clearTimeout(outputFlushTimerRef.current);
      outputFlushTimerRef.current = null;
      const cached = loadTranscript(sessionId);
      setTranscript(cached);

      if (!isStructured) {
        setHistoryOffset(0);
        setHasMoreHistory(false);
        setHistoryLoading(false);
        setHistorySyncStatus('');
        return;
      }

      setHistoryLoading(true);
      setHistorySyncStatus(cached.length ? 'cached' : 'loading');
      try {
        const page = await getSessionHistory(sessionId, { offset: 0, limit: historyPageSize });
        if (cancelled) return;
        const baseEntries = transcriptEntriesFromStructuredEvents(page.events).map((item, index) => ({
          id: `history-${sessionId}-${index}-${Math.random().toString(16).slice(2)}`,
          role: item.role,
          content: item.content,
          sourceKey: item.sourceKey || '',
          toolCallId: item.toolCallId || '',
          toolStatus: item.toolStatus || ''
        }));
        setTranscript((current) => mergeTranscriptEntries(baseEntries, current));
        setHistoryOffset(page.nextOffset || baseEntries.length);
        setHasMoreHistory(Boolean(page.hasMore));
        seenStructuredEventsRef.current = new Set((page.events || []).map(structuredEventKey).filter(Boolean));
        const newest = newestEventAt(page.events);
        if (newest && newest > (lastStructuredAtRef.current || '')) {
          lastStructuredAtRef.current = newest;
          saveTranscriptCursor(sessionId, newest);
        }
        setHistorySyncStatus('synced');
      } catch {
        if (!cancelled) {
          setHistoryOffset(0);
          setHasMoreHistory(false);
          setHistorySyncStatus(cached.length ? 'cached' : 'offline');
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    bootstrapTranscript();
    return () => {
      cancelled = true;
    };
  }, [isStructured, sessionId]);

  useEffect(() => {
    saveTranscript(sessionId, transcript);
    if (shouldAutoScrollRef.current) {
      transcriptEndRef.current?.scrollIntoView({ block: 'end' });
      setHasUnread(false);
    } else {
      setHasUnread(true);
    }
  }, [sessionId, transcript]);

  const flushAgentOutput = React.useCallback(() => {
    const output = outputBufferRef.current;
    outputBufferRef.current = '';
    if (!output) return;
    appendTranscript('agent', output);
  }, [appendTranscript]);

  const queueAgentOutput = React.useCallback((data) => {
    outputBufferRef.current += data;
    clearTimeout(outputFlushTimerRef.current);
    outputFlushTimerRef.current = window.setTimeout(() => {
      outputFlushTimerRef.current = null;
      flushAgentOutput();
    }, 350);
  }, [flushAgentOutput]);

  const loadOlderHistory = React.useCallback(async () => {
    if (!isStructured || historyLoading || !hasMoreHistory) return;
    setHistoryLoading(true);
    try {
      const page = await getSessionHistory(sessionId, { offset: historyOffset, limit: historyPageSize });
      const olderEntries = transcriptEntriesFromStructuredEvents(page.events).map((item, index) => ({
        id: `history-older-${sessionId}-${historyOffset}-${index}-${Math.random().toString(16).slice(2)}`,
        role: item.role,
        content: item.content,
        sourceKey: item.sourceKey || '',
        toolCallId: item.toolCallId || '',
        toolStatus: item.toolStatus || ''
      }));
      for (const event of page.events || []) {
        const key = structuredEventKey(event);
        if (key) seenStructuredEventsRef.current.add(key);
      }
      const newest = newestEventAt(page.events);
      if (newest && newest > (lastStructuredAtRef.current || '')) {
        lastStructuredAtRef.current = newest;
        saveTranscriptCursor(sessionId, newest);
      }
      setTranscript((current) => mergeTranscriptEntries(olderEntries, current));
      setHistoryOffset(page.nextOffset || historyOffset + olderEntries.length);
      setHasMoreHistory(Boolean(page.hasMore));
      setHistorySyncStatus('synced');
    } catch {
      setHasMoreHistory(false);
      setHistorySyncStatus('offline');
    } finally {
      setHistoryLoading(false);
    }
  }, [hasMoreHistory, historyLoading, historyOffset, isStructured, sessionId]);

  const reconnectTerminal = React.useCallback((force = false, announceAttach = force) => {
    if (!sessionId) return;
    shouldReconnectRef.current = true;
    const existingSocket = socketRef.current;
    const isConnected =
      existingSocket &&
      (existingSocket.readyState === WebSocket.OPEN || existingSocket.readyState === WebSocket.CONNECTING);
    if (!force && isConnected) return;

    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;

    if (existingSocket) {
      socketRef.current = null;
      existingSocket.close();
    }

    setSessionStatus(announceAttach ? 'connecting' : 'reconnecting');

    const socketUrl = isStructured
      ? structuredChatWebSocketUrl(sessionId, { after: lastStructuredAtRef.current })
      : terminalWebSocketUrl(sessionId);
    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

    function scheduleReconnect() {
      if (!shouldReconnectRef.current || document.visibilityState === 'hidden') return;
      if (reconnectTimerRef.current) return;

      const delay = Math.min(500 * 2 ** reconnectAttemptRef.current, 5000);
      reconnectAttemptRef.current += 1;
      setSessionStatus(`reconnecting in ${delay}ms`);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        reconnectTerminal(true, false);
      }, delay);
    }

    socket.addEventListener('open', () => {
      if (socketRef.current === socket) {
        reconnectAttemptRef.current = 0;
        setSessionStatus('connected');
      }
    });

    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) return;
      const message = JSON.parse(event.data);
      if (isStructured && message.at && message.at > (lastStructuredAtRef.current || '')) {
        lastStructuredAtRef.current = message.at;
        saveTranscriptCursor(sessionId, message.at);
      }
      if (isStructured) {
        const key = structuredEventKey(message);
        if (key) {
          if (seenStructuredEventsRef.current.has(key)) return;
          seenStructuredEventsRef.current.add(key);
          if (seenStructuredEventsRef.current.size > 6000) {
            const keep = Array.from(seenStructuredEventsRef.current).slice(-3000);
            seenStructuredEventsRef.current = new Set(keep);
          }
        }
      }
      if (message.type === 'connected') {
        setSessionStatus('connected');
        if (message.sessionId && message.sessionId !== sessionId) {
          onCanonicalSession?.(message.sessionId);
        }
      }
      if (message.type === 'output') {
        queueAgentOutput(message.data);
      }
      if (message.type === 'assistant_delta') {
        queueAgentOutput(message.content || '');
      }
      if (message.type === 'assistant_message') {
        flushAgentOutput();
        appendTranscript('agent', message.content || '', structuredEventKey(message));
      }
      if (message.type === 'thinking_delta') {
        queueAgentOutput(message.content ? `\n> ${message.content}` : '');
      }
      if (message.type === 'user') {
        flushAgentOutput();
        appendTranscript('user', message.content || '', structuredEventKey(message));
      }
      if (message.type === 'plan') {
        flushAgentOutput();
        const rows = (message.plan || []).map((item) => `${normalizeLifecycleStatus(item.status)}: ${item.step}`).join('\n');
        appendTranscript('agent', [message.explanation, rows].filter(Boolean).join('\n'), structuredEventKey(message));
      }
      if (message.type === 'tool_started') {
        flushAgentOutput();
        appendToolTranscript(message);
      }
      if (message.type === 'tool_completed') {
        flushAgentOutput();
        appendToolTranscript(message);
      }
      if (message.type === 'tool_output_delta') {
        appendToolTranscript(message);
      }
      if (message.type === 'status' && message.status) {
        flushAgentOutput();
        setSessionStatus(message.status);
      }
      if (message.type === 'exit') {
        setSessionStatus(`exited ${message.code ?? 'unknown'}`);
      }
      if (message.type === 'error') {
        flushAgentOutput();
        const errorMessage = message.message || message.content || 'Unknown error';
        setSessionStatus(`error: ${errorMessage}`);
      }
    });

    socket.addEventListener('close', () => {
      if (socketRef.current === socket) {
        flushAgentOutput();
        socketRef.current = null;
        setSessionStatus('reconnecting');
        scheduleReconnect();
      }
    });

    socket.addEventListener('error', () => {
      if (socketRef.current === socket) {
        flushAgentOutput();
        setSessionStatus('reconnecting');
        scheduleReconnect();
      }
    });
  }, [appendToolTranscript, appendTranscript, flushAgentOutput, isStructured, queueAgentOutput, sessionId]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    reconnectTerminal(true);

    function reconnectOnResume() {
      if (document.visibilityState === 'hidden') return;
      reconnectTerminal(false, false);
    }

    window.addEventListener('pageshow', reconnectOnResume);
    document.addEventListener('visibilitychange', reconnectOnResume);
    window.addEventListener('focus', reconnectOnResume);
    window.addEventListener('online', reconnectOnResume);

      return () => {
      shouldReconnectRef.current = false;
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      clearTimeout(outputFlushTimerRef.current);
      outputFlushTimerRef.current = null;
      flushAgentOutput();
      window.removeEventListener('pageshow', reconnectOnResume);
      document.removeEventListener('visibilitychange', reconnectOnResume);
      window.removeEventListener('focus', reconnectOnResume);
      window.removeEventListener('online', reconnectOnResume);
      socketRef.current?.close();
      socketRef.current = null;
      };
  }, [reconnectTerminal]);

  async function sendInput() {
    const text = String(input || '').trim();
    if (!text) return;
    const wasHidden = document.visibilityState === 'hidden';
    try {
      await sendSessionInput(sessionId, text, { keepalive: true });
      if (!isStructured) appendTranscript('user', text);
      setInput('');
      return;
    } catch {
      // Fallback to socket write when HTTP delivery is unavailable.
    }

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    const data = isStructured ? text : `${text}\r`;
    socketRef.current.send(JSON.stringify({ type: 'input', data }));
    if (!isStructured) appendTranscript('user', text);
    if (!wasHidden) setInput('');
  }

  function sendKey(key) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: 'key', key }));
  }

  async function copyMessage(content) {
    await navigator.clipboard?.writeText(content);
  }

  function handleTranscriptScroll(event) {
    const target = event.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
    if (shouldAutoScrollRef.current) setHasUnread(false);
  }

  function jumpToLatest() {
    shouldAutoScrollRef.current = true;
    transcriptEndRef.current?.scrollIntoView({ block: 'end' });
    setHasUnread(false);
  }

  return (
    <>
      <div
        className="transcript"
        onScroll={handleTranscriptScroll}
        ref={transcriptRef}
      >
        {isStructured && hasMoreHistory ? (
          <button className="load-older" onClick={loadOlderHistory} disabled={historyLoading}>
            {historyLoading ? 'Loading...' : 'Load older'}
          </button>
        ) : null}
        {transcript.map((item) => {
          const lifecycleItems = item.role === 'tool' ? null : parseLifecycleLines(item.content);
          return (
            <article className={`message ${item.role} ${item.role === 'tool' && item.toolStatus ? item.toolStatus : ''}`} key={item.id}>
              <div className="message-meta">
                <span>{messageRoleLabel(item.role)}</span>
                {item.role !== 'system' ? (
                  <div className="message-actions">
                    <button onClick={() => copyMessage(item.content)}>Copy</button>
                  </div>
                ) : null}
              </div>
              {item.role === 'tool' ? (
                <div className="message-body tool-body">
                  <details>
                    <summary>{toolSummaryLine(item.content)}</summary>
                    <div className="tool-details">
                      <RichMessageContent content={item.content} />
                    </div>
                  </details>
                </div>
              ) : (
                <div className="message-body">
                  {lifecycleItems ? (
                    <LifecycleChecklist items={lifecycleItems} />
                  ) : (
                    <RichMessageContent content={item.content} />
                  )}
                </div>
              )}
            </article>
          );
        })}
            {!transcript.length ? (
              <div className="empty-state">
                <p>No messages yet.</p>
                <span>Send a message to start this session.</span>
              </div>
            ) : null}
        <div ref={transcriptEndRef} />
      </div>
      {hasUnread ? (
        <button className="jump-latest" onClick={jumpToLatest}>Jump to latest</button>
      ) : null}
      <div className="composer-shell">
        {sessionStatus || historySyncStatus ? (
          <div className={`status-strip ${sessionStatus.startsWith('connected') || sessionStatus === 'idle' ? 'ready' : ''}`}>
            <span>{historySyncStatus ? `history ${historySyncStatus}` : 'history ready'}</span>
            <strong>{sessionStatus || 'connected'}</strong>
          </div>
        ) : null}
        <div className="prompt-row">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Message..." />
          <button className="primary" onClick={() => { sendInput(); }}>Send</button>
        </div>
        <div className="special-keys">
          {['up', 'down', 'enter'].map((key) => (
            <button key={key} onClick={() => sendKey(key)}>{key}</button>
          ))}
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
