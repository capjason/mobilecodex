import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';

import { readSessionMetadata, listSessionMetadata, writeSessionMetadata } from './metadata.js';
import { runCommand } from './process.js';
import { buildSessionId } from './session-id.js';
import { quoteShellArg } from './shell.js';
import { listTmuxSessions as listLiveTmuxSessions } from './tmux.js';

const AGENT_COMMANDS = {
  codex: 'codex',
  claude: 'claude'
};

export async function listSessions({
  stateDir,
  listTmuxSessions = () => listLiveTmuxSessions()
}) {
  const [metadataList, liveSessions] = await Promise.all([
    listSessionMetadata({ stateDir }),
    listTmuxSessions()
  ]);
  const live = new Set(liveSessions);

  return metadataList
    .map((metadata) => ({
      ...metadata,
      status: sessionStatus({ metadata, live })
    }))
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

function sessionStatus({ metadata, live }) {
  if (metadata.runtime === 'structured') return metadata.status || 'running';
  if (live.has(metadata.tmuxSession)) return 'running';
  if (metadata.status === 'stopped') return 'stopped';
  return 'missing';
}

export async function createSession({
  stateDir,
  agent,
  repo,
  profile = 'normal',
  name,
  model = 'default',
  reasoningEffort = 'high',
  initialPrompt = '',
  extraArgs = [],
  launchMode = 'new',
  resumeTarget = '',
  now = new Date(),
  runner = runCommand
}) {
  if (!AGENT_COMMANDS[agent]) {
    throw new Error(`Unsupported agent: ${agent}`);
  }

  const repoPath = await realpath(expandHome(repo));
  const repoName = basename(repoPath);
  const sessionId = name || buildSessionId({ agent, repoName, date: now });
  const tmuxSession = sessionId;
  const agentCommand = buildAgentCommand({ agent, profile, launchMode, resumeTarget, extraArgs });
  const command = buildLaunchCommand({ repoPath, agentCommand });

  await runner('tmux', ['new-session', '-d', '-s', tmuxSession, command]);

  if (initialPrompt.trim()) {
    await runner('tmux', ['send-keys', '-t', tmuxSession, '-l', initialPrompt]);
    await runner('tmux', ['send-keys', '-t', tmuxSession, 'Enter']);
  }

  const metadata = {
    sessionId,
    agent,
    repoPath,
    repoName,
    profile,
    model,
    reasoningEffort,
    createdFrom: 'mobile',
    createdAt: now.toISOString(),
    launchCommand: agentCommand,
    launchMode,
    resumeTarget: resumeTarget || '',
    tmuxSession,
    extraArgs,
    status: 'running'
  };

  await writeSessionMetadata({ stateDir, metadata });
  return metadata;
}

export async function stopSession({
  stateDir,
  sessionId,
  now = new Date(),
  runner = runCommand
}) {
  const metadata = await readSessionMetadata({ stateDir, sessionId });
  await runner('tmux', ['kill-session', '-t', metadata.tmuxSession]);

  const updated = {
    ...metadata,
    status: 'stopped',
    stoppedAt: now.toISOString()
  };
  await writeSessionMetadata({ stateDir, metadata: updated });
  return updated;
}

export async function restartSession({
  stateDir,
  sessionId,
  now = new Date(),
  runner = runCommand
}) {
  const metadata = await readSessionMetadata({ stateDir, sessionId });
  const command = buildLaunchCommand({
    repoPath: metadata.repoPath,
    agentCommand: metadata.launchMode
      ? metadata.launchCommand
      : buildAgentCommand({
          agent: metadata.agent,
          profile: metadata.profile || 'normal',
          launchMode: 'new',
          resumeTarget: '',
          extraArgs: metadata.extraArgs || []
        })
  });

  await runner('tmux', ['new-session', '-d', '-s', metadata.tmuxSession, command]);

  const updated = {
    ...metadata,
    status: 'running',
    restartedAt: now.toISOString()
  };
  delete updated.stoppedAt;

  await writeSessionMetadata({ stateDir, metadata: updated });
  return updated;
}

export async function sendSessionInput({
  stateDir,
  sessionId,
  text,
  runner = runCommand
}) {
  const metadata = await readSessionMetadata({ stateDir, sessionId });
  if (metadata.runtime === 'structured') {
    throw new Error('Structured session input should be handled by the structured runtime.');
  }
  const value = String(text || '').replace(/\r?\n$/, '');
  if (!value.trim()) return { ok: true };
  await runner('tmux', ['send-keys', '-t', metadata.tmuxSession, '-l', value]);
  await runner('tmux', ['send-keys', '-t', metadata.tmuxSession, 'Enter']);
  return { ok: true };
}

function buildLaunchCommand({ repoPath, agentCommand }) {
  return `cd ${quoteShellArg(repoPath)} && ${agentCommand}`;
}

function buildAgentCommand({ agent, profile = 'normal', launchMode, resumeTarget, extraArgs = [] }) {
  const base = AGENT_COMMANDS[agent];
  const args = [
    ...profileArgs({ agent, profile }),
    ...resumeArgs({ agent, launchMode, resumeTarget }),
    ...extraArgs.map((value) => ({ value, raw: false }))
  ].map((token) => token.raw ? token.value : quoteShellArg(token.value));
  return [base, ...args].join(' ');
}

function profileArgs({ agent, profile }) {
  const profiles = {
    codex: {
      safe_plan: [
        { value: '--sandbox', raw: false },
        { value: 'read-only', raw: false },
        { value: '--ask-for-approval', raw: false },
        { value: 'untrusted', raw: false }
      ],
      normal: [
        { value: '--sandbox', raw: false },
        { value: 'workspace-write', raw: false },
        { value: '--ask-for-approval', raw: false },
        { value: 'on-request', raw: false }
      ],
      full_auto: [{ value: '--full-auto', raw: false }],
      bypass: [{ value: '--dangerously-bypass-approvals-and-sandbox', raw: false }],
      review: [
        { value: '--sandbox', raw: false },
        { value: 'read-only', raw: false },
        { value: '--ask-for-approval', raw: false },
        { value: 'untrusted', raw: false }
      ]
    },
    claude: {
      safe_plan: [
        { value: '--permission-mode', raw: false },
        { value: 'plan', raw: false }
      ],
      normal: [
        { value: '--permission-mode', raw: false },
        { value: 'default', raw: false }
      ],
      full_auto: [
        { value: '--permission-mode', raw: false },
        { value: 'auto', raw: false }
      ],
      bypass: [{ value: '--dangerously-skip-permissions', raw: false }],
      review: [
        { value: '--permission-mode', raw: false },
        { value: 'plan', raw: false }
      ]
    }
  };

  const args = profiles[agent]?.[profile];
  if (!args) {
    throw new Error(`Unsupported profile for ${agent}: ${profile}`);
  }
  return args;
}

function resumeArgs({ agent, launchMode, resumeTarget }) {
  if (launchMode === 'new') {
    return [];
  }

  if (agent === 'codex') {
    if (launchMode === 'resume-picker') return [{ value: 'resume', raw: true }];
    if (launchMode === 'resume-last') return [{ value: 'resume', raw: true }, { value: '--last', raw: true }];
    if (launchMode === 'resume-id') return [{ value: 'resume', raw: true }, { value: requireResumeTarget(resumeTarget), raw: false }];
  }

  if (agent === 'claude') {
    if (launchMode === 'resume-picker') return [{ value: '--resume', raw: true }];
    if (launchMode === 'resume-last') return [{ value: '--continue', raw: true }];
    if (launchMode === 'resume-id') return [{ value: '--resume', raw: true }, { value: requireResumeTarget(resumeTarget), raw: false }];
  }

  throw new Error(`Unsupported launch mode: ${launchMode}`);
}

function requireResumeTarget(resumeTarget) {
  if (!resumeTarget || !resumeTarget.trim()) {
    throw new Error('Missing resume target');
  }
  return resumeTarget.trim();
}

function expandHome(path) {
  if (path === '~') {
    return process.env.HOME || path;
  }

  if (path.startsWith('~/')) {
    return `${process.env.HOME || '~'}${path.slice(1)}`;
  }

  return path;
}
