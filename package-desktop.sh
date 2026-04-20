#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
BUNDLE_DIR="$DESKTOP_DIR/src-tauri/target/release/bundle"

echo "[1/3] Installing desktop dependencies..."
cd "$DESKTOP_DIR"
npm install

echo "[2/3] Building Flowit desktop package..."
npm run tauri build

echo "[3/3] Done"
echo "Package output: $BUNDLE_DIR"
if [[ -d "$BUNDLE_DIR/dmg" ]]; then
  echo "DMG files:"
  ls -1 "$BUNDLE_DIR/dmg"
fi
