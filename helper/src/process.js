import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
}

