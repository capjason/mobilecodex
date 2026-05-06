#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS_NAME="$(uname -s)"
SERVICE_NAME="${SERVICE_NAME:-}"
if [[ -z "${SERVICE_NAME}" ]]; then
  if [[ "${OS_NAME}" == "Darwin" ]]; then
    SERVICE_NAME="com.mobilecodex.server"
  else
    SERVICE_NAME="mobilecodex.service"
  fi
fi
SKIP_PULL="${SKIP_PULL:-0}"
RUN_TESTS="${RUN_TESTS:-0}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT:-8787}/api/health}"

manual_restart_commands() {
  cat <<EOF >&2
Update completed, but the service was not restarted automatically.

Run this one command in a normal terminal on the host:

  cd ${ROOT_DIR} && scripts/update-and-restart.sh

Then open MobileCodex from your phone again.
EOF
}

cd "${ROOT_DIR}"

if [[ ! -d .git ]]; then
  echo "This directory is not a git checkout: ${ROOT_DIR}" >&2
  echo "Clone https://github.com/capjason/mobilecodex.git, then run this script from that checkout." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree has local changes. Commit, stash, or discard them before updating." >&2
  git status --short >&2
  exit 1
fi

if [[ "${SKIP_PULL}" != "1" ]]; then
  git pull --ff-only
fi

npm install

if [[ "${RUN_TESTS}" == "1" ]]; then
  npm test
fi

npm run web:build

if [[ "${OS_NAME}" == "Darwin" ]]; then
  if ! command -v launchctl >/dev/null 2>&1; then
    manual_restart_commands
    exit 80
  fi
  if ! launchctl print "gui/$(id -u)/${SERVICE_NAME}" >/dev/null 2>&1; then
    echo "${SERVICE_NAME} is not installed." >&2
    echo "Run scripts/install-service.sh first." >&2
    manual_restart_commands
    exit 80
  fi
  if ! launchctl kickstart -k "gui/$(id -u)/${SERVICE_NAME}"; then
    manual_restart_commands
    exit 80
  fi
  sleep 1
else
  if ! command -v systemctl >/dev/null 2>&1; then
    manual_restart_commands
    exit 80
  fi

  if ! systemctl --user list-unit-files "${SERVICE_NAME}" >/dev/null 2>&1; then
    echo "${SERVICE_NAME} is not installed." >&2
    echo "Run scripts/install-service.sh first." >&2
    manual_restart_commands
    exit 80
  fi

  if ! systemctl --user restart "${SERVICE_NAME}"; then
    manual_restart_commands
    exit 80
  fi

  sleep 1

  if ! systemctl --user is-active --quiet "${SERVICE_NAME}"; then
    systemctl --user status "${SERVICE_NAME}" --no-pager -l || true
    manual_restart_commands
    exit 80
  fi
fi

curl -sS "${HEALTH_URL}"
echo
echo "MobileCodex updated and restarted."
