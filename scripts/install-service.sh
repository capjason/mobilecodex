#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS_NAME="$(uname -s)"

case "${OS_NAME}" in
  Darwin)
    exec "${ROOT_DIR}/scripts/install-launchd-user.sh"
    ;;
  Linux)
    exec "${ROOT_DIR}/scripts/install-systemd-user.sh"
    ;;
  *)
    echo "Unsupported OS for automatic service install: ${OS_NAME}" >&2
    echo "Run MobileCodex manually with: cd ${ROOT_DIR} && npm run server" >&2
    exit 80
    ;;
esac
