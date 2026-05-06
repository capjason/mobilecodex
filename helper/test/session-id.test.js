import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSessionId, sanitizeRepoName } from '../src/session-id.js';

test('sanitizeRepoName converts repo names into stable lowercase slugs', () => {
  assert.equal(sanitizeRepoName('Travel App'), 'travel-app');
  assert.equal(sanitizeRepoName('obsidian_plugin'), 'obsidian-plugin');
  assert.equal(sanitizeRepoName('  Camera UI!!!  '), 'camera-ui');
});

test('buildSessionId combines agent repo and timestamp', () => {
  const id = buildSessionId({
    agent: 'codex',
    repoName: 'Travel App',
    date: new Date('2026-04-30T08:12:00.000Z')
  });

  assert.equal(id, 'codex__travel-app__0430-0812');
});

