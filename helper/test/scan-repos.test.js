import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { scanRepos } from '../src/scan-repos.js';

test('scanRepos returns git repositories within the requested depth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mobilecodex-scan-'));

  try {
    await mkdir(join(root, 'travel-app', '.git'), { recursive: true });
    await mkdir(join(root, 'nested', 'camera-ui', '.git'), { recursive: true });
    await mkdir(join(root, 'too', 'deep', 'ignored', '.git'), { recursive: true });

    const repos = await scanRepos({ root, depth: 2 });

    assert.deepEqual(
      repos.map((repo) => repo.name).sort(),
      ['camera-ui', 'travel-app']
    );
    assert.equal(repos.find((repo) => repo.name === 'travel-app').path, join(root, 'travel-app'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

