#!/bin/sh
# Read-only browser service, sharing TINGO_ROOT with the desktop application.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
binary=${TINGO_WEB_BINARY:-"$repo/app/engine/target/release/examples/serve"}
if [ ! -x "$binary" ]; then
  binary="$repo/app/engine/target/debug/examples/serve"
fi
if [ ! -x "$binary" ]; then
  echo '先运行 cargo build --manifest-path app/engine/Cargo.toml --example serve' >&2
  exit 1
fi
recorder=${TINGO_RECORDER_BIN:-"$repo/app/src-tauri/bin/tingo-recorder"}
exec "$binary" "${TINGO_MODELS_DIR:-$repo/.web-models}" "$recorder" "${TINGO_WEB_PORT:-8768}"
