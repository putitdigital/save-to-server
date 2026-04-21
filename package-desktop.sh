#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
BUNDLE_DIR="$DESKTOP_DIR/src-tauri/target/release/bundle"
DEFAULT_TAURI_KEY_FILE="$HOME/.tauri/flowit.key"

load_tauri_signing_key() {
  if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    return 0
  fi

  local key_file
  key_file="${TAURI_SIGNING_PRIVATE_KEY_FILE:-$DEFAULT_TAURI_KEY_FILE}"

  if [[ -f "$key_file" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$key_file")"
    echo "[preflight] Loaded TAURI_SIGNING_PRIVATE_KEY from: $key_file"
    return 0
  fi

  echo "[preflight] ERROR: Missing updater signing key"
  echo ""
  echo "Tauri updater is enabled in desktop/src-tauri/tauri.conf.json, so a private key is required."
  echo "Provide one of the following before packaging:"
  echo "  1) export TAURI_SIGNING_PRIVATE_KEY='...key contents...'"
  echo "  2) export TAURI_SIGNING_PRIVATE_KEY_FILE='$DEFAULT_TAURI_KEY_FILE'"
  echo ""
  echo "To generate a key file (if needed):"
  echo "  cd desktop && npm run tauri -- signer generate -w \"$DEFAULT_TAURI_KEY_FILE\""
  return 1
}

validate_tauri_signing_password() {
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
    echo "[preflight] WARNING: TAURI_SIGNING_PRIVATE_KEY_PASSWORD is not set."
    echo "[preflight]          If your key is password-protected, packaging will fail."
  fi
}

echo "[0/3] Checking updater signing environment..."
load_tauri_signing_key
validate_tauri_signing_password

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
