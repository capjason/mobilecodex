# MobileCodex Agent Guide

This file is for Codex and Claude Code agents working in this repository.

## Project Intent

MobileCodex is a mobile-first Web/PWA control surface for local Codex CLI and Claude Code CLI sessions.

The default deployment is intentionally simple:

```text
phone browser
  -> Tailscale private network
  -> http://<host-tailnet-ip>:8787
  -> MobileCodex Node server
  -> Codex CLI structured runtime or Claude Code CLI/tmux runtime
```

Do not make SSH, a public domain, or HTTPS mandatory for the basic path. If a user already has a domain and reverse proxy, HTTPS is an optional deployment layer:

```text
phone browser
  -> Tailscale or trusted network
  -> https://mobilecodex.example.com
  -> reverse proxy
  -> http://127.0.0.1:8787
```

## Basic Host Setup

Required host tools:

```bash
node --version
npm --version
codex --version
claude --version
```

At least one of `codex` or `claude` must be installed and logged in on the host.

If dependencies are missing, install them for the user when possible. Prefer the repository installer:

```bash
scripts/install-host-deps.sh
```

That script may install:

- Node.js / npm
- git
- curl
- tmux
- Tailscale
- Codex CLI via npm package `@openai/codex`
- Claude Code CLI via npm package `@anthropic-ai/claude-code`

Do not wait for an interactive sudo password. Codex/Claude Code sessions may not be able to complete password prompts reliably.

Rules for privileged commands:

- If running as root, proceed.
- If `sudo -n true` succeeds, you may use `sudo -n`.
- If `sudo -n true` fails, stop and print the exact commands the user must run in a normal terminal.
- After the user confirms those commands are done, rerun the installer and continue.
- Do not ask the user to manually install dependencies unless privileged execution is unavailable or the local OS/package manager is unsupported.

Authentication remains a human boundary:

- If Codex CLI is installed but not logged in, ask the user to complete `codex` login.
- If Claude Code CLI is installed but not logged in, ask the user to complete `claude` login.
- Do not read or print credentials, auth files, browser cookies, token files, or shell history.

Recommended network setup:

1. Install Tailscale on the host and phone.
2. Confirm the phone can reach the host Tailnet IP or MagicDNS name.
3. Run MobileCodex bound to the host network:

```bash
npm install
npm run web:build
HOST=0.0.0.0 PORT=8787 npm run server
```

Then open:

```text
http://<host-tailnet-ip>:8787
```

Optional local configuration:

```bash
cp .env.example .env
```

Important environment variables:

```text
HOST                  server bind host, usually 0.0.0.0 for Tailnet access
PORT                  server port, default 8787
VITE_DEFAULT_WORKDIR  default launch directory shown in the UI
VITE_DEV_BACKEND_URL  Vite dev proxy backend
```

## Automated Install Flow

When a user asks you to install MobileCodex, use the repository scripts instead of improvising:

```bash
scripts/bootstrap-host.sh
scripts/install-service.sh
curl -sS http://127.0.0.1:8787/api/health
```

`scripts/bootstrap-host.sh` is the default one-shot installer. It checks host tools, creates `.env` if missing, installs npm dependencies, and builds the web app.

`scripts/install-service.sh` installs the user auto-start service. It delegates to systemd on Linux and launchd LaunchAgent on macOS. Treat this as required for a complete install: the user should be able to close Codex/Claude Code and still open MobileCodex from the phone.

If the service step cannot be completed automatically:

- Tell the user the install is not complete.
- Print exactly one command for them to run in a normal terminal: `cd <repo> && scripts/install-service.sh`.
- Stop and wait for the user to confirm the service was installed.
- Continue only after `curl -sS http://127.0.0.1:8787/api/health` succeeds.

`scripts/doctor-host.sh` is a preflight checker for Node, npm, Codex CLI, Claude Code CLI, tmux, and Tailscale.

## Update Flow

When a user asks you to update MobileCodex, use:

```bash
scripts/update-and-restart.sh
```

The update script must:

- require a clean git working tree
- pull with `--ff-only`
- run `npm install`
- run `npm run web:build`
- restart the configured user service (`mobilecodex.service` on Linux, `com.mobilecodex.server` on macOS)
- verify `curl -sS http://127.0.0.1:8787/api/health`

If the service restart cannot be completed automatically:

