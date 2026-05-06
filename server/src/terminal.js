import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';

import { isRequestAllowed, rejectUpgrade } from './access-control.js';

export function attachTerminalWebSocket(server, terminalService = defaultTerminalService()) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('close', () => {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const match = url.pathname.match(/^\/ws\/sessions\/([^/]+)\/terminal$/);

    if (!match) {
      return;
    }

    if (!isRequestAllowed(req)) {
      rejectUpgrade(socket);
      return;
    }

    const sessionId = decodeURIComponent(match[1]);
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleTerminalConnection(ws, {
        sessionId,
        readOnly: url.searchParams.get('readOnly') === '1',
        terminalService
      });
    });
  });
}

function defaultTerminalService() {
  return {
    open({ sessionId, readOnly = false, cols = 80, rows = 24 }) {
      const args = readOnly ? ['attach', '-r', '-t', sessionId] : ['attach', '-t', sessionId];
      return pty.spawn('tmux', args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.env.HOME || process.cwd(),
        env: process.env
      });
    }
  };
}

function handleTerminalConnection(ws, { sessionId, readOnly, terminalService }) {
  let terminal;

  try {
    terminal = terminalService.open({ sessionId, readOnly });
  } catch (error) {
    send(ws, { type: 'error', message: error.message });
    ws.close();
    return;
  }

  send(ws, { type: 'connected', sessionId });

  onTerminalData(terminal, (data) => {
    send(ws, { type: 'output', data });
  });

  onTerminalExit(terminal, (event) => {
    send(ws, { type: 'exit', code: event.exitCode ?? event.code ?? null });
    ws.close();
  });

  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());

    if (message.type === 'input' && typeof message.data === 'string') {
      terminal.write(message.data);
      return;
    }

    if (message.type === 'key' && typeof message.key === 'string') {
      const sequence = keyToSequence(message.key);
      if (sequence) {
        terminal.write(sequence);
      }
      return;
    }

    if (message.type === 'resize') {
      terminal.resize(Number(message.cols), Number(message.rows));
    }
  });

  ws.on('close', () => {
    // Detach the tmux client cleanly first so the underlying session keeps running.
    try {
      terminal?.write?.('\u0002d');
    } catch {
      // Best-effort detach.
    }
    if (terminal?.kill) {
      setTimeout(() => terminal.kill(), 500).unref();
    }
  });
}

function onTerminalData(terminal, callback) {
  if (terminal.onData) {
    terminal.onData(callback);
    return;
  }
  terminal.on('data', callback);
}

function onTerminalExit(terminal, callback) {
  if (terminal.onExit) {
    terminal.onExit(callback);
    return;
  }
  terminal.on('exit', callback);
}

function keyToSequence(key) {
  const normalized = key.toLowerCase();
  const keys = {
    'ctrl-c': '\u0003',
    'ctrl+d': '\u0004',
    'ctrl-d': '\u0004',
    esc: '\u001b',
    tab: '\t',
    enter: '\r',
    up: '\u001b[A',
    down: '\u001b[B',
    left: '\u001b[D',
    right: '\u001b[C'
  };

  return keys[normalized] || null;
}

function send(ws, value) {
  try {
    ws.send(JSON.stringify(value));
  } catch {
    // The socket may already be closing; terminal cleanup is handled by close events.
  }
}
