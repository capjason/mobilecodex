#!/usr/bin/env bash
set -euo pipefail

INSTALL_TAILSCALE="${INSTALL_TAILSCALE:-1}"
INSTALL_CODEX="${INSTALL_CODEX:-1}"
INSTALL_CLAUDE="${INSTALL_CLAUDE:-1}"
INSTALL_CADDY="${INSTALL_CADDY:-0}"

has_command() {
  command -v "$1" >/dev/null 2>&1
}

node_major() {
  node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0
}

node_ok() {
  has_command node && [[ "$(node_major)" -ge 20 ]]
}

sudo_cmd() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  elif sudo -n true >/dev/null 2>&1; then
    sudo -n "$@"
  else
    echo "Privileged install is required, but non-interactive sudo is not available." >&2
    echo "Ask the user to run the printed command in a normal terminal, then rerun this script." >&2
    return 80
  fi
}

can_run_privileged() {
  [[ "${EUID}" -eq 0 ]] || sudo -n true >/dev/null 2>&1
}

print_manual_commands() {
  echo >&2
  echo "Manual action required outside Codex/Claude Code:" >&2
  for command in "$@"; do
    echo "  ${command}" >&2
  done
  echo >&2
}

ensure_npm_user_prefix() {
  if npm prefix -g >/dev/null 2>&1 && [[ -w "$(npm prefix -g)" ]]; then
    return
  fi

  mkdir -p "${HOME}/.local"
  npm config set prefix "${HOME}/.local" >/dev/null
  export PATH="${HOME}/.local/bin:${PATH}"

  case ":${PATH}:" in
    *":${HOME}/.local/bin:"*) ;;
    *) echo 'Add ~/.local/bin to PATH so codex and claude are available in new shells.' ;;
  esac
}

install_system_packages() {
  local packages=("$@")
  if [[ "${#packages[@]}" -eq 0 ]]; then
    return
  fi

  if has_command apt-get; then
    if ! can_run_privileged; then
      print_manual_commands \
        "sudo apt-get update" \
        "sudo apt-get install -y ${packages[*]}"
      exit 80
    fi
    sudo_cmd apt-get update
    sudo_cmd apt-get install -y "${packages[@]}"
    return
  fi

  if has_command dnf; then
    if ! can_run_privileged; then
      print_manual_commands "sudo dnf install -y ${packages[*]}"
      exit 80
    fi
    sudo_cmd dnf install -y "${packages[@]}"
    return
  fi

  if has_command yum; then
    if ! can_run_privileged; then
      print_manual_commands "sudo yum install -y ${packages[*]}"
      exit 80
    fi
    sudo_cmd yum install -y "${packages[@]}"
    return
  fi

  if has_command pacman; then
    if ! can_run_privileged; then
      print_manual_commands "sudo pacman -Sy --needed --noconfirm ${packages[*]}"
      exit 80
    fi
    sudo_cmd pacman -Sy --needed --noconfirm "${packages[@]}"
    return
  fi

  if has_command brew; then
    local brew_packages=()
    for package in "${packages[@]}"; do
      if [[ "${package}" == "nodejs" ]]; then
        brew_packages+=(node)
      else
        brew_packages+=("${package}")
      fi
    done
    brew install "${brew_packages[@]}"
    return
  fi

  echo "No supported package manager found. Please install: ${packages[*]}" >&2
  return 1
}

install_node_if_needed() {
  if node_ok && has_command npm; then
    return
  fi

  if has_command apt-get && has_command curl; then
    if ! can_run_privileged; then
      print_manual_commands \
        "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -" \
        "sudo apt-get install -y nodejs"
      exit 80
    fi
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo_cmd bash -
    sudo_cmd apt-get install -y nodejs
    return
  fi

  install_system_packages nodejs npm
}

missing_packages=()

if ! node_ok || ! has_command npm; then
  install_node_if_needed
fi

if ! has_command git; then
  missing_packages+=(git)
fi

if ! has_command curl; then
  missing_packages+=(curl)
fi

if ! has_command tmux; then
  missing_packages+=(tmux)
fi

if [[ "${#missing_packages[@]}" -gt 0 ]]; then
  install_system_packages "${missing_packages[@]}"
fi

if [[ "${INSTALL_TAILSCALE}" == "1" ]] && ! has_command tailscale; then
  if has_command brew; then
    brew install --cask tailscale || true
  elif has_command curl; then
    if ! can_run_privileged; then
      print_manual_commands "curl -fsSL https://tailscale.com/install.sh | sh"
      exit 80
    fi
    curl -fsSL https://tailscale.com/install.sh | sh
  else
    echo "Tailscale is missing and curl is unavailable. Install Tailscale manually." >&2
  fi
fi

if [[ "${INSTALL_CADDY}" == "1" ]] && ! has_command caddy; then
  install_system_packages caddy
fi

if has_command npm; then
  ensure_npm_user_prefix
  if [[ "${INSTALL_CODEX}" == "1" ]] && ! has_command codex; then
    npm install -g @openai/codex
  fi
  if [[ "${INSTALL_CLAUDE}" == "1" ]] && ! has_command claude; then
    npm install -g @anthropic-ai/claude-code
  fi
else
  echo "npm is still unavailable; cannot install Codex CLI or Claude Code CLI automatically." >&2
fi

echo "Dependency installation step complete."
