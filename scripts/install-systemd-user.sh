#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_PATH="${SERVICE_DIR}/mobilecodex.service"
NPM_BIN="$(command -v npm)"

print_manual_service_commands() {
  cat <<EOF >&2
Systemd user service was not installed automatically.

Run this one command in a normal terminal on the host:

  cd ${ROOT_DIR} && scripts/install-service.sh

Then return to Codex/Claude Code and say the service step is complete.
EOF
}

if ! command -v systemctl >/dev/null 2>&1; then
  print_manual_service_commands
  exit 80
fi

mkdir -p "${SERVICE_DIR}"

cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=MobileCodex host server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT_DIR}
EnvironmentFile=-${ROOT_DIR}/.env
ExecStart=${NPM_BIN} run server
Environment=PATH=${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now mobilecodex.service
sleep 1

if ! systemctl --user is-active --quiet mobilecodex.service; then
  systemctl --user status mobilecodex.service --no-pager -l || true
  print_manual_service_commands
  exit 80
fi

echo "Installed user service: ${SERVICE_PATH}"
systemctl --user status mobilecodex.service --no-pager -l
