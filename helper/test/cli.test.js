import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const cliPath = resolve('src/cli.js');

test('CLI doctor prints a JSON dependency report', async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, 'doctor', '--json']);
  const report = JSON.parse(stdout);

  assert.equal(typeof report.git, 'boolean');
  assert.equal(typeof report.tmux, 'boolean');
  assert.equal(typeof report.platform, 'string');
});

test('CLI scan-repos prints discovered repositories as JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mobilecodex-cli-scan-'));

  try {
    await mkdir(join(root, 'travel-app', '.git'), { recursive: true });

    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'scan-repos',
      '--root',
      root,
      '--depth',
      '1',
      '--json'
    ]);

    assert.deepEqual(JSON.parse(stdout), [
      {
        name: 'travel-app',
        path: join(root, 'travel-app')
      }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI sessions works with an empty state directory even when tmux is unavailable', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'mobilecodex-cli-state-'));

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'sessions',
      '--state-dir',
      stateDir,
      '--json'
    ]);

    assert.deepEqual(JSON.parse(stdout), []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

