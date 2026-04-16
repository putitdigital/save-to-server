#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_SCRIPT="$SCRIPT_DIR/run.sh"
SYNC_SCRIPT="$SCRIPT_DIR/scripts/sync_to_smb.sh"
IGNORE_SCRIPT="$SCRIPT_DIR/ignore"
CONFIG_FILE="$SCRIPT_DIR/.local.env"
LOG_DIR="$SCRIPT_DIR/logs"
SYNC_LOG="$LOG_DIR/sync.log"
OUT_LOG="$LOG_DIR/launchd.out.log"
ERR_LOG="$LOG_DIR/launchd.err.log"
LAUNCH_AGENT_LABEL="com.save-to-server.sync"
LAUNCH_AGENT_PATH="$HOME/Library/LaunchAgents/$LAUNCH_AGENT_LABEL.plist"

mkdir -p "$LOG_DIR"

notify() {
  local message="$1"
  local title="${2:-Save To Server}"

  osascript - "$message" "$title" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set msg to item 1 of argv
  set titleText to item 2 of argv
  display notification msg with title titleText
end run
APPLESCRIPT
}

get_configured_source() {
  local configured_source=""

  if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
    configured_source="${LOCAL_SOURCE:-}"
  fi

  echo "$configured_source"
}

set_local_workspace() {
  local selected_folder

  if ! selected_folder="$(osascript <<'APPLESCRIPT'
POSIX path of (choose folder with prompt "Select the local workspace folder you want to sync")
APPLESCRIPT
)"; then
    echo
    echo "Folder selection was canceled."
    return 1
  fi

  selected_folder="${selected_folder%/}"

  cat > "$CONFIG_FILE" <<EOF
LOCAL_SOURCE="$selected_folder"
EOF

  echo
  echo "Saved local workspace: $selected_folder"
  notify "Local workspace saved" "Save To Server"
}

print_header() {
  echo
  echo "==========================================="
  echo " Save To Server - Simple Menu"
  echo "==========================================="
}

print_menu() {
  echo "1) Sync now"
  echo "2) Check sync status"
  echo "3) Show ignored files (.syncignore)"
  echo "4) Open logs folder"
  echo "5) Install auto-sync (every 5 minutes)"
  echo "6) Remove auto-sync"
  echo "7) Run health check"
  echo "8) Set local workspace folder"
  echo "0) Exit"
  echo
}

install_auto_sync() {
  mkdir -p "$HOME/Library/LaunchAgents"

  cat > "$LAUNCH_AGENT_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCH_AGENT_LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$SYNC_SCRIPT</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>StartInterval</key>
  <integer>300</integer>

  <key>StandardOutPath</key>
  <string>$OUT_LOG</string>
  <key>StandardErrorPath</key>
  <string>$ERR_LOG</string>
</dict>
</plist>
EOF

  launchctl bootout "gui/$(id -u)" "$LAUNCH_AGENT_PATH" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENT_PATH"

  echo
  echo "Auto-sync installed and started."
  echo "It runs every 5 minutes."
}

remove_auto_sync() {
  launchctl bootout "gui/$(id -u)" "$LAUNCH_AGENT_PATH" >/dev/null 2>&1 || true
  rm -f "$LAUNCH_AGENT_PATH"

  echo
  echo "Auto-sync removed."
}

health_check() {
  local configured_source
  configured_source="$(get_configured_source)"

  echo
  echo "Health check"

  if [[ -x "$SYNC_SCRIPT" ]]; then
    echo "- Sync script: OK"
  else
    echo "- Sync script: MISSING or not executable"
  fi

  if command -v rsync >/dev/null 2>&1; then
    echo "- rsync: OK"
  else
    echo "- rsync: MISSING"
  fi

  if [[ -f "$SCRIPT_DIR/.syncignore" ]]; then
    echo "- .syncignore: OK"
  else
    echo "- .syncignore: MISSING"
  fi

  if [[ -f "$LAUNCH_AGENT_PATH" ]]; then
    echo "- Auto-sync setup: INSTALLED"
  else
    echo "- Auto-sync setup: NOT INSTALLED"
  fi

  if [[ -n "$configured_source" ]]; then
    echo "- Local workspace: $configured_source"
  else
    echo "- Local workspace: USING DEFAULT"
  fi
}

run_sync_now() {
  if "$RUN_SCRIPT"; then
    notify "Sync completed successfully" "Save To Server"
  else
    notify "Sync failed. Check logs for details" "Save To Server"
    return 1
  fi
}

ensure_local_workspace_configured() {
  if [[ -n "$(get_configured_source)" ]]; then
    return 0
  fi

  echo
  echo "No local workspace is saved yet."
  echo "A desktop folder picker will open now."
  set_local_workspace || true
}

ensure_local_workspace_configured

while true; do
  print_header
  print_menu
  read -r "choice?Pick an option: "

  case "$choice" in
    1)
      run_sync_now
      ;;
    2)
      "$RUN_SCRIPT" status
      ;;
    3)
      "$IGNORE_SCRIPT"
      ;;
    4)
      open "$LOG_DIR"
      ;;
    5)
      install_auto_sync
      ;;
    6)
      remove_auto_sync
      ;;
    7)
      health_check
      ;;
    8)
      set_local_workspace
      ;;
    0)
      echo "Bye."
      exit 0
      ;;
    *)
      echo "Invalid option."
      ;;
  esac

  echo
  read -r "_continue?Press Enter to continue..."
done
