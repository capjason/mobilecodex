# MobileCodex v0.55 Technical Design

Date: 2026-05-03

## 1. Product Positioning

MobileCodex v0.55 is a mobile-first Web/PWA control surface for Codex CLI and Claude Code CLI sessions running on a private host.

It is still not a mobile IDE, generic terminal app, remote desktop, or cloud agent platform. The product is now better described as:

```text
Mobile AI Coding Session Console
+ Codex / Claude Code launcher
+ session resume manager
+ rich chat transcript
+ durable reconnect layer
+ structured tool-call viewer
```

The v0.5 document described an "AI Coding Agent dedicated mobile SSH client". After implementation, v0.55 has shifted to a Web-first deployment:

```text
Mobile Safari / Home Screen PWA
  -> HTTPS + WebSocket over Tailscale-only access
  -> mobilecodex Node server
  -> Codex structured runtime or tmux-backed CLI session
```

The product scope is intentionally narrower than the original v0.5 MVP:

- Support only Codex CLI and Claude Code CLI.
- Do not build a generic terminal product.
- Do not prioritize git status, git diff, PR, or file editing UX in the main mobile flow.
- Optimize mobile chat, session continuity, reconnect reliability, and tool-call readability.

## 2. Architecture

### 2.1 Deployed Shape

Example deployment:

```text
https://mobilecodex.example.com
  -> existing 443 gateway / reverse proxy
  -> 127.0.0.1:8787
  -> mobilecodex.service
  -> Node server
```

The server is run by:

```text
systemctl --user start mobilecodex.service
```

Health check:

```text
GET /api/health -> {"ok":true}
```

443 is shared with other services. MobileCodex must continue to run behind the existing gateway and must not bind directly to 443 or replace other reverse-proxy configuration.

### 2.2 Network and Access Control

The intended access boundary is Tailscale-only:

```text
mobile browser
  -> Tailscale network
  -> mobilecodex.example.com
  -> gateway allows Tailnet source IPs
  -> MobileCodex server
```

Non-Tailscale source addresses should receive `403` at the gateway layer. The application server remains bound behind the proxy and should not be exposed directly to the public internet.

## 3. Runtime Model

MobileCodex now has two runtime paths.

### 3.1 Codex Structured Runtime

Codex is the primary optimized path.

The server starts Codex through:

```text
codex app-server --listen stdio://
```

The server talks to Codex over JSON-RPC and uses Codex thread APIs:

- `thread/start`
- `thread/resume`
- `turn/start`
- `turn/steer`
- structured notifications for status, assistant deltas, tool calls, and command output

Metadata for structured sessions includes:

```json
{
  "runtime": "structured",
  "agent": "codex",
  "repoPath": "/workspace/mobilecodex",
  "model": "gpt-5.5",
  "reasoningEffort": "high",
  "threadId": "019...",
  "threadPath": "~/.codex/sessions/..."
}
```

Codex structured sessions are kept alive by the Node server, not by the browser tab. Closing the page should not stop active work once the prompt has reached the server.

### 3.2 Claude Code / tmux CLI Runtime

Claude Code remains supported through the original helper/tmux path:

```text
tmux new-session -d -s <sessionId> 'cd <cwd> && claude ...'
```

The WebSocket terminal bridge can attach to tmux for CLI interaction. On WebSocket close, the server detaches the tmux client before cleanup so the underlying tmux session can continue.

This path is intentionally less rich than Codex structured mode until Claude has an equivalent structured app-server interface in this project.

## 4. Host Helper and Metadata

The helper modules remain the stable host abstraction for non-structured operations:

- dependency doctor
- repo scanning
- session metadata
- tmux session creation
- tmux-backed restart and stop
- Claude Code launch arguments

State stays under:

```text
~/.ai-remote/sessions/
```

Session naming remains:

```text
{agent}__{repoName}__{MMDD-HHmm}
```

For resumed Codex threads, duplicate running session rows are deduped by:

```text
agent + repoPath + threadId/resumeTarget
```

This prevents the UI from showing many active rows for the same underlying Codex thread.

## 5. API Surface

### 5.1 JSON APIs

Current server APIs:

```text
GET  /api/health
GET  /api/doctor
GET  /api/repos?root=<path>&depth=<n>
GET  /api/sessions
GET  /api/agent-sessions?agent=<codex|claude>&repo=<cwd>
POST /api/sessions
POST /api/sessions/:id/input
POST /api/sessions/:id/stop
POST /api/sessions/:id/restart
GET  /api/sessions/:id/history?offset=<n>&limit=<n>
```

