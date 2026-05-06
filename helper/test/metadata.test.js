import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  listSessionMetadata,
  readSessionMetadata,
  writeSessionMetadata
} from '../src/metadata.js';

test('writeSessionMetadata persists sessions under the configured state directory', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));

  try {
    await writeSessionMetadata({
      stateDir,
      metadata: {
        sessionId: 'codex__travel-app__0430-1612',
        agent: 'codex',
        repoPath: '/tmp/travel-app',
        repoName: 'travel-app',
        profile: 'normal',
        model: 'default',
        createdFrom: 'mobile',
        createdAt: '2026-04-30T08:12:00.000Z',
        launchCommand: 'codex',
        tmuxSession: 'codex__travel-app__0430-1612',
        extraArgs: []
      }
    });

    const loaded = await readSessionMetadata({
      stateDir,
      sessionId: 'codex__travel-app__0430-1612'
    });
    const listed = await listSessionMetadata({ stateDir });

    assert.equal(loaded.repoName, 'travel-app');
    assert.deepEqual(listed.map((session) => session.sessionId), ['codex__travel-app__0430-1612']);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

