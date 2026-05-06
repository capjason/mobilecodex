#!/usr/bin/env bash
set -euo pipefail

has_command() {
  command -v "$1" >/dev/null 2>&1
}

print_status() {
  local name="$1"
  local status="$2"
  local detail="${3:-}"
  if [[ -n "${detail}" ]]; then
    printf '%-12s %s  %s\n' "${name}" "${status}" "${detail}"
  else
    printf '%-12s %s\n' "${name}" "${status}"
  fi
}

if has_command node; then
  print_status node ok "$(node --version)"
else
  print_status node missing "Install Node.js 20 or newer."
fi

if has_command npm; then
  print_status npm ok "$(npm --version)"
else
  print_status npm missing "Install npm."
fi

if has_command codex; then
  print_status codex ok "$(codex --version 2>/dev/null || echo installed)"
else
  print_status codex missing "Install and log in to Codex CLI if you want Codex sessions."
fi

if has_command claude; then
  print_status claude ok "$(claude --version 2>/dev/null || echo installed)"
else
  print_status claude missing "Install and log in to Claude Code if you want Claude sessions."
fi

if has_command tmux; then
  print_status tmux ok "$(tmux -V 2>/dev/null || echo installed)"
else
  print_status tmux missing "Install tmux for Claude Code/tmux-backed sessions."
fi

if has_command tailscale; then
  if tailscale status >/dev/null 2>&1; then
    print_status tailscale ok "$(tailscale ip -4 2>/dev/null | head -n 1)"
  else
    print_status tailscale "manual" "Run: sudo tailscale up"
  fi
else
  print_status tailscale missing "Recommended for phone-to-host intranet access."
fi