`POST /api/sessions/:id/input` is important for mobile continuity. The frontend sends prompts through HTTP with `keepalive: true`, so a submitted message has a better chance of reaching the host even if iOS backgrounds or tears down the page shortly after tapping Send.

### 5.2 WebSocket APIs

```text
WS /ws/sessions/:id/chat?after=<lastEventAt>
WS /ws/sessions/:id/terminal
```

`/chat` is the Codex structured stream. It replays only events after the client cursor when possible.

`/terminal` is the tmux PTY stream for fallback CLI sessions.

## 6. Mobile UI

### 6.1 Single Page Shell

The UI is a single-page mobile web app.

Before entering a session:

- top row selects CLI: Codex or Claude Code
- working directory input is the process launch CWD
- permission/profile selector
- session picker lists active sessions and resumable history

After entering a session:

- top launch controls are hidden
- navigation bar shows session title, settings button, and close button
- center area is a rich chat transcript
- composer is fixed at the bottom
- status strip sits directly above the input box
- special key row only contains `up`, `down`, and `enter`

The UI intentionally removed generic quick prompts such as "summarize", "diff", and "test" from the bottom bar.

### 6.2 Working Directory

`Working directory` means the directory used to start the CLI process.

For Codex structured runtime:

```text
thread/start cwd = workingDirectory
```

For tmux CLI runtime:

```bash
cd <workingDirectory> && codex ...
cd <workingDirectory> && claude ...
```

The directory input is not limited to scan results. Repo scan suggestions are only autocomplete hints.

### 6.3 Session Drawer

The left drawer supports:

- switching among active sessions
- creating a new session
- customizing CLI, CWD, and permission profile
- resuming previous Codex/Claude history for the selected CLI/CWD

The drawer can be opened with the left handle or by swiping from the left edge.

### 6.4 Settings Drawer

The right drawer supports:

- model selection
- reasoning effort selection

Current default:

```text
model = gpt-5.5
reasoningEffort = high
```

Reasoning values:

```text
low
medium
high
```

## 7. Launch Profiles

Profiles are still the mobile abstraction over CLI permission flags.

### Safe Plan

Read-only / plan-first behavior.

Codex structured mode maps this to read-only sandbox and stricter approval behavior.

### Normal

Daily coding mode.

Allows workspace changes and keeps approval behavior conservative.

### Full Auto

Allows more autonomous work in the workspace. Should be used on a clean branch or disposable environment.

### Bypass

Highest-permission mode.

For Codex this maps to danger/full-access behavior. For Claude Code this maps to skipped permissions. The UI must keep this explicit because it can modify files and run commands without normal confirmation boundaries.

### Review

Read-only review mode.

## 8. Reconnect and Continuity

This is the main v0.55 improvement area.

### 8.1 Problems Found After v0.5

Mobile Safari and Home Screen PWA behavior exposed several issues:

- leaving the page could close WebSocket connections
- reconnect replay could duplicate messages
- history reload could overwrite cached messages and make the transcript jump
- users could not tell whether history was loaded or the socket was connected
- submitted work needed to continue after the page was backgrounded

### 8.2 Current Solution

The frontend now uses:

- localStorage transcript cache
- localStorage event cursor
- background history sync
- WebSocket replay cursor
- HTTP keepalive prompt submission
- explicit connection/history status strip

Client-side cache keys:

```text
mobilecodex.transcript.<sessionId>
mobilecodex.cursor.<sessionId>
```

Reconnect behavior:

```text
1. show cached transcript immediately
2. open WebSocket with ?after=<lastEventAt>
3. fetch recent history in background
4. merge history + live messages by source key/content key
5. keep scroll anchored unless user is already at the bottom
```

The frontend does not force-reconnect if the socket is already open or connecting. This avoids unnecessary replay and message jumping when iOS fires focus/pageshow/visibility events.

### 8.3 Status Strip

The composer status strip shows two independent states:

```text
history cached
history loading
history synced
history offline

connecting
connected
working
idle
reconnecting
error
```

The goal is that the user can tell whether the page is still loading history, whether the socket is connected, and whether the agent is actively working.

## 9. Message Model

The chat transcript stores normalized entries:

```json
{
  "id": "event-or-local-id",
  "role": "user | agent | tool | system",
  "content": "renderable markdown-ish content",
  "sourceKey": "dedupe key for structured events"
}
```

Source keys are used to avoid duplicate replay for stable events such as:

- user messages
- assistant final messages
- plan updates
- tool started/completed
- status events

Streaming delta events are intentionally not deduped by timestamp because multiple valid chunks can share timing or content shape.

## 10. Tool Call Rendering

Tool calls are now first-class chat objects, not raw terminal dumps.

### 10.1 Current Behavior

Tool events are rendered as collapsed blocks by default.

