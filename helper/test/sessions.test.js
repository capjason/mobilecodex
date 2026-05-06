import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { createSession, listSessions, restartSession, stopSession } from '../src/sessions.js';
import { writeSessionMetadata } from '../src/metadata.js';

test('listSessions merges metadata with live tmux session names', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));

  try {
    await writeSessionMetadata({
      stateDir,
      metadata: baseMetadata('codex__travel-app__0430-1612')
    });
    await writeSessionMetadata({
      stateDir,
      metadata: baseMetadata('claude__camera-ui__0430-1620')
    });

    const sessions = await listSessions({
      stateDir,
      listTmuxSessions: async () => ['codex__travel-app__0430-1612']
    });

    assert.deepEqual(
      sessions.map((session) => [session.sessionId, session.status]),
      [
        ['claude__camera-ui__0430-1620', 'missing'],
        ['codex__travel-app__0430-1612', 'running']
      ]
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('listSessions marks stale running metadata as missing when tmux session is gone', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));

  try {
    await writeSessionMetadata({
      stateDir,
      metadata: {
        ...baseMetadata('codex__travel-app__0430-1612'),
        status: 'running'
      }
    });

    const sessions = await listSessions({
      stateDir,
      listTmuxSessions: async () => []
    });

    assert.equal(sessions[0].status, 'missing');
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('createSession starts tmux, sends initial prompt, and writes metadata', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const repo = join(stateDir, 'Travel App');
  const calls = [];

  try {
    await mkdir(repo, { recursive: true });

    const metadata = await createSession({
      stateDir,
      agent: 'codex',
      repo,
      profile: 'normal',
      name: 'codex__travel-app__0430-1612',
      model: 'default',
      initialPrompt: '继续当前任务',
      now: new Date('2026-04-30T08:12:00.000Z'),
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    const saved = JSON.parse(
      await readFile(join(stateDir, 'sessions', 'codex__travel-app__0430-1612.json'), 'utf8')
    );

    assert.equal(metadata.repoName, 'Travel App');
    assert.equal(saved.launchCommand, "codex '--sandbox' 'workspace-write' '--ask-for-approval' 'on-request'");
    assert.deepEqual(calls, [
      [
        'tmux',
        [
          'new-session',
          '-d',
          '-s',
          'codex__travel-app__0430-1612',
          "cd '/tmp/mobilecodex-state-PLACEHOLDER/Travel App' && codex '--sandbox' 'workspace-write' '--ask-for-approval' 'on-request'"
        ]
      ],
      ['tmux', ['send-keys', '-t', 'codex__travel-app__0430-1612', '-l', '继续当前任务']],
      ['tmux', ['send-keys', '-t', 'codex__travel-app__0430-1612', 'Enter']]
    ].map((call) => replaceStateDir(call, stateDir)));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('createSession can launch codex resume picker', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const repo = join(stateDir, 'Travel App');
  const calls = [];

  try {
    await mkdir(repo, { recursive: true });

    const metadata = await createSession({
      stateDir,
      agent: 'codex',
      repo,
      profile: 'normal',
      name: 'codex__travel-app__0430-1700',
      launchMode: 'resume-picker',
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    assert.equal(metadata.launchMode, 'resume-picker');
    assert.equal(metadata.launchCommand, "codex '--sandbox' 'workspace-write' '--ask-for-approval' 'on-request' resume");
    assert.deepEqual(calls, [
      [
        'tmux',
        [
          'new-session',
          '-d',
          '-s',
          'codex__travel-app__0430-1700',
          "cd '/tmp/mobilecodex-state-PLACEHOLDER/Travel App' && codex '--sandbox' 'workspace-write' '--ask-for-approval' 'on-request' resume"
        ]
      ]
    ].map((call) => replaceStateDir(call, stateDir)));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('createSession can resume a specific codex conversation by id', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const repo = join(stateDir, 'Travel App');
  const calls = [];

  try {
    await mkdir(repo, { recursive: true });

    const metadata = await createSession({
      stateDir,
      agent: 'codex',
      repo,
      profile: 'normal',
      name: 'codex__travel-app__0430-1710',
      launchMode: 'resume-id',
      resumeTarget: '8b3f-session-name',
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    assert.equal(metadata.resumeTarget, '8b3f-session-name');
    assert.equal(metadata.launchCommand, "codex '--sandbox' 'workspace-write' '--ask-for-approval' 'on-request' resume '8b3f-session-name'");
    assert.deepEqual(calls, [
      [
        'tmux',
        [
          'new-session',
          '-d',
          '-s',
          'codex__travel-app__0430-1710',
          "cd '/tmp/mobilecodex-state-PLACEHOLDER/Travel App' && codex '--sandbox' 'workspace-write' '--ask-for-approval' 'on-request' resume '8b3f-session-name'"
        ]
      ]
    ].map((call) => replaceStateDir(call, stateDir)));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('createSession maps safe plan and full auto profiles to agent permission flags', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const repo = join(stateDir, 'Travel App');
  const calls = [];

  try {
    await mkdir(repo, { recursive: true });

    await createSession({
      stateDir,
      agent: 'codex',
      repo,
      profile: 'safe_plan',
      name: 'codex__travel-app__0430-1720',
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    await createSession({
      stateDir,
      agent: 'claude',
      repo,
      profile: 'full_auto',
      name: 'claude__travel-app__0430-1721',
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    assert.deepEqual(calls, [
      [
        'tmux',
        [
          'new-session',
          '-d',
          '-s',
          'codex__travel-app__0430-1720',
          "cd '/tmp/mobilecodex-state-PLACEHOLDER/Travel App' && codex '--sandbox' 'read-only' '--ask-for-approval' 'untrusted'"
        ]
      ],
      [
        'tmux',
        [
          'new-session',
          '-d',
          '-s',
          'claude__travel-app__0430-1721',
          "cd '/tmp/mobilecodex-state-PLACEHOLDER/Travel App' && claude '--permission-mode' 'auto'"
        ]
      ]
    ].map((call) => replaceStateDir(call, stateDir)));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('createSession exposes highest permission bypass profile for both agents', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const repo = join(stateDir, 'Travel App');
  const calls = [];

  try {
    await mkdir(repo, { recursive: true });

    await createSession({
      stateDir,
      agent: 'codex',
      repo,
      profile: 'bypass',
      name: 'codex__travel-app__0430-1730',
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    await createSession({
      stateDir,
      agent: 'claude',
      repo,
      profile: 'bypass',
      name: 'claude__travel-app__0430-1731',
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    assert.deepEqual(calls, [
      [
        'tmux',
        [
          'new-session',
          '-d',
          '-s',
          'codex__travel-app__0430-1730',
          "cd '/tmp/mobilecodex-state-PLACEHOLDER/Travel App' && codex '--dangerously-bypass-approvals-and-sandbox'"
        ]
      ],
      [
        'tmux',
        [
          'new-session',
          '-d',
          '-s',
          'claude__travel-app__0430-1731',
          "cd '/tmp/mobilecodex-state-PLACEHOLDER/Travel App' && claude '--dangerously-skip-permissions'"
        ]
      ]
    ].map((call) => replaceStateDir(call, stateDir)));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('createSession expands home directory in launch directory', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const home = join(stateDir, 'home');
  const repo = join(home, 'project');
  const calls = [];
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = home;
    await mkdir(repo, { recursive: true });

    await createSession({
      stateDir,
      agent: 'codex',
      repo: '~/project',
      profile: 'normal',
      name: 'codex__project__0430-1732',
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    assert.deepEqual(calls, [
      [
        'tmux',
        [
          'new-session',
          '-d',
          '-s',
          'codex__project__0430-1732',
          "cd '/tmp/mobilecodex-state-PLACEHOLDER/home/project' && codex '--sandbox' 'workspace-write' '--ask-for-approval' 'on-request'"
        ]
      ]
    ].map((call) => replaceStateDir(call, stateDir)));
  } finally {
    process.env.HOME = originalHome;
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('stopSession kills tmux and marks metadata as stopped', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const calls = [];

  try {
    await writeSessionMetadata({
      stateDir,
      metadata: baseMetadata('codex__travel-app__0430-1612')
    });

    const metadata = await stopSession({
      stateDir,
      sessionId: 'codex__travel-app__0430-1612',
      now: new Date('2026-04-30T09:00:00.000Z'),
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    assert.equal(metadata.status, 'stopped');
    assert.equal(metadata.stoppedAt, '2026-04-30T09:00:00.000Z');
    assert.deepEqual(calls, [
      ['tmux', ['kill-session', '-t', 'codex__travel-app__0430-1612']]
    ]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('restartSession starts tmux from existing metadata and marks it running', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-state-'));
  const calls = [];

  try {
    await writeSessionMetadata({
      stateDir,
      metadata: {
        ...baseMetadata('codex__travel-app__0430-1612'),
        status: 'stopped',
        stoppedAt: '2026-04-30T09:00:00.000Z',
        extraArgs: ['--model', 'gpt-5.2']
      }
    });

    const metadata = await restartSession({
      stateDir,
      sessionId: 'codex__travel-app__0430-1612',
      now: new Date('2026-04-30T10:00:00.000Z'),
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '' };
      }
    });

    assert.equal(metadata.status, 'running');
    assert.equal(metadata.restartedAt, '2026-04-30T10:00:00.000Z');
    assert.deepEqual(calls, [
      [
        'tmux',
        [
          'new-session',
          '-d',
          '-s',
          'codex__travel-app__0430-1612',
          "cd '/tmp/travel-app' && codex '--sandbox' 'workspace-write' '--ask-for-approval' 'on-request' '--model' 'gpt-5.2'"
        ]
      ]
    ]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

function baseMetadata(sessionId) {
  const repoName = sessionId.includes('camera-ui') ? 'camera-ui' : 'travel-app';

  return {
    sessionId,
    agent: sessionId.startsWith('claude') ? 'claude' : 'codex',
    repoPath: `/tmp/${repoName}`,
    repoName,
    profile: 'normal',
    model: 'default',
    createdFrom: 'mobile',
    createdAt: '2026-04-30T08:12:00.000Z',
    launchCommand: sessionId.startsWith('claude') ? 'claude' : 'codex',
    tmuxSession: sessionId,
    extraArgs: []
  };
}

function replaceStateDir([command, args], stateDir) {
  return [
    command,
    args.map((value) =>
      typeof value === 'string' ? value.replace('/tmp/mobilecodex-state-PLACEHOLDER', stateDir) : value
    )
  ];
}
