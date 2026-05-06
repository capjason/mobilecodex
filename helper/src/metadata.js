import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sessionsDir } from './paths.js';

export async function writeSessionMetadata({ stateDir, metadata }) {
  assertSafeSessionId(metadata.sessionId);
  const dir = sessionsDir(stateDir);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${metadata.sessionId}.json`),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8'
  );
  return metadata;
}

export async function readSessionMetadata({ stateDir, sessionId }) {
  assertSafeSessionId(sessionId);
  const raw = await readFile(join(sessionsDir(stateDir), `${sessionId}.json`), 'utf8');
  return JSON.parse(raw);
}

export async function listSessionMetadata({ stateDir }) {
  let files;
  try {
    files = await readdir(sessionsDir(stateDir));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const sessions = [];
  for (const file of files.sort()) {
    if (!file.endsWith('.json')) {
      continue;
    }

    const raw = await readFile(join(sessionsDir(stateDir), file), 'utf8');
    sessions.push(JSON.parse(raw));
  }

  return sessions;
}

export function assertSafeSessionId(sessionId) {
  if (!/^[a-z0-9][a-z0-9_-]*(?:__[a-z0-9][a-z0-9-]*__\d{4}-\d{4})?$/.test(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
}

