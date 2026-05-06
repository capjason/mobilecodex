import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';

import { buildSessionId } from '../../helper/src/session-id.js';
import { listSessionMetadata, readSessionMetadata, writeSessionMetadata } from '../../helper/src/metadata.js';
import { readCodexThreadMessages, readCodexThreadMessagesSlice } from './codex-history.js';

const clientInfo = { name: 'mobilecodex', version: '0.1.0' };
const replayLimit = 500;
const defaultModel = 'gpt-5.5';

export class CodexStructuredManager {
  constructor({ stateDir }) {
    this.stateDir = stateDir;
    this.sessions = new Map();
  }

  async createSession({
    agent,
    repo,
    profile = 'normal',
    name,
    model = defaultModel,
    reasoningEffort = 'high',
    launchMode = 'new',
    resumeTarget = '',
    now = new Date()
  }) {
    if (agent !== 'codex') {
      return null;
    }

    const repoPath = await realpath(expandHome(repo));
    const repoName = basename(repoPath);

    if (launchMode === 'resume-id' && resumeTarget) {
      const existing = await this.findExistingResumeSession({ agent, repoPath, resumeTarget });
      if (existing) return existing;
    }

    const sessionId = name || await this.buildUniqueSessionId({ agent, repoName, date: now });
    const runtime = new CodexStructuredSession({
      stateDir: this.stateDir,
      metadata: {
        sessionId,
        agent,
        repoPath,
        repoName,
        profile,
        model,
        reasoningEffort,
        runtime: 'structured',
        createdFrom: 'mobile',
        createdAt: now.toISOString(),
        launchMode,
        resumeTarget: resumeTarget || '',
        status: 'running'
      }
    });

    await runtime.start({ launchMode, resumeTarget });
    this.sessions.set(sessionId, runtime);
    await runtime.persist();
    return runtime.metadata;
  }

  async findExistingResumeSession({ agent, repoPath, resumeTarget }) {
    const matchesResumeTarget = (metadata) => (
      metadata.runtime === 'structured' &&
      metadata.agent === agent &&
      metadata.repoPath === repoPath &&
      metadata.status === 'running' &&
      (metadata.threadId === resumeTarget || metadata.resumeTarget === resumeTarget)
    );

    for (const runtime of this.sessions.values()) {
      if (matchesResumeTarget(runtime.metadata)) {
        return runtime.metadata;
      }
    }

    const sessions = await listSessionMetadata({ stateDir: this.stateDir });
    return sessions
      .filter(matchesResumeTarget)
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))[0] || null;
  }

  async getSession(sessionId) {
    let runtime = this.sessions.get(sessionId);
    if (runtime) return runtime;

    const metadata = await readSessionMetadata({ stateDir: this.stateDir, sessionId });
    if (metadata.runtime !== 'structured' || metadata.agent !== 'codex') {
      return null;
    }

    const resumeTarget = metadata.threadId || metadata.resumeTarget || '';
    if (resumeTarget) {
      const canonical = await this.findExistingResumeSession({
        agent: metadata.agent,
        repoPath: metadata.repoPath,
        resumeTarget
      });
      if (canonical && canonical.sessionId !== metadata.sessionId) {
        return this.getOrStartRuntime(canonical);
      }
    }

    runtime = await this.getOrStartRuntime(metadata);
    return runtime;
  }

  async getOrStartRuntime(metadata) {
    const existing = this.sessions.get(metadata.sessionId);
    if (existing) return existing;

    const runtime = new CodexStructuredSession({ stateDir: this.stateDir, metadata });
    await runtime.start({ launchMode: 'resume-id', resumeTarget: metadata.threadId || metadata.resumeTarget || '' });
    this.sessions.set(metadata.sessionId, runtime);
    await runtime.persist();
    return runtime;
  }

  async stopSession(sessionId) {
    const metadata = await readSessionMetadata({ stateDir: this.stateDir, sessionId });
    const resumeTarget = metadata.threadId || metadata.resumeTarget || '';
    if (metadata.runtime === 'structured' && resumeTarget) {
      const canonical = await this.findExistingResumeSession({
        agent: metadata.agent,
        repoPath: metadata.repoPath,
        resumeTarget
      });
      if (canonical && canonical.sessionId !== sessionId) {
        sessionId = canonical.sessionId;
      }
    }

    const runtime = this.sessions.get(sessionId);
    if (runtime) {
      await runtime.stop();
      this.sessions.delete(sessionId);
      return runtime.metadata;
    }

    const targetMetadata = sessionId === metadata.sessionId
      ? metadata
      : await readSessionMetadata({ stateDir: this.stateDir, sessionId });
    if (targetMetadata.runtime !== 'structured') return null;
    const updated = { ...targetMetadata, status: 'stopped', stoppedAt: new Date().toISOString() };
    await writeSessionMetadata({ stateDir: this.stateDir, metadata: updated });
    return updated;
  }

  async sendInput(sessionId, text) {
    const runtime = await this.getSession(sessionId);
    if (!runtime) return false;
    await runtime.sendText(String(text || ''));
    return true;
  }

  async getSessionHistory(sessionId, { offset = 0, limit = 300 } = {}) {
    const metadata = await readSessionMetadata({ stateDir: this.stateDir, sessionId });
    if (metadata.runtime !== 'structured' || metadata.agent !== 'codex') {
      return { events: [], hasMore: false, nextOffset: 0 };
    }
    return readCodexThreadMessagesSlice(metadata.threadPath, { offset, limit });
  }

  async buildUniqueSessionId({ agent, repoName, date }) {
    const base = buildSessionId({ agent, repoName, date });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = attempt === 0
        ? base
        : `${base}-${String(date.getUTCSeconds()).padStart(2, '0')}-${attempt}`;
      try {
        await readSessionMetadata({ stateDir: this.stateDir, sessionId: candidate });
      } catch (error) {
        if (error.code === 'ENOENT') return candidate;
        throw error;
      }
    }
    return `${base}-${Date.now()}`;
  }
}

