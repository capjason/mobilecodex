# MobileCodex v0.5 Technical Design

## 1. Product Positioning

MobileCodex is a mobile-first remote control tool for AI coding agents.

It is not a mobile IDE, remote desktop client, generic SSH app, or cloud agent platform. The first version is a dedicated mobile SSH client for Codex CLI and Claude Code sessions.

The product uses:

```text
Tailscale private network
+ SSH
+ tmux
+ Codex CLI / Claude Code
```

The mobile app provides the workflow layer:

- Manage multiple coding sessions.
- Launch Codex or Claude Code in a selected repo.
- Resume existing tmux sessions from the phone.
- Stream terminal output in real time.
- Send prompts with mobile-friendly input.
- Provide quick prompts, special keys, git status, and git diff views.

## 2. Architecture

```text
iPhone / Android App
  |
  | Tailscale VPN
  v
SSH / Tailscale SSH
  |
  v
Host Machine
  |
  v
tmux session
  |
  v
Codex CLI / Claude Code
```

Supported hosts for the first release:

- macOS
- Linux
- Windows through WSL

Native Windows support is out of scope for the first release.

## 3. First Release Strategy

The durable protocol boundary is a host-side CLI named `ai-remote-helper`.

The mobile app should not build long-term behavior around ad hoc shell strings. The helper owns structured operations such as session listing, repo scanning, tmux session creation, metadata persistence, git status, and git diff.

The first implementation should start with the helper because it can be developed and tested independently of the mobile UI.

## 4. Host Helper

### 4.1 Responsibilities

`ai-remote-helper` is not a daemon. It is invoked over SSH by the mobile app.

It is responsible for:

- Checking host dependencies.
- Scanning allowed repo roots.
- Creating tmux sessions.
- Recording session metadata.
- Listing sessions.
- Attaching or observing sessions.
- Returning git status and diff.
- Restarting exited sessions from metadata.
- Checking whether Codex and Claude Code are installed.

### 4.2 State Directory

The helper stores local state under:

```text
~/.ai-remote/
  sessions/
    codex__travel-app__0430-1612.json
  logs/
    helper.log
```

### 4.3 Session Metadata

```json
{
  "sessionId": "codex__travel-app__0430-1612",
  "agent": "codex",
  "repoPath": "/Users/developer/projects/travel-app",
  "repoName": "travel-app",
  "profile": "normal",
  "model": "default",
  "createdFrom": "mobile",
  "createdAt": "2026-04-30T16:12:00+08:00",
  "launchCommand": "codex",
  "tmuxSession": "codex__travel-app__0430-1612",
  "extraArgs": []
}
```

### 4.4 Session ID Format

```text
{agent}__{repoName}__{MMDD-HHmm}
```

Examples:

```text
codex__travel-app__0430-1612
claude__obsidian-plugin__0430-1620
```

Repo names are sanitized to lowercase alphanumeric words joined by `-`.

### 4.5 Helper Commands

#### `doctor`

```bash
ai-remote-helper doctor --json
```

Returns:

```json
{
  "tmux": true,
  "codex": true,
  "claude": true,
  "git": true,
  "platform": "linux"
}
```

#### `scan-repos`

```bash
ai-remote-helper scan-repos --root ~/projects --depth 2 --json
```

Returns:

```json
[
  {
    "name": "travel-app",
    "path": "/Users/developer/projects/travel-app"
  }
]
```

#### `sessions`

```bash
ai-remote-helper sessions --json
```

Returns known metadata merged with live tmux status.

#### `new`

```bash
ai-remote-helper new \
  --agent codex \
  --repo /Users/developer/projects/travel-app \
  --profile normal \
  --name codex__travel-app__0430-1612 \
  --json
```

Internally:

```bash
tmux new-session -d -s codex__travel-app__0430-1612 \
  'cd /Users/developer/projects/travel-app && codex'
```

#### `attach`

```bash
ai-remote-helper attach codex__travel-app__0430-1612
```

Internally:

```bash
tmux attach -t codex__travel-app__0430-1612
```

#### `observe`

```bash
ai-remote-helper observe codex__travel-app__0430-1612
```

Internally:

```bash
tmux attach -r -t codex__travel-app__0430-1612
```

#### `status`

```bash
ai-remote-helper status codex__travel-app__0430-1612 --json
```

Returns structured git status for the session repo.

#### `diff`

```bash
ai-remote-helper diff codex__travel-app__0430-1612 --json
```

Returns:

- diff stat
- raw unified diff
- file list

## 5. Mobile App

### 5.0 Current Web-First Decision

The current implementation path uses a host-side web server and mobile web UI before native iOS.

```text
Mobile Browser / PWA / Capacitor WebView
  |
  | HTTPS + WebSocket over Tailscale
  v
mobilecodex host server
  |
  v
helper modules + node-pty
  |
  v
tmux session
```

