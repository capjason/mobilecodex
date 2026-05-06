import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { createApp, dedupeRunningThreadSessions } from '../src/app.js';

test('server exposes helper operations as JSON APIs', async () => {
  const calls = [];
  const app = createApp({
    services: {
      doctor: async () => ({ tmux: true, codex: true, claude: false, git: true, platform: 'linux' }),
      scanRepos: async ({ root, depth }) => {
        calls.push(['scanRepos', root, depth]);
        return [{ name: 'travel-app', path: '/workspace/travel-app' }];
      },
      listSessions: async () => [{ sessionId: 'codex__travel-app__0430-1612', status: 'running' }],
      listAgentHistorySessions: async ({ agent, repoPath }) => {
        calls.push(['agentHistory', agent, repoPath]);
        return [{ id: 'codex-history-a', agent, resumeTarget: 'codex-history-a', title: 'Resume me' }];
      },
      createSession: async (request) => {
        calls.push(['createSession', request.agent, request.repo, request.profile]);
        return { sessionId: 'codex__travel-app__0430-1800', status: 'running' };
      },
      getSessionStatus: async ({ sessionId }) => {
        calls.push(['status', sessionId]);
        return { repoPath: '/workspace/travel-app', modified: ['src/app.ts'], staged: [], deleted: [], untracked: [] };
      },
      getSessionDiff: async ({ sessionId }) => {
        calls.push(['diff', sessionId]);
        return { repoPath: '/workspace/travel-app', stat: 'src/app.ts | 1 +', diff: 'diff --git a/src/app.ts b/src/app.ts\n' };
      },
      stopSession: async ({ sessionId }) => {
        calls.push(['stop', sessionId]);
        return { sessionId, status: 'stopped' };
      },
      sendInput: async ({ sessionId, text }) => {
        calls.push(['input', sessionId, text]);
        return { ok: true };
      },
      restartSession: async ({ sessionId }) => {
        calls.push(['restart', sessionId]);
        return { sessionId, status: 'running' };
      }
    }
  });

  app.listen(0);
  await once(app, 'listening');
  const baseUrl = `http://127.0.0.1:${app.address().port}`;

  try {
    assert.equal((await getJson(`${baseUrl}/api/doctor`)).platform, 'linux');
    assert.deepEqual(await getJson(`${baseUrl}/api/repos?root=/workspace&depth=2`), [
      { name: 'travel-app', path: '/workspace/travel-app' }
    ]);
    assert.deepEqual(await getJson(`${baseUrl}/api/sessions`), [
      { sessionId: 'codex__travel-app__0430-1612', status: 'running' }
    ]);
    assert.deepEqual(await getJson(`${baseUrl}/api/agent-sessions?agent=codex&repo=/workspace/travel-app`), [
      { id: 'codex-history-a', agent: 'codex', resumeTarget: 'codex-history-a', title: 'Resume me' }
    ]);

    const created = await postJson(`${baseUrl}/api/sessions`, {
      agent: 'codex',
      repo: '/workspace/travel-app',
      profile: 'normal'
    });
    assert.equal(created.sessionId, 'codex__travel-app__0430-1800');

    const status = await getJson(`${baseUrl}/api/sessions/codex__travel-app__0430-1612/status`);
    assert.deepEqual(status.modified, ['src/app.ts']);

    const diff = await getJson(`${baseUrl}/api/sessions/codex__travel-app__0430-1612/diff`);
    assert.equal(diff.stat, 'src/app.ts | 1 +');

    assert.equal((await postJson(`${baseUrl}/api/sessions/codex__travel-app__0430-1612/stop`, {})).status, 'stopped');
    assert.equal((await postJson(`${baseUrl}/api/sessions/codex__travel-app__0430-1612/input`, { text: 'continue' })).ok, true);
    assert.equal((await postJson(`${baseUrl}/api/sessions/codex__travel-app__0430-1612/restart`, {})).status, 'running');

    assert.deepEqual(calls, [
      ['scanRepos', '/workspace', 2],
      ['agentHistory', 'codex', '/workspace/travel-app'],
      ['createSession', 'codex', '/workspace/travel-app', 'normal'],
      ['status', 'codex__travel-app__0430-1612'],
      ['diff', 'codex__travel-app__0430-1612'],
      ['stop', 'codex__travel-app__0430-1612'],
      ['input', 'codex__travel-app__0430-1612', 'continue'],
      ['restart', 'codex__travel-app__0430-1612']
    ]);
  } finally {
    app.close();
  }
});

test('server dedupes repeated running sessions for the same resumed thread', () => {
  const sessions = dedupeRunningThreadSessions([
    {
      sessionId: 'codex__workspace__0501-1200',
      agent: 'codex',
      repoPath: '/workspace',
      status: 'running',
      runtime: 'structured',
      threadId: 'thread-a',
      createdAt: '2026-05-01T12:00:00.000Z'
    },
    {
      sessionId: 'codex__workspace__0501-1210',
      agent: 'codex',
      repoPath: '/workspace',
      status: 'running',
      runtime: 'structured',
      threadId: 'thread-a',
      createdAt: '2026-05-01T12:10:00.000Z'
    },
    {
      sessionId: 'codex__mobilecodex__0501-1211',
      agent: 'codex',
      repoPath: '/workspace/mobilecodex',
      status: 'running',
      runtime: 'structured',
      threadId: 'thread-b',
      createdAt: '2026-05-01T12:11:00.000Z'
    }
  ]);

  assert.deepEqual(sessions.map((session) => session.sessionId), [
    'codex__workspace__0501-1210',
    'codex__mobilecodex__0501-1211'
  ]);
});

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return response.json();
}
