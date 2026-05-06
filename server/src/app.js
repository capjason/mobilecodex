import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { listAgentHistorySessions } from '../../helper/src/agent-history.js';
import { createDoctorReport } from '../../helper/src/doctor.js';
import { getSessionDiff, getSessionStatus } from '../../helper/src/git-workflow.js';
import { defaultStateDir } from '../../helper/src/paths.js';
import { scanRepos } from '../../helper/src/scan-repos.js';
import { createSession, listSessions, restartSession, sendSessionInput, stopSession } from '../../helper/src/sessions.js';
import { CodexStructuredManager } from './codex-structured.js';
import { attachTerminalWebSocket } from './terminal.js';
import { attachStructuredChatWebSocket } from './structured-chat.js';

export function createApp({ services = defaultServices(), terminalService, staticDir = join(process.cwd(), 'dist') } = {}) {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res, services, staticDir);
    } catch (error) {
      writeJson(res, 500, {
        error: 'server_error',
        message: error.message
      });
    }
  });
  attachTerminalWebSocket(server, terminalService);
  if (services.structuredManager) {
    attachStructuredChatWebSocket(server, services.structuredManager);
  }
  return server;
}

function defaultServices() {
  const stateDir = process.env.MOBILECODEX_STATE_DIR || defaultStateDir();
  const structuredManager = new CodexStructuredManager({ stateDir });

  return {
    structuredManager,
    doctor: () => createDoctorReport(),
    scanRepos: ({ root, depth }) => scanRepos({ root, depth }),
    listAgentHistorySessions: ({ agent, repoPath }) => listAgentHistorySessions({ agent, repoPath }),
    listSessions: async () => dedupeRunningThreadSessions(await listSessions({ stateDir })),
    createSession: async (request) => (
      await structuredManager.createSession(request)
    ) || createSession({ stateDir, ...request }),
    stopSession: async ({ sessionId }) => (
      await structuredManager.stopSession(sessionId)
    ) || stopSession({ stateDir, sessionId }),
    sendInput: async ({ sessionId, text }) => (
      await structuredManager.sendInput(sessionId, text)
    ) || sendSessionInput({ stateDir, sessionId, text }),
    restartSession: ({ sessionId }) => restartSession({ stateDir, sessionId }),
    getSessionHistory: ({ sessionId, offset, limit }) => structuredManager.getSessionHistory(sessionId, { offset, limit }),
    getSessionStatus: ({ sessionId }) => getSessionStatus({ stateDir, sessionId }),
    getSessionDiff: ({ sessionId }) => getSessionDiff({ stateDir, sessionId })
  };
}

export function dedupeRunningThreadSessions(sessions) {
  const rows = [];
  const keyedIndex = new Map();

  for (const session of sessions) {
    const key = runningThreadKey(session);
    if (!key) {
      rows.push(session);
      continue;
    }

    const previousIndex = keyedIndex.get(key);
    if (previousIndex === undefined) {
      keyedIndex.set(key, rows.push(session) - 1);
      continue;
    }

    const previous = rows[previousIndex];
    if (new Date(session.createdAt || 0) >= new Date(previous.createdAt || 0)) {
      rows[previousIndex] = session;
    }
  }

  return rows;
}

function runningThreadKey(session) {
  const threadTarget = session.threadId || session.resumeTarget;
  if (session.status !== 'running' || !threadTarget) return '';
  return [session.agent, session.repoPath, threadTarget].join(':');
}

async function route(req, res, services, staticDir) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/health') {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && path === '/api/doctor') {
    writeJson(res, 200, await services.doctor());
    return;
  }

  if (req.method === 'GET' && path === '/api/repos') {
    writeJson(
      res,
      200,
      await services.scanRepos({
        root: url.searchParams.get('root') || process.cwd(),
        depth: Number(url.searchParams.get('depth') || 2)
      })
    );
    return;
  }

  if (req.method === 'GET' && path === '/api/sessions') {
    writeJson(res, 200, await services.listSessions());
    return;
  }

  if (req.method === 'GET' && path === '/api/agent-sessions') {
    writeJson(
      res,
      200,
      await services.listAgentHistorySessions({
        agent: url.searchParams.get('agent') || 'codex',
        repoPath: url.searchParams.get('repo') || ''
      })
    );
    return;
  }

  if (req.method === 'POST' && path === '/api/sessions') {
    writeJson(res, 200, await services.createSession(await readJson(req)));
    return;
  }

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/([^/]+)$/);
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    const action = sessionMatch[2];

    if (req.method === 'GET' && action === 'status') {
      writeJson(res, 200, await services.getSessionStatus({ sessionId }));
      return;
    }

    if (req.method === 'GET' && action === 'history') {
      writeJson(
        res,
        200,
        await services.getSessionHistory({
          sessionId,
          offset: Number(url.searchParams.get('offset') || 0),
          limit: Number(url.searchParams.get('limit') || 300)
        })
      );
      return;
    }

    if (req.method === 'GET' && action === 'diff') {
      writeJson(res, 200, await services.getSessionDiff({ sessionId }));
      return;
    }

    if (req.method === 'POST' && action === 'stop') {
      writeJson(res, 200, await services.stopSession({ sessionId }));
      return;
    }

    if (req.method === 'POST' && action === 'input') {
      const body = await readJson(req);
      writeJson(res, 200, await services.sendInput({ sessionId, text: body.text || '' }));
      return;
    }

    if (req.method === 'POST' && action === 'restart') {
      writeJson(res, 200, await services.restartSession({ sessionId }));
      return;
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const served = await tryServeStatic(req, res, staticDir);
    if (served) {
      return;
    }
  }

  writeJson(res, 404, {
    error: 'not_found'
  });
}

async function tryServeStatic(req, res, staticDir) {
  const url = new URL(req.url, 'http://localhost');
  const safePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(staticDir, safePath);

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return false;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': contentType(filePath),
      ...cacheHeaders(filePath)
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    if (!url.pathname.startsWith('/api/')) {
      try {
        const body = await readFile(join(staticDir, 'index.html'));
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store'
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function contentType(filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png'
  };

  return types[extname(filePath)] || 'application/octet-stream';
}

function cacheHeaders(filePath) {
  const extension = extname(filePath);
  if (extension === '.html' || extension === '.webmanifest' || filePath.endsWith('/sw.js')) {
    return { 'cache-control': 'no-store' };
  }
  return { 'cache-control': 'public, max-age=31536000, immutable' };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function writeJson(res, status, value) {
  setCorsHeaders(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(value)}\n`);
}

function setCorsHeaders(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}
