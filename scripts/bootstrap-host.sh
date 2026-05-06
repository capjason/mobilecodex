#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

HOST_BIND="${HOST:-0.0.0.0}"
PORT_VALUE="${PORT:-8787}"
DEFAULT_WORKDIR="${VITE_DEFAULT_WORKDIR:-${HOME}/workspace}"
RUN_TESTS="${RUN_TESTS:-0}"
AUTO_INSTALL_DEPS="${AUTO_INSTALL_DEPS:-1}"

echo "== MobileCodex bootstrap =="
echo "Repository: ${ROOT_DIR}"

if [[ "${AUTO_INSTALL_DEPS}" == "1" ]]; then
  "${ROOT_DIR}/scripts/install-host-deps.sh"
fi

"${ROOT_DIR}/scripts/doctor-host.sh"

if [[ ! -f .env ]]; then
  cat > .env <<EOF
HOST=${HOST_BIND}
PORT=${PORT_VALUE}
VITE_DEFAULT_WORKDIR=${DEFAULT_WORKDIR}
VITE_DEV_BACKEND_URL=http://127.0.0.1:${PORT_VALUE}
EOF
  echo "Created .env"
else
  echo ".env already exists; leaving it unchanged."
fi

npm install

if [[ "${RUN_TESTS}" == "1" ]]; then
  npm test
fi

npm run web:build

echo
echo "Bootstrap complete."
echo "Run locally with:"
echo "  HOST=${HOST_BIND} PORT=${PORT_VALUE} npm run server"

if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
  TAILSCALE_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
  if [[ -n "${TAILSCALE_IP}" ]]; then
    echo
    echo "Open from your phone:"
    echo "  http://${TAILSCALE_IP}:${PORT_VALUE}"
  fi
else
  echo
  echo "Manual action needed for phone access:"
  echo "  1. Install Tailscale on this host and on your phone."
  echo "  2. Log in to the same Tailnet."
  echo "  3. On this host, run: sudo tailscale up"
  echo "  4. Then run: tailscale ip -4"
  echo "  5. Open: http://<tailscale-ip>:${PORT_VALUE}"
fi
