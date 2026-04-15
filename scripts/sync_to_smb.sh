#!/bin/zsh

set -euo pipefail

# Local folder to sync from (default: OneDrive 2026 folder)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_LOCAL_SOURCE="/Users/sithembiso.sangweni/Library/CloudStorage/OneDrive-OneWorkplace/2026"
LOCAL_SOURCE="${LOCAL_SOURCE:-$DEFAULT_LOCAL_SOURCE}"

# SMB share details
SMB_URL="${SMB_URL:-smb://odcafs1-nas01.omc.oneds.com/TBWA_JHB_Clients}"
MOUNT_NAME="${MOUNT_NAME:-TBWA_JHB_Clients}"

# Optional folder inside the share
DEST_SUBPATH="${DEST_SUBPATH:-Front-End-Dev/TBWA Work Sithe/2026}"
DELETE_REMOTE="${DELETE_REMOTE:-false}"

EXCLUDE_FILE="${EXCLUDE_FILE:-$WORKSPACE_DIR/.syncignore}"
LOG_DIR="${LOG_DIR:-$WORKSPACE_DIR/logs}"
LOG_FILE="$LOG_DIR/sync.log"

mkdir -p "$LOG_DIR"

timestamp() {
  date "+%Y-%m-%d %H:%M:%S"
}

log() {
  echo "[$(timestamp)] $1" | tee -a "$LOG_FILE"
}

MOUNT_POINT="/Volumes/$MOUNT_NAME"

ensure_mounted() {
  if mount | grep -F "on $MOUNT_POINT " >/dev/null 2>&1; then
    log "Share already mounted at $MOUNT_POINT"
    return 0
  fi

  log "Mounting SMB share: $SMB_URL"
  /usr/bin/open "$SMB_URL" >/dev/null 2>&1 || true

  for _ in {1..15}; do
    if mount | grep -F "on $MOUNT_POINT " >/dev/null 2>&1; then
      log "Mounted successfully: $MOUNT_POINT"
      return 0
    fi
    sleep 1
  done

  log "ERROR: SMB share did not mount at $MOUNT_POINT"
  log "TIP: Open this URL in Finder and sign in, then run the script again: $SMB_URL"
  return 1
}

build_destination() {
  if [[ -n "$DEST_SUBPATH" ]]; then
    echo "$MOUNT_POINT/$DEST_SUBPATH"
  else
    echo "$MOUNT_POINT"
  fi
}

run_sync() {
  if [[ ! -d "$LOCAL_SOURCE" ]]; then
    log "ERROR: Local source does not exist: $LOCAL_SOURCE"
    return 1
  fi

  local destination
  destination="$(build_destination)"

  if [[ ! -d "$destination" ]]; then
    log "Creating destination folder: $destination"
    mkdir -p "$destination"
  fi

  local rsync_args
  rsync_args=(
    -av
    --human-readable
  )

  # Default behavior is additive/update sync only.
  if [[ "$DELETE_REMOTE" == "true" ]]; then
    rsync_args+=(--delete)
    log "Delete mode enabled: remote files missing locally will be removed"
  fi

  if [[ -f "$EXCLUDE_FILE" ]]; then
    rsync_args+=(--exclude-from="$EXCLUDE_FILE")
  fi

  log "Starting sync: $LOCAL_SOURCE -> $destination"
  /usr/bin/rsync "${rsync_args[@]}" "$LOCAL_SOURCE/" "$destination/" | tee -a "$LOG_FILE"
  log "Sync finished"
}

main() {
  log "==== Sync run start ===="
  ensure_mounted
  run_sync
  log "==== Sync run end ===="
}

main "$@"