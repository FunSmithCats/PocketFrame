#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <tag> [dmg_path]" >&2
  echo "Example: $0 v0.1.0-alpha.1 release/PocketFrame-1.0.0-arm64.dmg" >&2
  exit 1
fi

TAG="$1"
DMG_PATH="${2:-}"

if [[ -z "$DMG_PATH" ]]; then
  DMG_PATH="$(ls -1 release/*.dmg 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$DMG_PATH" || ! -f "$DMG_PATH" ]]; then
  echo "Error: Could not find DMG file. Pass one explicitly as the 2nd arg." >&2
  exit 1
fi

echo "Creating prerelease $TAG with asset: $DMG_PATH"

gh release create "$TAG" "$DMG_PATH" \
  --title "PocketFrame $TAG" \
  --notes-file docs/alpha/ALPHA_RELEASE_NOTES_TEMPLATE.md \
  --prerelease

echo "Done."
