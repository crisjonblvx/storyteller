#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"

GITHUB_OWNER="${GITHUB_OWNER:-crisjonblvx}"
GITHUB_REPO="${GITHUB_REPO:-storyteller}"
APP_VERSION="${APP_VERSION:-1.0.0}"

echo "Building Storyteller desktop v${APP_VERSION}..."
echo "GitHub releases target: ${GITHUB_OWNER}/${GITHUB_REPO}"

cd "$ROOT"
npm run build --workspace=@storyteller/desktop

cd "$DESKTOP"

if [[ "${PUBLISH:-false}" == "true" ]]; then
  if [[ -z "${GH_TOKEN:-}" ]]; then
    echo "Set GH_TOKEN to publish a GitHub Release."
    exit 1
  fi
  npx electron-builder --mac --publish always \
    -c.publish.owner="$GITHUB_OWNER" \
    -c.publish.repo="$GITHUB_REPO"
else
  npx electron-builder --mac
  echo ""
  echo "Built installers in: $DESKTOP/release/"
  echo "Upload the .dmg files to: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases"
fi
