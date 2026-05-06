import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { getSessionDiff, getSessionStatus, parsePorcelainStatus } from '../src/git-workflow.js';
import { writeSessionMetadata } from '../src/metadata.js';

test('parsePorcelainStatus groups changed files for mobile display', () => {
  const status = parsePorcelainStatus([
    ' M src/auth/login.ts',
    'M  src/api/session.ts',
    ' D src/old.ts',
    '?? test/auth.test.ts',
    'R  src/a.ts -> src/b.ts'
  ].join('\n'));

  assert.deepEqual(status, {
    modified: ['src/auth/login.ts'],
    staged: ['src/api/session.ts', 'src/b.ts'],
    deleted: ['src/old.ts'],
    untracked: ['test/auth.test.ts'],
    renamed: [{ from: 'src/a.ts', to: 'src/b.ts' }]
  });
});

test('getSessionStatus runs git status in the session repo', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const calls = [];

  try {
    await writeSessionMetadata({
      stateDir,
      metadata: baseMetadata()
    });

    const status = await getSessionStatus({
      stateDir,
      sessionId: 'codex__travel-app__0430-1612',
      runner: async (command, args, options) => {
        calls.push([command, args, options.cwd]);
        return { stdout: ' M src/auth/login.ts\n?? test/auth.test.ts\n' };
      }
    });

    assert.equal(status.repoPath, '/tmp/travel-app');
    assert.deepEqual(status.modified, ['src/auth/login.ts']);
    assert.deepEqual(status.untracked, ['test/auth.test.ts']);
    assert.deepEqual(calls, [
      ['git', ['status', '--porcelain=v1'], '/tmp/travel-app']
    ]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('getSessionDiff returns diff stat and raw diff for the session repo', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const calls = [];

  try {
    await writeSessionMetadata({
      stateDir,
      metadata: baseMetadata()
    });

    const diff = await getSessionDiff({
      stateDir,
      sessionId: 'codex__travel-app__0430-1612',
      runner: async (command, args, options) => {
        calls.push([command, args, options.cwd]);
        if (args.includes('--stat')) {
          return { stdout: ' src/auth/login.ts | 2 +-\n' };
        }
        return { stdout: 'diff --git a/src/auth/login.ts b/src/auth/login.ts\n' };
      }
    });

    assert.deepEqual(diff, {
      repoPath: '/tmp/travel-app',
      stat: 'src/auth/login.ts | 2 +-',
      diff: 'diff --git a/src/auth/login.ts b/src/auth/login.ts\n'
    });
    assert.deepEqual(calls, [
      ['git', ['diff', '--stat'], '/tmp/travel-app'],
      ['git', ['diff'], '/tmp/travel-app']
    ]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

function baseMetadata() {
  return {
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
  };
}

