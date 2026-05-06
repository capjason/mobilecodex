#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.mobilecodex.server"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/MobileCodex"
NPM_BIN="$(command -v npm)"
PORT_VALUE="${PORT:-8787}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT_VALUE}/api/health}"

xml_escape() {
  printf '%s' "$1" \
    | sed \
      -e 's/&/\&amp;/g' \
      -e 's/</\&lt;/g' \
      -e 's/>/\&gt;/g' \
      -e 's/"/\&quot;/g' \
      -e "s/'/\&apos;/g"
}

print_manual_service_command() {
  cat <<EOF >&2
LaunchAgent was not installed automatically.

Run this one command in a normal terminal on the Mac:

  cd ${ROOT_DIR} && scripts/install-service.sh

Then return to Codex/Claude Code and say the service step is complete.
EOF
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "install-launchd-user.sh is only for macOS." >&2
  exit 80
fi

mkdir -p "${PLIST_DIR}" "${LOG_DIR}"

ROOT_XML="$(xml_escape "${ROOT_DIR}")"
NPM_XML="$(xml_escape "${NPM_BIN}")"
PATH_XML="$(xml_escape "${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")"
NPM_PREFIX_XML="$(xml_escape "${HOME}/.npm-global")"
STDOUT_XML="$(xml_escape "${LOG_DIR}/server.log")"
STDERR_XML="$(xml_escape "${LOG_DIR}/server.err.log")"
COMMAND_XML="$(xml_escape 'cd "$MOBILECODEX_ROOT" && if [ -f .env ]; then set -a; . ./.env; set +a; fi; exec "$MOBILECODEX_NPM" run server')"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${ROOT_XML}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${COMMAND_XML}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${PATH_XML}</string>
    <key>MOBILECODEX_ROOT</key>
    <string>${ROOT_XML}</string>
    <key>MOBILECODEX_NPM</key>
    <string>${NPM_XML}</string>
    <key>NPM_CONFIG_PREFIX</key>
    <string>${NPM_PREFIX_XML}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${STDOUT_XML}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_XML}</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "${PLIST_PATH}" >/dev/null 2>&1 || true
if ! launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"; then
  print_manual_service_command
  exit 80
fi

launchctl enable "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
sleep 1

if ! curl -sS "${HEALTH_URL}" >/dev/null 2>&1; then
  launchctl print "gui/$(id -u)/${LABEL}" || true
  tail -n 80 "${LOG_DIR}/server.err.log" 2>/dev/null || true
  print_manual_service_command
  exit 80
fi

echo "Installed LaunchAgent: ${PLIST_PATH}"
curl -sS "${HEALTH_URL}"
echo
