import { readSessionMetadata } from './metadata.js';
import { runCommand } from './process.js';

export function parsePorcelainStatus(output) {
  const result = {
    modified: [],
    staged: [],
    deleted: [],
    untracked: [],
    renamed: []
  };

  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const indexStatus = line[0];
    const worktreeStatus = line[1];
    const pathText = line.slice(3);

    if (indexStatus === '?' && worktreeStatus === '?') {
      result.untracked.push(pathText);
      continue;
    }

    let displayPath = pathText;
    if (indexStatus === 'R' && pathText.includes(' -> ')) {
      const [from, to] = pathText.split(' -> ');
      result.renamed.push({ from, to });
      displayPath = to;
    }

    if (indexStatus !== ' ' && indexStatus !== '?') {
      result.staged.push(displayPath);
    }

    if (worktreeStatus === 'M') {
      result.modified.push(displayPath);
    }

    if (worktreeStatus === 'D' || indexStatus === 'D') {
      result.deleted.push(displayPath);
    }
  }

  return result;
}

export async function getSessionStatus({ stateDir, sessionId, runner = runCommand }) {
  const metadata = await readSessionMetadata({ stateDir, sessionId });
  const status = await runner('git', ['status', '--porcelain=v1'], {
    cwd: metadata.repoPath
  });

  return {
    repoPath: metadata.repoPath,
    ...parsePorcelainStatus(status.stdout)
  };
}

export async function getSessionDiff({ stateDir, sessionId, runner = runCommand }) {
  const metadata = await readSessionMetadata({ stateDir, sessionId });
  const stat = await runner('git', ['diff', '--stat'], {
    cwd: metadata.repoPath
  });
  const diff = await runner('git', ['diff'], {
    cwd: metadata.repoPath
  });

  return {
    repoPath: metadata.repoPath,
    stat: stat.stdout.trim(),
    diff: diff.stdout
  };
}

