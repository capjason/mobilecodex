# ai-remote-helper

Host-side CLI for MobileCodex.

The helper is invoked through SSH by the mobile app. It does not run as a daemon.

## Commands

```bash
ai-remote-helper doctor --json
ai-remote-helper scan-repos --root <path> --depth <n> --json
ai-remote-helper sessions --json
ai-remote-helper new --agent <codex|claude> --repo <path> --profile <profile> --json
ai-remote-helper attach <sessionId>
ai-remote-helper observe <sessionId>
ai-remote-helper stop <sessionId> --json
ai-remote-helper restart <sessionId> --json
ai-remote-helper status <sessionId> --json
ai-remote-helper diff <sessionId> --json
```

## Local Development

```bash
npm test
node src/cli.js doctor --json
```

## Install Locally

For development:

```bash
npm link
ai-remote-helper doctor --json
```

For production hosts, copy the `helper/` directory and run the CLI with Node.js 20+.

## State

Session metadata is stored in:

```text
~/.ai-remote/sessions/
```

Use `--state-dir <path>` in tests or isolated environments.

