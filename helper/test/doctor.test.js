import assert from 'node:assert/strict';
import test from 'node:test';

import { createDoctorReport } from '../src/doctor.js';

test('createDoctorReport returns booleans for known dependencies', async () => {
  const report = await createDoctorReport({
    platform: 'linux',
    commandExists: async (name) => name === 'git' || name === 'tmux'
  });

  assert.deepEqual(report, {
    tmux: true,
    codex: false,
    claude: false,
    git: true,
    platform: 'linux'
  });
});

