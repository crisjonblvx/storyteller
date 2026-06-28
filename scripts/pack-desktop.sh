#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"

GITHUB_OWNER="${GITHUB_OWNER:-crisjonblvx}"
GITHUB_REPO="${GITHUB_REPO:-storyteller}"
APP_VERSION="${APP_VERSION:-$(node -p "require('./apps/desktop/package.json').version" 2>/dev/null || echo '1.0.1')}"
STORYTELLER_BUILD_SHA="${STORYTELLER_BUILD_SHA:-$(git rev-parse --short HEAD 2>/dev/null || true)}"
export STORYTELLER_BUILD_SHA

echo "Building Storyteller desktop v${APP_VERSION}..."
echo "GitHub releases target: ${GITHUB_OWNER}/${GITHUB_REPO}"
if [[ -n "$STORYTELLER_BUILD_SHA" ]]; then
  echo "Build SHA: ${STORYTELLER_BUILD_SHA}"
fi


# Audio Director stays out of beta/production DMGs unless explicitly opted in.
# process.env wins over .env at Vite build time, so this blocks accidental enablement.
if [[ "${STORYTELLER_AUDIO_DIRECTOR_BUILD:-false}" != "true" ]]; then
  export VITE_AUDIO_DIRECTOR_ENABLED=
else
  echo "Audio Director build: VITE_AUDIO_DIRECTOR_ENABLED=${VITE_AUDIO_DIRECTOR_ENABLED:-true}"
fi

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