class CodexStructuredSession extends EventEmitter {
  constructor({ stateDir, metadata }) {
    super();
    this.stateDir = stateDir;
    this.metadata = metadata;
    this.proc = null;
    this.transport = null;
    this.threadId = metadata.threadId || null;
    this.currentTurnId = null;
    this.agentMessageDeltaSeen = new Set();
    this.events = [];
    this.ready = false;
  }

  async start({ launchMode, resumeTarget }) {
    if (this.ready) return;
    this.proc = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      cwd: this.metadata.repoPath,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.transport = new JsonRpcTransport(this.proc);
    this.transport.start();
    this.proc.stderr.on('data', (data) => {
      this.push({ type: 'system', content: data.toString().trim() });
    });
    this.proc.on('exit', () => {
      this.ready = false;
      this.metadata.status = 'stopped';
      this.push({ type: 'status', status: 'stopped' });
    });

    await this.transport.request('initialize', {
      clientInfo,
      capabilities: { experimentalApi: true }
    });
    this.transport.notify('initialized');
    this.wireNotifications();

    if (launchMode === 'resume-id' && resumeTarget) {
      await this.resumeThread(resumeTarget);
      await this.hydrateHistory();
      this.push({ type: 'status', status: 'ready', threadId: this.threadId });
    } else {
      await this.startThread();
    }
    this.ready = true;
  }

  async startThread() {
    const config = profileConfig(this.metadata.profile);
    const result = await this.transport.request('thread/start', {
      model: this.metadata.model || defaultModel,
      effort: normalizeReasoningEffort(this.metadata.reasoningEffort),
      cwd: this.metadata.repoPath,
      approvalPolicy: config.approvalPolicy,
      sandbox: config.sandbox,
      experimentalRawEvents: true,
      persistExtendedHistory: true,
      sandboxPolicy: config.sandboxPolicy
    });
    this.threadId = result.thread.id;
    this.metadata.threadId = result.thread.id;
    this.metadata.threadPath = result.thread.path;
    this.metadata.status = 'running';
    this.push({ type: 'status', status: 'ready', threadId: this.threadId });
  }

