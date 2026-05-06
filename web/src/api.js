const jsonHeaders = { 'content-type': 'application/json' };

export async function getDoctor() {
  return getJson('/api/doctor');
}

export async function scanRepos(root, depth = 2) {
  const params = new URLSearchParams({ root, depth: String(depth) });
  return getJson(`/api/repos?${params}`);
}

export async function listSessions() {
  return getJson('/api/sessions');
}

export async function listAgentSessions({ agent, repo }) {
  const params = new URLSearchParams({ agent, repo });
  return getJson(`/api/agent-sessions?${params}`);
}

export async function createSession(request) {
  return postJson('/api/sessions', request);
}

export async function stopSession(sessionId) {
  return postJson(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, {});
}

export async function restartSession(sessionId) {
  return postJson(`/api/sessions/${encodeURIComponent(sessionId)}/restart`, {});
}

export async function sendSessionInput(sessionId, text, { keepalive = false } = {}) {
  return postJson(`/api/sessions/${encodeURIComponent(sessionId)}/input`, { text }, { keepalive });
}

export async function getSessionHistory(sessionId, { offset = 0, limit = 300 } = {}) {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  return getJson(`/api/sessions/${encodeURIComponent(sessionId)}/history?${params}`);
}

export function terminalWebSocketUrl(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/sessions/${encodeURIComponent(sessionId)}/terminal`;
}

export function structuredChatWebSocketUrl(sessionId, { after = '' } = {}) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  if (after) params.set('after', after);
  const query = params.toString();
  return `${protocol}//${window.location.host}/ws/sessions/${encodeURIComponent(sessionId)}/chat${query ? `?${query}` : ''}`;
}

async function getJson(url) {
  const response = await fetch(url);
  return readResponse(response);
}

async function postJson(url, body, options = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body),
    keepalive: Boolean(options.keepalive)
  });
  return readResponse(response);
}

async function readResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}
