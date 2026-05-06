#!/usr/bin/env bash
set -euo pipefail

MAC_HOST="${MAC_HOST:-}"
REMOTE_DIR="${REMOTE_DIR:-~/Desktop/mobilecodex-build}"
SCHEME="${SCHEME:-MobileCodex}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${MAC_HOST}" ]]; then
  echo "MAC_HOST is required, for example: MAC_HOST=user@mac-host.example.com $0" >&2
  exit 1
fi

echo "Syncing MobileCodex to ${MAC_HOST}:${REMOTE_DIR}"
ssh "${MAC_HOST}" "mkdir -p ${REMOTE_DIR}"
rsync -az --delete \
  "${ROOT_DIR}/" \
  "${MAC_HOST}:${REMOTE_DIR}/"

ssh "${MAC_HOST}" "cd ${REMOTE_DIR}/ios && \
  if ! command -v xcodegen >/dev/null 2>&1; then \
    echo 'xcodegen is required on the Mac. Install with: brew install xcodegen' >&2; \
    exit 1; \
  fi && \
  xcodegen generate && \
  xcodebuild -scheme ${SCHEME} -destination 'generic/platform=iOS' -configuration Release build"
