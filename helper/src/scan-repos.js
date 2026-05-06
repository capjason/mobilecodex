import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

export async function scanRepos({ root, depth = 2 }) {
  const rootPath = await realpath(expandHome(root));
  const repos = [];

  await walk(rootPath, 0, Number(depth), repos);

  return repos.sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(dir, currentDepth, maxDepth, repos) {
  if (currentDepth > maxDepth) {
    return;
  }

  if (await isDirectory(join(dir, '.git'))) {
    repos.push({
      name: basename(dir),
      path: dir
    });
    return;
  }

  if (currentDepth === maxDepth) {
    return;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }

    await walk(join(dir, entry.name), currentDepth + 1, maxDepth, repos);
  }
}

async function isDirectory(path) {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
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

