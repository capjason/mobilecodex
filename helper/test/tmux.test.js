import assert from 'node:assert/strict';
import test from 'node:test';

import { listTmuxSessions } from '../src/tmux.js';

test('listTmuxSessions returns an empty list when tmux is not installed', async () => {
  const sessions = await listTmuxSessions({
    runner: async () => {
      const error = new Error('spawn tmux ENOENT');
      error.code = 'ENOENT';
      throw error;
    }
  });

  assert.deepEqual(sessions, []);
});

