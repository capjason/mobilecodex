import { spawn } from 'node:child_process';

import { runCommand } from './process.js';

export async function listTmuxSessions({ runner = runCommand } = {}) {
  try {
    const result = await runner('tmux', ['list-sessions', '-F', '#S']);
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    if (error.code === 1 || /no server running/i.test(error.stderr || error.message || '')) {
      return [];
    }
    throw error;
  }
}

export async function attachTmuxSession({ sessionId, readOnly = false }) {
  const args = readOnly ? ['attach', '-r', '-t', sessionId] : ['attach', '-t', sessionId];
  await inherit('tmux', args);
}

function inherit(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code}`));
    });
  });
}
