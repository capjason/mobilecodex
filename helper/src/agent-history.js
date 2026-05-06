import { readFile, readdir } from 'node:fs/promises';
import { normalize, resolve, sep, join } from 'node:path';

const maxSessions = 50;

export async function listAgentHistorySessions({ agent, repoPath, homeDir = process.env.HOME || process.cwd() }) {
  const normalizedRepoPath = normalizeRepoPath(repoPath, homeDir);
  if (agent === 'codex') {
    return listCodexHistory({ homeDir, repoPath: normalizedRepoPath });
  }
  if (agent === 'claude') {
    return listClaudeHistory({ homeDir, repoPath: normalizedRepoPath });
  }
  return [];
}

async function listCodexHistory({ homeDir, repoPath }) {
  const filePath = join(homeDir, '.codex', 'history.jsonl');
  const rows = await readJsonLines(filePath);
  const byId = new Map();

  for (const row of rows) {
    if (!row.session_id) continue;
    const current = byId.get(row.session_id);
    const timestamp = Number(row.ts || 0);
    if (!current || timestamp >= current.timestamp) {
      byId.set(row.session_id, {
        id: row.session_id,
        agent: 'codex',
        title: cleanTitle(row.text),
        timestamp,
        lastActivityAt: new Date(timestamp * 1000).toISOString(),
        resumeTarget: row.session_id,
        source: 'codex-history'
      });
    }
  }

  const metadata = await listCodexSessionMetadata({ homeDir });
  if (!metadata.length || !repoPath) {
    if (!metadata.length) return sortAndTrim([...byId.values()]).map(stripInternalTimestamp);
    return sortAndTrim(
      metadata
        .filter((item) => byId.has(item.id))
        .map((item) => ({ ...byId.get(item.id), repoPath: item.cwd }))
    ).map(stripInternalTimestamp);
  }

  const filtered = metadata
    .filter((item) => pathsMatch(item.cwd, repoPath) && byId.has(item.id))
    .map((item) => ({ ...byId.get(item.id), repoPath: item.cwd }));
  return sortAndTrim(filtered).map(stripInternalTimestamp);
}

async function listClaudeHistory({ homeDir, repoPath }) {
  const projectDirs = repoPath
    ? [join(homeDir, '.claude', 'projects', claudeProjectSlug(repoPath))]
    : await listClaudeProjectDirs({ homeDir });
  const sessions = [];

  for (const projectDir of projectDirs) {
    sessions.push(...await listClaudeProjectHistory({ projectDir, repoPath }));
  }

  return sortAndTrim(sessions).map(stripInternalTimestamp);
}

async function listClaudeProjectDirs({ homeDir }) {
  const root = join(homeDir, '.claude', 'projects');
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name));
}

async function listClaudeProjectHistory({ projectDir, repoPath }) {
  let files;
  try {
    files = await readdir(projectDir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const sessions = [];
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const rows = await readJsonLines(join(projectDir, file));
    const userRows = rows.filter((row) => (
      row.type === 'user' &&
      row.sessionId &&
      (!repoPath || pathsMatch(row.cwd, repoPath))
    ));
    if (!userRows.length) continue;
    const last = userRows.reduce((latest, row) => {
      return Date.parse(row.timestamp || '') >= Date.parse(latest.timestamp || '') ? row : latest;
    });
    const timestamp = Date.parse(last.timestamp || '') || 0;
    sessions.push({
      id: last.sessionId,
      agent: 'claude',
      title: cleanTitle(extractClaudeContent(last.message?.content)),
      timestamp,
      lastActivityAt: new Date(timestamp).toISOString(),
      resumeTarget: last.sessionId,
      repoPath: last.cwd || repoPath || '',
      source: 'claude-history'
    });
  }

  return sessions;
}

async function readJsonLines(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

async function listCodexSessionMetadata({ homeDir }) {
  const root = join(homeDir, '.codex', 'sessions');
  const files = await listJsonlFiles(root);
  const sessions = [];

  for (const file of files) {
    const rows = await readJsonLines(file);
    const meta = rows.find((row) => row.type === 'session_meta' && row.payload?.id);
    if (!meta) continue;
    sessions.push({
      id: meta.payload.id,
      cwd: meta.payload.cwd || '',
      timestamp: meta.payload.timestamp || ''
    });
  }

  return sessions;
}

async function listJsonlFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsonlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path);
    }
  }
  return files;
}

function claudeProjectSlug(repoPath) {
  return pathKey(repoPath).replace(/\/+/g, '-');
}

function normalizeRepoPath(repoPath, homeDir) {
  const value = String(repoPath || '').trim();
  if (!value || value === '~') return '';
  const expanded = value.startsWith('~/') ? `${homeDir}${value.slice(1)}` : value;
  return pathKey(expanded);
}

function pathKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = normalize(resolve(raw));
  return normalized.length > 1 && normalized.endsWith(sep)
    ? normalized.slice(0, -1)
    : normalized;
}

function pathsMatch(left, right) {
  return pathKey(left) === pathKey(right);
}

function extractClaudeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === 'string' ? item : item?.text))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function cleanTitle(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 120) : 'Untitled session';
}

function sortAndTrim(sessions) {
  return sessions.sort((a, b) => b.timestamp - a.timestamp).slice(0, maxSessions);
}

function stripInternalTimestamp(session) {
  const { timestamp, ...publicSession } = session;
  return publicSession;
}
