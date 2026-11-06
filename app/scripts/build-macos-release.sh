#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.config/tingo-signing/updater.key}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
if [[ ! -f "$TAURI_SIGNING_PRIVATE_KEY" ]]; then
  echo 'Missing updater signing key. Set TAURI_SIGNING_PRIVATE_KEY to its file path.' >&2
  exit 1
fi
export APPLE_SIGNING_IDENTITY="Developer ID Application: Cheng Tan (9YJL5M4BY8)"
npm run tauri -- build --config src-tauri/tauri.release.conf.json "$@"
app_path="src-tauri/target/release/bundle/macos/Tingo.app"
requirement='anchor apple generic and certificate leaf[subject.OU] = "9YJL5M4BY8"'
codesign --verify --deep --strict -R "=$requirement" "$app_path"
codesign --verify --strict -R "=$requirement" "$app_path/Contents/Resources/tingo-recorder"
