import { platform } from 'node:os';
import { access } from 'node:fs/promises';
import { delimiter } from 'node:path';

export async function commandExists(command, envPath = process.env.PATH || '') {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = envPath.split(delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const extension of extensions) {
      try {
        await access(`${dir}/${command}${extension}`);
        return true;
      } catch {
        // Keep checking the remaining PATH entries.
      }
    }
  }

  return false;
}

export async function createDoctorReport({
  platform: hostPlatform = platform(),
  commandExists: hasCommand = commandExists
} = {}) {
  const [tmux, codex, claude, git] = await Promise.all([
    hasCommand('tmux'),
    hasCommand('codex'),
    hasCommand('claude'),
    hasCommand('git')
  ]);

  return {
    tmux,
    codex,
    claude,
    git,
    platform: hostPlatform
  };
}

