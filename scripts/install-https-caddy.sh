#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-${MOBILECODEX_DOMAIN:-}}"
PORT_VALUE="${PORT:-8787}"
EMAIL="${EMAIL:-${ACME_EMAIL:-}}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
OVERWRITE="${OVERWRITE:-0}"
MARKER_BEGIN="# BEGIN MobileCodex"
MARKER_END="# END MobileCodex"

can_run_privileged() {
  [[ "${EUID}" -eq 0 ]] || sudo -n true >/dev/null 2>&1
}

sudo_cmd() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  elif sudo -n true >/dev/null 2>&1; then
    sudo -n "$@"
  else
    echo "Privileged HTTPS setup is required, but non-interactive sudo is not available." >&2
    echo "Ask the user to run the needed Caddy commands in a normal terminal, then rerun verification." >&2
    return 80
  fi
}

if [[ -z "${DOMAIN}" ]]; then
  echo "DOMAIN is required. Example: DOMAIN=mobilecodex.example.com $0" >&2
  exit 1
fi

if ! command -v caddy >/dev/null 2>&1; then
  INSTALL_CADDY=1 "$(dirname "$0")/install-host-deps.sh"
fi

config_block() {
  if [[ -n "${EMAIL}" ]]; then
    cat <<EOF
${MARKER_BEGIN}
{
  email ${EMAIL}
}

${DOMAIN} {
  encode zstd gzip
  @notTailnet {
    not remote_ip 100.64.0.0/10 fd7a:115c:a1e0::/48
  }
  respond @notTailnet "Forbidden" 403
  reverse_proxy 127.0.0.1:${PORT_VALUE}
}
${MARKER_END}
EOF
  else
    cat <<EOF
${MARKER_BEGIN}
${DOMAIN} {
  encode zstd gzip
  @notTailnet {
    not remote_ip 100.64.0.0/10 fd7a:115c:a1e0::/48
  }
  respond @notTailnet "Forbidden" 403
  reverse_proxy 127.0.0.1:${PORT_VALUE}
}
${MARKER_END}
EOF
  fi
}

tmp_file="$(mktemp)"
trap 'rm -f "${tmp_file}"' EXIT

if [[ -f "${CADDYFILE}" ]]; then
  if grep -q "${MARKER_BEGIN}" "${CADDYFILE}"; then
    awk -v begin="${MARKER_BEGIN}" -v end="${MARKER_END}" '
      $0 == begin { skipping = 1; next }
      $0 == end { skipping = 0; next }
      !skipping { print }
    ' "${CADDYFILE}" > "${tmp_file}"
    {
      cat "${tmp_file}"
      echo
      config_block
    } > "${tmp_file}.new"
  elif [[ -s "${CADDYFILE}" && "${OVERWRITE}" != "1" ]]; then
    echo "Existing Caddyfile has no MobileCodex marker: ${CADDYFILE}" >&2
    echo "Not editing it automatically to avoid breaking other sites." >&2
    echo "Add this block manually or rerun with CADDYFILE pointing to a dedicated Caddyfile:" >&2
    config_block >&2
    exit 1
  else
    config_block > "${tmp_file}.new"
  fi
else
  mkdir -p "$(dirname "${tmp_file}")"
  config_block > "${tmp_file}.new"
fi

if [[ "${EUID}" -eq 0 ]]; then
  mkdir -p "$(dirname "${CADDYFILE}")"
  cp "${tmp_file}.new" "${CADDYFILE}"
else
  if ! can_run_privileged; then
    echo "Manual action required outside Codex/Claude Code:" >&2
    echo "  sudo mkdir -p $(dirname "${CADDYFILE}")" >&2
    echo "  sudo editor ${CADDYFILE}" >&2
    echo "  sudo systemctl enable --now caddy" >&2
    echo "  sudo systemctl reload caddy || sudo systemctl restart caddy" >&2
    echo >&2
    echo "Add this Caddyfile content:" >&2
    cat "${tmp_file}.new" >&2
    exit 80
  fi
  sudo_cmd mkdir -p "$(dirname "${CADDYFILE}")"
  sudo_cmd cp "${tmp_file}.new" "${CADDYFILE}"
fi

if command -v systemctl >/dev/null 2>&1; then
  sudo_cmd systemctl enable --now caddy
  sudo_cmd systemctl reload caddy || sudo_cmd systemctl restart caddy
fi

echo "HTTPS configured for https://${DOMAIN}"
echo "Verify with: curl -k https://${DOMAIN}/api/health"
