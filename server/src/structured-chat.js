import { WebSocketServer } from 'ws';

import { isRequestAllowed, rejectUpgrade } from './access-control.js';

export function attachStructuredChatWebSocket(server, manager) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('close', () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const match = url.pathname.match(/^\/ws\/sessions\/([^/]+)\/chat$/);
    if (!match) return;

    if (!isRequestAllowed(req)) {
      rejectUpgrade(socket);
      return;
    }

    const sessionId = decodeURIComponent(match[1]);
    const after = url.searchParams.get('after') || '';
    wss.handleUpgrade(req, socket, head, async (ws) => {
      try {
        const runtime = await manager.getSession(sessionId);
        if (!runtime) {
          send(ws, { type: 'error', content: 'Structured runtime is not available for this session.' });
          ws.close();
          return;
        }

        const forward = (event) => send(ws, event);
        runtime.on('event', forward);
        send(ws, {
          type: 'connected',
          sessionId: runtime.metadata.sessionId,
          requestedSessionId: sessionId,
          runtime: 'structured'
        });
        for (const event of runtime.replay({ after })) send(ws, event);

        ws.on('message', async (raw) => {
          try {
            const message = JSON.parse(raw.toString());
            if (message.type === 'input' && typeof message.data === 'string') {
              await runtime.sendText(message.data.replace(/\r$/, ''));
            }
          } catch (error) {
            send(ws, { type: 'error', content: error.message });
          }
        });

        ws.on('close', () => runtime.off('event', forward));
      } catch (error) {
        send(ws, { type: 'error', content: error.message });
        ws.close();
      }
    });
  });
}

function send(ws, value) {
  try {
    ws.send(JSON.stringify(value));
  } catch {
    // Socket may already be closing.
  }
}