  async resumeThread(threadId) {
    const config = profileConfig(this.metadata.profile);
    const result = await this.transport.request('thread/resume', {
      threadId,
      model: this.metadata.model || defaultModel,
      effort: normalizeReasoningEffort(this.metadata.reasoningEffort),
      approvalPolicy: config.approvalPolicy,
      sandbox: config.sandbox,
      persistExtendedHistory: true
    });
    this.threadId = result.thread.id;
    this.metadata.threadId = result.thread.id;
    this.metadata.threadPath = result.thread.path;
    this.metadata.status = 'running';
  }

  async sendText(text) {
    if (!this.threadId) throw new Error('Codex thread is not ready');
    const input = [{ type: 'text', text, text_elements: [] }];
    this.push({ type: 'user', content: text });

    if (this.currentTurnId) {
      await this.transport.request('turn/steer', {
        threadId: this.threadId,
        expectedTurnId: this.currentTurnId,
        input
      });
      return;
    }

    const config = profileConfig(this.metadata.profile);
    const result = await this.transport.request('turn/start', {
      threadId: this.threadId,
      input,
      approvalPolicy: config.approvalPolicy,
      model: this.metadata.model || defaultModel,
      effort: normalizeReasoningEffort(this.metadata.reasoningEffort),
      sandboxPolicy: config.sandboxPolicy
    });
    this.currentTurnId = result.turn.id;
  }

  async stop() {
    this.metadata.status = 'stopped';
    this.metadata.stoppedAt = new Date().toISOString();
    await this.persist();
    this.proc?.kill('SIGTERM');
    setTimeout(() => this.proc?.kill('SIGKILL'), 3000).unref();
    this.push({ type: 'status', status: 'stopped' });
  }

  async persist() {
    await writeSessionMetadata({ stateDir: this.stateDir, metadata: this.metadata });
  }

  replay({ after = '' } = {}) {
    if (!after) return this.events;
    const afterMs = Date.parse(after);
    if (!Number.isFinite(afterMs)) return this.events;
    return this.events.filter((event) => {
      const eventMs = Date.parse(event.at || '');
      return !Number.isFinite(eventMs) || eventMs > afterMs;
    });
  }

  async hydrateHistory() {
    const history = await readCodexThreadMessages(this.metadata.threadPath);
    if (!history.length) return;
    this.events = history.slice(-replayLimit);
  }

  push(event) {
    const enriched = { ...event, at: new Date().toISOString() };
    this.events.push(enriched);
    if (this.events.length > replayLimit) this.events.shift();
    this.emit('event', enriched);
  }

  wireNotifications() {
    const methods = [
      'thread/started',
      'thread/status/changed',
      'turn/started',
      'turn/completed',
      'turn/plan/updated',
      'item/started',
      'item/completed',
      'item/agentMessage/delta',
      'item/plan/delta',
      'item/reasoning/textDelta',
      'item/reasoning/summaryTextDelta',
      'item/commandExecution/outputDelta',
      'item/fileChange/outputDelta',
      'error'
    ];

    for (const method of methods) {
      this.transport.onNotification(method, (params) => this.routeNotification(method, params));
    }

    this.transport.onServerRequest('item/commandExecution/requestApproval', async () => ({ decision: 'denied', reason: 'Mobile approval UI is not implemented yet.' }));
    this.transport.onServerRequest('item/fileChange/requestApproval', async () => ({ decision: 'denied', reason: 'Mobile approval UI is not implemented yet.' }));
    this.transport.onServerRequest('item/permissions/requestApproval', async () => ({ decision: 'denied', reason: 'Mobile approval UI is not implemented yet.' }));
    this.transport.onServerRequest('item/tool/requestUserInput', async () => ({ answers: [] }));
  }

