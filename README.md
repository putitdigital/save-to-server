# SMB Auto Sync (macOS)

This project syncs a local working folder to:

smb://odcafs1-nas01.omc.oneds.com/TBWA_JHB_Clients

It uses:

- Finder SMB mount (username/password, optionally saved to Keychain)
- rsync for fast incremental sync
- launchd for automatic scheduling

## Quick Start (No Coding Needed)

1. Double-click `Start Sync.command`.
2. Pick an option from the menu:
	- `Sync now`
	- `Check sync status`
	- `Set local workspace folder` (opens a desktop folder picker)
	- `Install auto-sync`
3. Keep using the same menu whenever needed.

This is the easiest way to use the project.

## Files

- run.sh: Short launcher for sync/status commands
- easy.sh: Guided menu for non-technical users
- Start Sync.command: Double-click launcher to open the guided menu
- .local.env: Auto-created local settings (for selected workspace folder)
- scripts/sync_to_smb.sh: Mounts SMB share and runs rsync
- .syncignore: Ignore patterns for files/folders not to sync
- launchd/com.save-to-server.sync.plist: launchd agent template (every 5 minutes)

## 1) First-time login and Keychain save

Run this once to mount the share using Finder:

open "smb://odcafs1-nas01.omc.oneds.com/TBWA_JHB_Clients/Front-End-Dev/TBWA Work Sithe"

Default destination inside the share is:

Front-End-Dev/TBWA Work Sithe/2026

When prompted:

- Enter username and password
- Enable Remember this password in my keychain

## 2) Run a manual sync

Make the script executable:

chmod +x ./run.sh

Run sync:

./run.sh

Check sync status (one command):

./run.sh status

List paths currently ignored by `.syncignore`:

./ignore

Logs are written to:

- logs/sync.log

## 3) Optional: Sync a different local folder or target subfolder

You can override defaults with environment variables:

LOCAL_SOURCE="/path/to/source" DEST_SUBPATH="some/folder/on/share" ./run.sh

## 3.1) Delete behavior

By default, the sync only adds and updates files on the server. It does not delete remote files.

If you ever want mirrored delete behavior, run with:

DELETE_REMOTE="true" ./run.sh

## 4) Enable automatic background sync (launchd)

Copy plist into your LaunchAgents folder:

mkdir -p "$HOME/Library/LaunchAgents"
cp launchd/com.save-to-server.sync.plist "$HOME/Library/LaunchAgents/com.save-to-server.sync.plist"

Load and start it:

launchctl unload "$HOME/Library/LaunchAgents/com.save-to-server.sync.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/com.save-to-server.sync.plist"

Check status:

launchctl list | grep com.save-to-server.sync

## 5) Change frequency

Edit StartInterval in:

launchd/com.save-to-server.sync.plist

Example values:

- 60 = every minute
- 300 = every 5 minutes
- 900 = every 15 minutes

After editing, reload:

launchctl unload "$HOME/Library/LaunchAgents/com.save-to-server.sync.plist"
launchctl load "$HOME/Library/LaunchAgents/com.save-to-server.sync.plist"

## Notes

- Keep .syncignore updated to avoid uploading private or heavy folders.
- If the share is not mounted, the script attempts to mount it first.