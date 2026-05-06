import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { listAgentHistorySessions } from '../src/agent-history.js';

test('lists codex history sessions grouped by session id', async (t) => {
  const home = t.mock.fn(() => '');
  const temp = await mkdtemp(join(tmpdir(), 'mobilecodex-history-'));
  const codexDir = join(temp, '.codex');
  await mkdir(codexDir, { recursive: true });
  await writeFile(
    join(codexDir, 'history.jsonl'),
    [
      JSON.stringify({ session_id: 'codex-a', ts: 20, text: 'latest prompt' }),
      JSON.stringify({ session_id: 'codex-a', ts: 10, text: 'older prompt' }),
      JSON.stringify({ session_id: 'codex-b', ts: 30, text: 'other prompt' })
    ].join('\n'),
    'utf8'
  );
  const codexSessionDir = join(codexDir, 'sessions', '2026', '04', '30');
  await mkdir(codexSessionDir, { recursive: true });
  await writeFile(
    join(codexSessionDir, 'codex-a.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { id: 'codex-a', cwd: '/workspace/app', timestamp: '1970-01-01T00:00:10.000Z' } }),
    'utf8'
  );
  await writeFile(
    join(codexSessionDir, 'codex-b.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { id: 'codex-b', cwd: '/workspace/other', timestamp: '1970-01-01T00:00:30.000Z' } }),
    'utf8'
  );

  assert.equal(home(), '');
  const sessions = await listAgentHistorySessions({ agent: 'codex', repoPath: '/workspace/app', homeDir: temp });
  assert.deepEqual(sessions, [
    {
      id: 'codex-a',
      agent: 'codex',
      title: 'latest prompt',
      lastActivityAt: '1970-01-01T00:00:20.000Z',
      resumeTarget: 'codex-a',
      repoPath: '/workspace/app',
      source: 'codex-history'
    }
  ]);

  const allSessions = await listAgentHistorySessions({ agent: 'codex', repoPath: '~', homeDir: temp });
  assert.deepEqual(allSessions.map((session) => [session.id, session.repoPath]), [
    ['codex-b', '/workspace/other'],
    ['codex-a', '/workspace/app']
  ]);
});

test('lists claude project sessions for the selected working directory', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'mobilecodex-history-'));
  const projectDir = join(temp, '.claude', 'projects', '-workspace-app');
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'claude-a.jsonl'),
    [
      JSON.stringify({ type: 'user', cwd: '/workspace/app', sessionId: 'claude-a', timestamp: '2026-04-30T01:00:00.000Z', message: { content: 'first prompt' } }),
      JSON.stringify({ type: 'user', cwd: '/workspace/app', sessionId: 'claude-a', timestamp: '2026-04-30T02:00:00.000Z', message: { content: 'latest prompt' } })
    ].join('\n'),
    'utf8'
  );

  const sessions = await listAgentHistorySessions({ agent: 'claude', repoPath: '/workspace/app', homeDir: temp });
  assert.deepEqual(sessions, [
    {
      id: 'claude-a',
      agent: 'claude',
      title: 'latest prompt',
      lastActivityAt: '2026-04-30T02:00:00.000Z',
      resumeTarget: 'claude-a',
      repoPath: '/workspace/app',
      source: 'claude-history'
    }
  ]);

  const allSessions = await listAgentHistorySessions({ agent: 'claude', repoPath: '~', homeDir: temp });
  assert.deepEqual(allSessions.map((session) => [session.id, session.repoPath]), [
    ['claude-a', '/workspace/app']
  ]);
});