  routeNotification(method, params) {
    if (method === 'turn/started') {
      this.currentTurnId = params.turn?.id || this.currentTurnId;
      this.push({ type: 'status', status: 'working' });
      return;
    }

    if (method === 'turn/completed') {
      this.currentTurnId = null;
      this.push({ type: 'status', status: 'idle' });
      return;
    }

    if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') {
      if (method === 'item/agentMessage/delta' && params.itemId) {
        this.agentMessageDeltaSeen.add(params.itemId);
      }
      this.push({ type: 'assistant_delta', content: params.delta || '' });
      return;
    }

    if (method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
      this.push({ type: 'thinking_delta', content: params.delta || '' });
      return;
    }

    if (method === 'turn/plan/updated') {
      this.push({ type: 'plan', explanation: params.explanation || '', plan: params.plan || [] });
      return;
    }

    if (method === 'item/started') {
      this.pushItem('tool_started', params.item);
      return;
    }

    if (method === 'item/completed') {
      this.pushItem('tool_completed', params.item);
      return;
    }

    if (method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta') {
      this.push({ type: 'tool_output_delta', itemId: params.itemId, content: params.delta || '' });
      return;
    }

    if (method === 'thread/status/changed') {
      this.push({ type: 'status', status: params.status?.type || 'unknown' });
      return;
    }

    if (method === 'error') {
      this.push({ type: 'error', content: params.error?.message || 'Codex error' });
    }
  }

  pushItem(type, item) {
    if (!item) return;
    if (item.type === 'userMessage') return;
    if (item.type === 'agentMessage') {
      if (type === 'tool_completed') {
        const hadDelta = item.id ? this.agentMessageDeltaSeen.has(item.id) : false;
        if (item.id) this.agentMessageDeltaSeen.delete(item.id);
        if (!hadDelta && item.text) {
          this.push({ type: 'assistant_message', content: item.text });
        }
      }
      return;
    }
    if (['commandExecution', 'fileChange', 'webSearch', 'mcpToolCall', 'collabAgentToolCall'].includes(item.type)) {
      this.push({ type, toolType: item.type, item: normalizeToolItem(item) });
    }
  }
}

export function normalizeToolItem(item) {
  return {
    ...item,
    callId: item.callId || item.call_id || item.id || ''
  };
}

class JsonRpcTransport {
  constructor(proc) {
    this.proc = proc;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandlers = new Map();
    this.serverRequestHandlers = new Map();
  }

  start() {
    const rl = createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => this.handleLine(line));
    this.proc.on('exit', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('Codex app-server exited'));
      }
      this.pending.clear();
    });
  }

  request(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method, params) {
    const message = params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onNotification(method, handler) {
    this.notificationHandlers.set(method, handler);
  }

  onServerRequest(method, handler) {
    this.serverRequestHandlers.set(method, handler);
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof message.id === 'number' && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }

    if (message.method && message.id === undefined) {
      this.notificationHandlers.get(message.method)?.(message.params);
      return;
    }

    if (message.method && message.id !== undefined) {
      const handler = this.serverRequestHandlers.get(message.method);
      if (!handler) {
        this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unhandled request: ${message.method}` } })}\n`);
        return;
      }
      handler(message.params).then(
        (result) => this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`),
        (error) => this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } })}\n`)
      );
    }
  }
}

function profileConfig(profile) {
  if (profile === 'bypass') {
    return { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } };
  }
  if (profile === 'safe_plan' || profile === 'review') {
    return { approvalPolicy: 'untrusted', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', access: { type: 'fullAccess' }, networkAccess: false } };
  }
  if (profile === 'full_auto') {
    return { approvalPolicy: 'never', sandbox: 'workspace-write', sandboxPolicy: null };
  }
  return { approvalPolicy: 'on-request', sandbox: 'workspace-write', sandboxPolicy: null };
}

function normalizeReasoningEffort(value) {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'high';
}

function expandHome(path) {
  if (path === '~') return process.env.HOME || path;
  if (path.startsWith('~/')) return `${process.env.HOME || '~'}${path.slice(1)}`;
  return path;
}
