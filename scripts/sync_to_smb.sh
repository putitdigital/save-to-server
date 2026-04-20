#!/bin/zsh

set -euo pipefail

# Local folder to sync from (default: OneDrive 2026 folder)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Optional user-local overrides from easy.sh desktop prompt.
if [[ -f "$WORKSPACE_DIR/.local.env" ]]; then
  source "$WORKSPACE_DIR/.local.env"
fi

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
PID_FILE="$LOG_DIR/sync.pid"

RUN_USER="$(/usr/bin/id -un 2>/dev/null || echo unknown)"
RUN_FULL_NAME="$(/usr/bin/id -F 2>/dev/null || true)"

if [[ -n "$RUN_FULL_NAME" && "$RUN_FULL_NAME" != "$RUN_USER" ]]; then
  LOG_ACTOR="$RUN_FULL_NAME ($RUN_USER)"
else
  LOG_ACTOR="$RUN_USER"
fi

mkdir -p "$LOG_DIR"

timestamp() {
  date "+%Y-%m-%d %H:%M:%S"
}

log() {
  echo "[$(timestamp)] [user: $LOG_ACTOR] $1" | tee -a "$LOG_FILE"
}

cleanup_pid_file() {
  rm -f "$PID_FILE"
}

print_status() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"

    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      echo "Running (PID: $pid)"
      return 0
    fi

    rm -f "$PID_FILE"
    echo "Idle (stale state cleared)"
    return 0
  fi

  echo "Idle"
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

run_sync_changes_count() {
  if [[ ! -d "$LOCAL_SOURCE" ]]; then
    log "ERROR: Local source does not exist: $LOCAL_SOURCE"
    echo "PENDING_COUNT=0"
    return 0
  fi

  local destination
  destination="$(build_destination)"

  if [[ ! -d "$destination" ]]; then
    mkdir -p "$destination"
  fi

  local rsync_args
  rsync_args=(
    -av
    --human-readable
    --dry-run
    --itemize-changes
    --out-format="%i %n"
  )

  if [[ "$DELETE_REMOTE" == "true" ]]; then
    rsync_args+=(--delete)
  fi

  if [[ -f "$EXCLUDE_FILE" ]]; then
    rsync_args+=(--exclude-from="$EXCLUDE_FILE")
  fi

  local output
  output="$(/usr/bin/rsync "${rsync_args[@]}" "$LOCAL_SOURCE/" "$destination/" 2>/dev/null || true)"

  local count
  count="$(
    printf "%s\n" "$output" |
        awk 'NF && $2 != "." && $1 != "sending" && $1 != "sent" && $1 != "total" && $1 != "Transfer" && $2 !~ /\/$/ && $1 != ".f...p..." && $1 != ".d...p..." { c++ } END { print c + 0 }'
  )"

  echo "PENDING_COUNT=${count}"
}

main() {
  if [[ "${1:-}" == "status" ]]; then
    print_status
    return 0
  fi

  if [[ "${1:-}" == "changes-count" ]]; then
    ensure_mounted
    run_sync_changes_count
    return 0
  fi

  if [[ -f "$PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"

    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      log "Another sync is already running (PID: $existing_pid)"
      return 1
    fi

    rm -f "$PID_FILE"
  fi

  echo "$$" > "$PID_FILE"
  trap cleanup_pid_file EXIT INT TERM

  log "==== Sync run start ===="
  ensure_mounted
  run_sync
  log "==== Sync run end ===="
}

main "$@"