Collapsed summary examples:

```text
Started exec_command
Completed exec_command · success · exit 0 · 1020ms
Tool Output · call_xxx
```

Expanded details show structured fields:

```text
Command: `npm test`
Directory: `/workspace/mobilecodex`
Call: `call_xxx`
Exit Code: `0`
Success: `true`
Duration: `1020ms`
```

JSON payloads are flattened into readable key/value rows instead of showing raw JSON blobs.

### 10.2 Output Cleanup

The frontend removes Codex terminal metadata lines from tool output:

```text
Chunk ID: ...
Wall time: ...
Process exited with code ...
Original token count: ...
Output:
```

This leaves the actual stdout/stderr content visible.

### 10.3 Merge Rules

Tool output is merged by call id when possible.

The server-side history parser avoids producing duplicate output when both `exec_command_end` and `function_call_output` contain the same command result. The frontend also merges adjacent tool entries with the same `Call: ...` id.

Remaining known limitation:

```text
Realtime tool_output_delta can still arrive before tool_completed details.
The UI merges adjacent same-call entries, but a future improvement should maintain an explicit
callId -> transcript card map so non-adjacent deltas always update the original card.
```

## 11. PWA and Cache Versioning

MobileCodex supports Add to Home Screen through:

- `manifest.webmanifest`
- Apple mobile web app meta tags
- service worker registration
- cache version bump on deploy

Current version marker:

```text
mobilecodex-2026-05-03-tool-call-merge-v4
```

When transcript rendering changes, the transcript cache version must be bumped so stale formatted messages are regenerated from history.

Current transcript cache version:

```text
v4
```

## 12. Current MVP Scope for v0.55

In scope:

- Web/PWA mobile UI.
- Codex structured runtime.
- Claude Code CLI launch/resume through tmux.
- CWD selection and manual path entry.
- Permission profile selection.
- Model and reasoning settings.
- Multi-session switching from left drawer.
- New session creation from left drawer.
- Resume previous Codex/Claude history from left drawer.
- Bottom composer with HTTP keepalive input submission.
- Reconnect status and history sync status.
- Cached transcript with background merge.
- Tool call rendering, folding, cleanup, and call-id merge.
- Tailscale-only deployment behind existing 443 gateway.

Out of scope for v0.55:

- Generic terminal UX.
- Main-flow git diff/status UI.
- Full mobile file editor.
- Team collaboration.
- Cloud sync.
- Push notifications.
- PR workflow.
- Automatic command approval UI.
- Native iOS packaging.

## 13. Implementation Files

Main frontend:

```text
web/src/main.jsx
web/src/styles.css
web/src/api.js
```

Server:

```text
server/src/app.js
server/src/structured-chat.js
server/src/codex-structured.js
server/src/codex-history.js
server/src/terminal.js
```

Helper:

```text
helper/src/sessions.js
helper/src/agent-history.js
helper/src/metadata.js
helper/src/tmux.js
```

PWA:

```text
index.html
public/manifest.webmanifest
public/sw.js
```

Tests:

```text
server/test/*.test.js
web/test/*.test.js
helper/test/*.test.js
```

## 14. Verification Checklist

Before considering a deployment good:

```bash
npm test -- --runInBand
npm run web:build
systemctl --user restart mobilecodex.service
curl -k https://mobilecodex.example.com/api/health
```

Expected health response:

```json
{"ok":true}
```

Also verify:

- the served HTML references the latest hashed JS asset
- `/sw.js` contains the latest `CACHE_VERSION`
- the Home Screen PWA updates after closing and reopening
- existing tool-call-heavy sessions no longer show duplicated `Tool Output` cards for the same call id

## 15. Open Problems

### 15.1 True Tool Card Updating

Current tool merge is string/content based. A stronger model should store transcript tool cards with structured fields:

```json
{
  "role": "tool",
  "callId": "call_xxx",
  "status": "running | completed | failed",
  "summary": "...",
  "details": [],
  "output": "..."
}
```

Then realtime deltas can update the exact card even when events are not adjacent.

### 15.2 Claude Structured Support

Claude Code still uses the tmux/terminal path. A structured Claude path would improve history, tool calls, and reconnect behavior.

### 15.3 Browser-Level Background Limits

HTTP keepalive improves prompt submission, but iOS can still suspend JavaScript aggressively. The durable boundary must remain server-side: once input reaches the server, the runtime must continue independent of the page.

### 15.4 Security Hardening

Keep the deployment Tailscale-only. Future hardening should add:

- explicit allowlist for launch directories
- local audit log for session create/resume/stop/input
- clearer UI warning for Bypass profile
- optional per-host auth if the app is ever exposed outside Tailnet
