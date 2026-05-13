import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { sessionsDir } from '../../helper/src/paths.js';
import { writeSessionMetadata } from '../../helper/src/metadata.js';
import { CodexStructuredManager } from '../src/codex-structured.js';

test('structured history falls back from legacy session metadata via resume target', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-'));
  try {
    const threadDir = join(stateDir, 'threads');
    await mkdir(threadDir, { recursive: true });
    const threadPath = join(threadDir, 'thread-a.jsonl');
    await writeFile(
      threadPath,
      `${JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-05-01T12:00:00.000Z',
        payload: { type: 'user_message', message: 'hello from legacy session' }
      })}\n`,
      'utf8'
    );

    await mkdir(sessionsDir(stateDir), { recursive: true });
    await writeSessionMetadata({
      stateDir,
      metadata: {
        sessionId: 'codex__nous__0430-1146',
        agent: 'codex',
        repoPath: '/home/jason/workspace/Nous',
        status: 'stopped',
        resumeTarget: 'thread-a'
      }
    });
    await writeSessionMetadata({
      stateDir,
      metadata: {
        sessionId: 'codex__workspace__0502-0410',
        agent: 'codex',
        runtime: 'structured',
        repoPath: '/home/jason/workspace',
        status: 'running',
        threadId: 'thread-a',
        resumeTarget: 'thread-a',
        threadPath,
        createdAt: '2026-05-02T04:10:54.166Z'
      }
    });

    const manager = new CodexStructuredManager({ stateDir });
    const history = await manager.getSessionHistory('codex__nous__0430-1146', { offset: 0, limit: 10 });
    assert.equal(history.events.length, 1);
    assert.equal(history.events[0].type, 'user');
    assert.equal(history.events[0].content, 'hello from legacy session');
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
