#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
BUNDLE_DIR="$DESKTOP_DIR/src-tauri/target/release/bundle"
DEFAULT_TAURI_KEY_FILE="$HOME/.tauri/flowit.key"
DEFAULT_TAURI_PASSWORD_FILE="$HOME/.tauri/flowit.key.password"

require_semver_version() {
  local version="$1"
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "[release] ERROR: Invalid app version '$version'"
    echo "[release]        Expected semantic version format: X.Y.Z"
    return 1
  fi
}

require_release_tag_format() {
  local tag_name="$1"
  if [[ ! "$tag_name" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "[release] ERROR: Refusing to create non-release tag '$tag_name'"
    echo "[release]        Allowed format: vX.Y.Z"
    return 1
  fi
}

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
  if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
    return 0
  fi

  local password_file
  password_file="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD_FILE:-$DEFAULT_TAURI_PASSWORD_FILE}"

  if [[ -f "$password_file" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(<"$password_file")"
    echo "[preflight] Loaded TAURI_SIGNING_PRIVATE_KEY_PASSWORD from: $password_file"
    return 0
  fi

  echo "[preflight] WARNING: TAURI_SIGNING_PRIVATE_KEY_PASSWORD is not set."
  echo "[preflight]          If your key is password-protected, packaging will fail."
  echo "[preflight]          Provide one of the following before packaging:"
  echo "[preflight]            1) export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='...password...'"
  echo "[preflight]            2) export TAURI_SIGNING_PRIVATE_KEY_PASSWORD_FILE='$DEFAULT_TAURI_PASSWORD_FILE'"
}

echo "[0/4] Bumping patch version..."
TAURI_CONF="$DESKTOP_DIR/src-tauri/tauri.conf.json"
CARGO_TOML="$DESKTOP_DIR/src-tauri/Cargo.toml"

CURRENT_VERSION="$(grep '"version"' "$TAURI_CONF" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
CARGO_CURRENT_VERSION="$(sed -n -E 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' "$CARGO_TOML" | head -1)"
require_semver_version "$CURRENT_VERSION"
require_semver_version "$CARGO_CURRENT_VERSION"

if [[ "$CURRENT_VERSION" != "$CARGO_CURRENT_VERSION" ]]; then
  echo "[release] WARNING: Version mismatch detected"
  echo "[release]          tauri.conf.json: $CURRENT_VERSION"
  echo "[release]          Cargo.toml:      $CARGO_CURRENT_VERSION"
  echo "[release]          Continuing using tauri.conf.json as source of truth."
fi

MAJOR="$(echo "$CURRENT_VERSION" | cut -d. -f1)"
MINOR="$(echo "$CURRENT_VERSION" | cut -d. -f2)"
PATCH="$(echo "$CURRENT_VERSION" | cut -d. -f3)"
NEW_PATCH=$(( PATCH + 1 ))
NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"

echo "[0/4] Bumping $CURRENT_VERSION -> $NEW_VERSION"

# Update tauri.conf.json
python3 -c "
import re, sys
path = sys.argv[1]
new_ver = sys.argv[2]
content = open(path).read()
content = re.sub(r'(\"version\"\s*:\s*\")([0-9]+\\.[0-9]+\\.[0-9]+)(\")', r'\\g<1>' + new_ver + r'\\g<3>', content, count=1)
open(path, 'w').write(content)
" "$TAURI_CONF" "$NEW_VERSION"

# Update Cargo.toml (only the [package] version line, not dependency versions)
python3 -c "
import re, sys
path = sys.argv[1]
new_ver = sys.argv[2]
content = open(path).read()
# Only replace the first bare version = \"...\" line (the [package] version)
content = re.sub(r'^(version = \")[0-9]+\\.[0-9]+\\.[0-9]+(\")', r'\\g<1>' + new_ver + r'\\g<2>', content, count=1, flags=re.MULTILINE)
open(path, 'w').write(content)
" "$CARGO_TOML" "$NEW_VERSION"

UPDATED_TAURI_VERSION="$(grep '"version"' "$TAURI_CONF" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
UPDATED_CARGO_VERSION="$(sed -n -E 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' "$CARGO_TOML" | head -1)"

if [[ "$UPDATED_TAURI_VERSION" != "$NEW_VERSION" || "$UPDATED_CARGO_VERSION" != "$NEW_VERSION" ]]; then
  echo "[release] ERROR: Failed to update versions consistently"
  echo "[release]        tauri.conf.json: $UPDATED_TAURI_VERSION"
  echo "[release]        Cargo.toml:      $UPDATED_CARGO_VERSION"
  exit 1
fi

cd "$ROOT_DIR"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ -z "$CURRENT_BRANCH" || "$CURRENT_BRANCH" == "HEAD" ]]; then
  echo "[release] ERROR: Detached HEAD is not supported for automated releases."
  exit 1
fi

git add "$TAURI_CONF" "$CARGO_TOML"
git commit -m "chore(release): bump version to $NEW_VERSION"
git push origin "$CURRENT_BRANCH"

echo "[0/4] Checking updater signing environment..."
load_tauri_signing_key
validate_tauri_signing_password

echo "[1/4] Installing desktop dependencies..."
cd "$DESKTOP_DIR"
npm install

echo "[2/4] Building Flowit desktop package..."
npm run tauri build

echo "[3/4] Done"
echo "Package output: $BUNDLE_DIR"
if [[ -d "$BUNDLE_DIR/dmg" ]]; then
  echo "DMG files:"
  ls -1 "$BUNDLE_DIR/dmg"
fi

# --- Auto-tag and push release ---
TAG_NAME="v$NEW_VERSION"
require_release_tag_format "$TAG_NAME"

cd "$ROOT_DIR"
echo ""
echo "[4/4] Tagging release $TAG_NAME..."

if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  echo "[4/4] Tag $TAG_NAME already exists — skipping tag creation."
else
  git tag -a "$TAG_NAME" -m "Release $TAG_NAME"
  echo "[4/4] Created tag $TAG_NAME"
fi

echo "[4/4] Pushing $TAG_NAME to origin..."
git push origin "$TAG_NAME"
echo "[4/4] Done — $TAG_NAME is live on GitHub."
