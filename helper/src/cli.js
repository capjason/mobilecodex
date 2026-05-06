#!/usr/bin/env node

import { createDoctorReport } from './doctor.js';
import { scanRepos } from './scan-repos.js';
import { defaultStateDir } from './paths.js';
import { createSession, listSessions, restartSession, stopSession } from './sessions.js';
import { attachTmuxSession } from './tmux.js';
import { getSessionDiff, getSessionStatus } from './git-workflow.js';

async function main(argv) {
  const [command, ...args] = argv;
  const stateDir = readOption(args, '--state-dir') || defaultStateDir();

  if (command === 'doctor') {
    const report = await createDoctorReport();
    writeJson(report);
    return;
  }

  if (command === 'scan-repos') {
    const root = readOption(args, '--root') || process.cwd();
    const depth = Number(readOption(args, '--depth') || 2);
    const repos = await scanRepos({ root, depth });
    writeJson(repos);
    return;
  }

  if (command === 'sessions') {
    writeJson(await listSessions({ stateDir }));
    return;
  }

  if (command === 'new') {
    const metadata = await createSession({
      stateDir,
      agent: requireOption(args, '--agent'),
      repo: requireOption(args, '--repo'),
      profile: readOption(args, '--profile') || 'normal',
      name: readOption(args, '--name'),
      model: readOption(args, '--model') || 'default',
      initialPrompt: readOption(args, '--initial-prompt') || '',
      launchMode: readOption(args, '--launch-mode') || 'new',
      resumeTarget: readOption(args, '--resume-target') || '',
      extraArgs: readRepeatedOption(args, '--arg')
    });
    writeJson(metadata);
    return;
  }

  if (command === 'kill' || command === 'stop') {
    writeJson(await stopSession({ stateDir, sessionId: requirePositional(args, 0, 'sessionId') }));
    return;
  }

  if (command === 'restart') {
    writeJson(await restartSession({ stateDir, sessionId: requirePositional(args, 0, 'sessionId') }));
    return;
  }

  if (command === 'status') {
    writeJson(await getSessionStatus({ stateDir, sessionId: requirePositional(args, 0, 'sessionId') }));
    return;
  }

  if (command === 'diff') {
    writeJson(await getSessionDiff({ stateDir, sessionId: requirePositional(args, 0, 'sessionId') }));
    return;
  }

  if (command === 'attach') {
    await attachTmuxSession({ sessionId: requirePositional(args, 0, 'sessionId') });
    return;
  }

  if (command === 'observe') {
    await attachTmuxSession({ sessionId: requirePositional(args, 0, 'sessionId'), readOnly: true });
    return;
  }

  printUsage();
  process.exitCode = 1;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }

  return args[index + 1] || null;
}

function readRepeatedOption(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function requireOption(args, name) {
  const value = readOption(args, name);
  if (!value) {
    throw new Error(`Missing required option: ${name}`);
  }
  return value;
}

function requirePositional(args, index, label) {
  const positionals = args.filter((arg, argIndex) => {
    if (arg.startsWith('--')) {
      return false;
    }
    return argIndex === 0 || !args[argIndex - 1].startsWith('--');
  });
  const value = positionals[index];
  if (!value) {
    throw new Error(`Missing required argument: ${label}`);
  }
  return value;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printUsage() {
  process.stderr.write(`Usage:
  ai-remote-helper doctor --json
  ai-remote-helper scan-repos --root <path> --depth <n> --json
  ai-remote-helper sessions --json
  ai-remote-helper new --agent <codex|claude> --repo <path> --profile <profile> --json
  ai-remote-helper attach <sessionId>
  ai-remote-helper observe <sessionId>
  ai-remote-helper stop <sessionId> --json
  ai-remote-helper restart <sessionId> --json
  ai-remote-helper status <sessionId> --json
  ai-remote-helper diff <sessionId> --json
`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
