import { join } from 'node:path';

export function defaultStateDir() {
  return join(process.env.HOME || process.cwd(), '.ai-remote');
}

export function sessionsDir(stateDir = defaultStateDir()) {
  return join(stateDir, 'sessions');
}

