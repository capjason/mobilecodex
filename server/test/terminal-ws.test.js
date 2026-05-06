import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';

import { createApp } from '../src/app.js';
import { normalizeToolItem } from '../src/codex-structured.js';

test('terminal websocket bridges output input resize and close', async () => {
  const terminal = new FakeTerminal();
  const app = createApp({
    services: minimalServices(),
    terminalService: {
      open: ({ sessionId }) => {
        terminal.sessionId = sessionId;
        return terminal;
      }
    }
  });

  app.listen(0);
  await once(app, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${app.address().port}/ws/sessions/codex__travel-app__0430-1612/terminal`);
  const connected = nextJson(ws);

  try {
    await once(ws, 'open');
    assert.deepEqual(await connected, {
      type: 'connected',
      sessionId: 'codex__travel-app__0430-1612'
    });

    const output = nextJson(ws);
    terminal.emit('data', 'Codex is thinking...\n');
    assert.deepEqual(await output, {
      type: 'output',
      data: 'Codex is thinking...\n'
    });

    const firstWrite = terminal.nextWrite();
    ws.send(JSON.stringify({ type: 'input', data: 'continue\n' }));
    await firstWrite;
    assert.deepEqual(terminal.writes, ['continue\n']);

    const secondWrite = terminal.nextWrite();
    ws.send(JSON.stringify({ type: 'key', key: 'ctrl-c' }));
    await secondWrite;
    assert.deepEqual(terminal.writes, ['continue\n', '\u0003']);

    const resize = terminal.nextResize();
    ws.send(JSON.stringify({ type: 'resize', cols: 90, rows: 28 }));
    await resize;
    assert.deepEqual(terminal.resizes, [{ cols: 90, rows: 28 }]);

    const closed = once(ws, 'close');
    const exit = nextJson(ws);
    terminal.emit('exit', { exitCode: 0 });
    assert.deepEqual(await exit, {
      type: 'exit',
      code: 0
    });
    await closed;
  } finally {
    if (ws.readyState === WebSocket.OPEN) {
      const closed = once(ws, 'close');
      ws.close();
      await closed;
    } else if (ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
    await new Promise((resolve) => app.close(resolve));
  }
});

test('structured chat websocket replays events and sends input to runtime', async () => {
  const runtime = new FakeStructuredRuntime();
  const app = createApp({
    services: {
      ...minimalServices(),
      structuredManager: {
        getSession: async () => runtime
      }
    }
  });

  app.listen(0);
  await once(app, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${app.address().port}/ws/sessions/codex__travel-app__0430-1612/chat`);
  const initialMessages = nextJsonMessages(ws, 2);

  try {
    await once(ws, 'open');
    const [connected, replayed] = await initialMessages;
    assert.deepEqual(connected, {
      type: 'connected',
      sessionId: 'codex__travel-app__0430-1612',
      requestedSessionId: 'codex__travel-app__0430-1612',
      runtime: 'structured'
    });
    assert.deepEqual(replayed, { type: 'assistant_message', content: 'previous answer' });

    const input = runtime.nextInput();
    ws.send(JSON.stringify({ type: 'input', data: 'hello' }));
    await input;
    assert.deepEqual(runtime.inputs, ['hello']);

    const event = nextJson(ws);
    runtime.push({ type: 'assistant_delta', content: 'hi' });
    assert.deepEqual(await event, { type: 'assistant_delta', content: 'hi' });
  } finally {
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
    await new Promise((resolve) => app.close(resolve));
  }
});

test('structured tool items use item id as call id when call id is missing', () => {
  assert.deepEqual(
    normalizeToolItem({ id: 'item_123', type: 'commandExecution', command: 'npm test' }),
    { id: 'item_123', type: 'commandExecution', command: 'npm test', callId: 'item_123' }
  );
  assert.deepEqual(
    normalizeToolItem({ id: 'item_123', callId: 'call_456', type: 'commandExecution' }),
    { id: 'item_123', callId: 'call_456', type: 'commandExecution' }
  );
});

class FakeStructuredRuntime extends EventEmitter {
  inputs = [];
  metadata = { sessionId: 'codex__travel-app__0430-1612' };

  replay() {
    return [{ type: 'assistant_message', content: 'previous answer' }];
  }

  async sendText(text) {
    this.inputs.push(text);
    this.emit('input');
  }

  nextInput() {
    return once(this, 'input');
  }

  push(event) {
    this.emit('event', event);
  }
}

class FakeTerminal extends EventEmitter {
  writes = [];
  resizes = [];

  write(data) {
    this.writes.push(data);
    this.emit('write');
  }

  resize(cols, rows) {
    this.resizes.push({ cols, rows });
    this.emit('resize');
  }

  kill() {
    this.killed = true;
  }

  nextWrite() {
    return once(this, 'write');
  }

  nextResize() {
    return once(this, 'resize');
  }
}

function nextJson(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function nextJsonMessages(ws, count) {
  return new Promise((resolve) => {
    const messages = [];
    function onMessage(data) {
      messages.push(JSON.parse(data.toString()));
      if (messages.length === count) {
        ws.off('message', onMessage);
        resolve(messages);
      }
    }
    ws.on('message', onMessage);
  });
}

function minimalServices() {
  return {
    doctor: async () => ({}),
    scanRepos: async () => [],
    listSessions: async () => [],
    createSession: async () => ({}),
    getSessionStatus: async () => ({}),
    getSessionDiff: async () => ({}),
    stopSession: async () => ({}),
    restartSession: async () => ({})
  };
}