- Tell the user the update is not complete.
- Print exactly one command for them to run in a normal terminal: `cd <repo> && scripts/update-and-restart.sh`.
- Stop and wait for the user to confirm the service was restarted.

Manual action boundary:

- You may check whether `tailscale` is installed and logged in.
- You may show the user the command `sudo tailscale up`.
- Do not attempt to complete browser-based Tailscale login, account registration, SSO, or device approval yourself.
- If Tailscale is not ready, stop and ask the user to complete login, then continue installation after they confirm.

## Optional HTTPS Flow

HTTPS is optional. Do not require it for the basic Tailscale install.

Use HTTPS only when the user has a domain or explicitly asks for HTTPS. Human prerequisites:

- The user owns a domain/subdomain.
- DNS points the domain to the host.
- Ports 80 and 443 can reach the host.
- The user confirms whether an existing reverse proxy is already managing that domain.

Preferred simple path for a clean host:

```bash
DOMAIN=mobilecodex.example.com scripts/install-https-caddy.sh
curl -k https://mobilecodex.example.com/api/health
```

Rules for HTTPS setup:

- Use Caddy for new/simple deployments because it can manage Let's Encrypt certificates automatically.
- Keep MobileCodex itself bound to `127.0.0.1:8787` or the configured `PORT`.
- Do not bind the Node server directly to 443.
- Do not overwrite an existing Caddyfile or reverse proxy config that may serve other apps.
- If the host is clean and the existing Caddyfile is only a default placeholder, ask the user before using `OVERWRITE=1`.
- If an existing proxy config is present and cannot be safely edited, stop and show the user the reverse proxy block to merge.
- If DNS or firewall is not ready, tell the user exactly what manual step remains.
- Do not wait for an interactive sudo password. Use root or `sudo -n`; otherwise print the exact Caddy/systemctl commands for the user to run in a normal terminal.

Generic reverse proxy block:

```text
mobilecodex.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8787
}
```

Human-only HTTPS tasks:

- Buying or configuring the domain.
- Updating DNS records.
- Opening router/cloud firewall ports 80 and 443.
- Approving any account, ACME, or hosting-provider dashboard prompts.

## iPhone Home Screen

After the service is reachable, tell the user:

1. Open the MobileCodex URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Launch MobileCodex from the Home Screen icon.

Mention that Safari is required for adding the PWA to the iPhone Home Screen.

## Runtime Rules

Codex:

- Prefer the structured runtime in `server/src/codex-structured.js`.
- Keep browser disconnects independent from active Codex work.
- Tool events for one command/tool call must update one existing tool card, not create separate Tool Output or Completed cards.
- Preserve support for model and reasoning effort selection.

Claude Code:

- Use the existing CLI/tmux path.
- Do not assume Claude Code has the same structured app-server interface as Codex.
- Keep Claude support focused on launching, resuming, and interacting with the CLI.

## Product Constraints

- This is not a generic terminal app.
- This is not a mobile IDE.
- The main UX should be a compact mobile chat/session console.
- Support only Codex CLI and Claude Code CLI unless the user explicitly asks otherwise.
- Keep Tailscale/intranet deployment the default recommendation.
- Treat public HTTPS/domain deployment as optional.
- Do not commit personal domains, usernames, local paths, tokens, certificates, or private keys.
- Put machine-specific values in environment variables, `.env`, or local service/proxy config.
- Keep `.env.example` public-safe.

## Repository Map

```text
server/    Node host server, JSON APIs, WebSockets, Codex structured runtime
web/       React mobile web UI
helper/    host helper modules for tmux/session metadata/repo scanning
ios/       early iOS shell prototype
docs/      technical design notes
scripts/   local helper scripts
```

## Verification

Run these before claiming a code change is complete:

```bash
npm test
npm run web:build
```

After deployment changes, verify the server locally:

```bash
curl -sS http://127.0.0.1:8787/api/health
```

If running behind HTTPS, also verify the external URL:

```bash
curl -k https://mobilecodex.example.com/api/health
```

## Open Source Hygiene

Before publishing or committing broad changes, scan for local/private values:

```bash
rg -n "your-domain|your-user|/home/your-user|/Users/your-user|credential|secret|password|token" .
find . -path './node_modules' -prune -o -path './dist' -prune -o -type f \
  \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.crt' \) -print
```

Do not read or include real `.env`, token, certificate, or private key contents in responses or committed files.
