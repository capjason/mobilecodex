import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCodexThreadMessages } from '../src/codex-history.js';

test('codex thread history is converted into mobile chat messages', () => {
  const raw = [
    {
      timestamp: '2026-04-30T10:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'thread-1', cwd: '/repo' }
    },
    {
      timestamp: '2026-04-30T10:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'hidden instructions' }]
      }
    },
    {
      timestamp: '2026-04-30T10:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>ignored</environment_context>' }]
      }
    },
    {
      timestamp: '2026-04-30T10:00:03.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Build the mobile UI' }
    },
    {
      timestamp: '2026-04-30T10:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'I will inspect the app first.' }]
      }
    }
  ].map((row) => JSON.stringify(row)).join('\n');

  assert.deepEqual(parseCodexThreadMessages(raw), [
    {
      type: 'user',
      content: 'Build the mobile UI',
      at: '2026-04-30T10:00:03.000Z'
    },
    {
      type: 'assistant_message',
      content: 'I will inspect the app first.',
      at: '2026-04-30T10:00:04.000Z'
    }
  ]);
});

test('codex thread history keeps only the newest messages within the limit', () => {
  const raw = [1, 2, 3].map((value) => JSON.stringify({
    timestamp: `2026-04-30T10:00:0${value}.000Z`,
    type: 'event_msg',
    payload: { type: 'user_message', message: `message ${value}` }
  })).join('\n');

  assert.deepEqual(parseCodexThreadMessages(raw, { limit: 2 }).map((event) => event.content), [
    'message 2',
    'message 3'
  ]);
});

test('codex thread history includes tool calls and tool outputs', () => {
  const raw = [
    {
      timestamp: '2026-04-30T10:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call_123',
        arguments: JSON.stringify({ cmd: 'npm test', workdir: '/repo' })
      }
    },
    {
      timestamp: '2026-04-30T10:00:01.000Z',
      type: 'event_msg',
      payload: {
        type: 'exec_command_end',
        call_id: 'call_123',
        status: 'completed',
        command: ['/usr/bin/zsh', '-lc', 'npm test'],
        exit_code: 0,
        duration: { secs: 1, nanos: 20000000 },
        stdout: 'all good'
      }
    },
    {
      timestamp: '2026-04-30T10:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_123',
        output: 'Chunk ID: abc'
      }
    }
  ].map((row) => JSON.stringify(row)).join('\n');

  const events = parseCodexThreadMessages(raw);
  assert.deepEqual(events.map((event) => event.type), [
    'tool_started',
    'tool_completed'
  ]);
  assert.equal(events[0].toolType, 'exec_command');
  assert.equal(events[1].item.exitCode, 0);
  assert.equal(events[1].item.durationMs, 1020);
  assert.equal(events[1].item.outputPreview, 'all good');
});