JSON APIs handle structured operations such as `doctor`, repo scanning, sessions, git status, and git diff. WebSocket handles real-time terminal interaction. This keeps the first usable version fast to build while preserving a path to Capacitor packaging.

### 5.1 Recommended First Stack

The preferred first mobile implementation was originally native iOS with SwiftUI. The current implementation has shifted to Web-first because the product needs fast iteration on terminal, diff, session, and prompt UX.

Reasons:

- SSH PTY behavior is easier to tune natively.
- Keychain integration is straightforward.
- Keyboard accessory controls are important for Codex and Claude Code.
- iOS can validate the most constrained mobile interaction first.

Native iOS remains a valid later path if the product needs direct SSH without a host web server.

### 5.2 Screens

#### Hosts

Shows configured hosts and online state.

#### Host Detail

Shows active sessions and entry points for new Codex or Claude Code sessions.

#### New Session

Inputs:

- Agent: Codex or Claude Code
- Working directory
- Profile
- Model
- Initial prompt
- Extra args
- Session name override

#### Session

Contains:

- Agent header and close action
- Single chat transcript (no Raw Terminal toggle)
- Real-time structured message stream
- Prompt input docked to the bottom
- Special keys (`up`, `down`, `enter`)
- Collapsed tool-call blocks with merged continuous tool events

#### Diff

Contains:

- Changed file list
- Diff stat
- Per-file unified diff
- Actions to ask the agent to explain or revert a file

## 6. Launch Profiles

### Safe Plan

For analysis only. The profile should prepend a prompt instructing the agent not to modify files.

### Normal Coding

For day-to-day coding. Allows workspace changes while keeping important commands under confirmation.

### Full Auto

For long-running tasks in clean branches or disposable environments. The mobile UI must show a clear warning before launching.

### Review

For reviewing code or diffs without file modification.

## 7. MVP Scope

The v1.0 MVP includes:

- Add host.
- Connect over SSH through Tailscale.
- Run `ai-remote-helper doctor`.
- Scan repos.
- Create Codex session.
- Create Claude Code session.
- Select working directory.
- Select launch profile.
- Attach to tmux session.
- Resume existing session.
- Send prompt input.
- Send special keys: `up`, `down`, `enter`.
- Show session history in chat format.
- Replay and show tool calls from history.
- Show real-time tool calls in chat and fold them by default.
- Stop session.

Out of scope:

- Cloud sync.
- Team collaboration.
- Full mobile file editor.
- Complex permission system.
- Automatic command approval workflow.
- PR workflow.
- Push notifications.
- Multi-user administration.

## 8. Risks and Mitigations

### Non-tmux processes cannot be resumed

If the user runs `codex` directly in a normal terminal, MobileCodex cannot safely take over that process.

Mitigation: provide helper aliases such as `ai-codex ~/projects/travel-app` that always create tmux sessions.

### Mobile attach can resize tmux panes

Mitigation: support observe mode and document recommended tmux size behavior.

### Agent terminal output is not a stable API

Mitigation: keep terminal stream raw for v0.5. Use the helper for structured state such as repo, diff, status, and session metadata.

### Security

Minimum requirements:

- Store SSH keys in Keychain on mobile.
- Restrict host SSH access to Tailnet.
- Add repo allowlist support in the helper.
- Do not enable Full Auto by default.
- Do not read `.env`, token files, or private key files for previews.
- Keep local audit logs for session operations.

## 9. Development Phases

### Phase 0: Manual Chain Validation

Validate:

```bash
ssh user@host
tmux new -s codex__test
codex
tmux attach -t codex__test
```

### Phase 1: Helper MVP

Build:

- `doctor`
- `scan-repos`
- session ID generation
- metadata read/write
- `sessions`
- `new`
- `attach`
- `observe`

### Phase 2: Mobile SSH Terminal

Build:

- Host config
- SSH connection
- PTY stream
- terminal view
- special keys

### Phase 3: Agent Launcher

Build:

- repo picker
- profile picker
- initial prompt
- create and attach session

### Phase 4: Coding Workflow

Build:

- richer chat rendering
- tool call visibility
- reconnect and session continuity on mobile
- session-focused layout optimization

## 10. Current Development Decision

Current implementation is Web-first and can run behind a Tailscale-only HTTPS gateway.

The product currently runs as:

```text
mobile browser / PWA
  -> HTTPS + WebSocket
  -> mobilecodex server (Node.js)
  -> codex structured runtime + helper/tmux path
```

Current UI behavior in session mode:

- Hide top launch controls after entering a session.
- Keep composer docked to the bottom edge.
- Use a single transcript view.
- Render tool calls as folded blocks and merge continuous tool events.
