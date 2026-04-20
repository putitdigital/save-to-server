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

## Desktop App (Flowit, Tauri)

A Tauri desktop shell is available in `desktop/`.
It reuses the existing scripts (`run.sh`, `scripts/sync_to_smb.sh`) without changing their logic.

### What the desktop app can do

- Run `Sync now`
- Check `status`
- Show the latest lines from `logs/sync.log`
- Save and reload `LOCAL_SOURCE` and `DEST_SUBPATH` in `.local.env`
- Protect Sync Log behind an admin code in the app

### Admin code for Sync Log

- Default admin code is `1234`.
- You can override it with environment variable `FLOWIT_ADMIN_CODE`.
- Or set `ADMIN_CODE="your-code"` inside `.local.env`.

### Start in development mode

From the project root:

```bash
cd desktop
npm install
npm run tauri dev
```

### Build a desktop app bundle

```bash
cd desktop
npm install
npm run tauri build
```

### In-app updates (users download updates inside the app)

Flowit now includes a **Check for Update** button in the desktop UI.

To enable real updates in production, set these values in `desktop/src-tauri/tauri.conf.json`:

- `plugins.updater.endpoints`: URL that serves updater metadata (`latest.json`)
- `plugins.updater.pubkey`: public key for verifying signed updates

Current config uses placeholders and must be replaced before release.

Typical maintainer flow:

1. Generate signing keys once (`npm run tauri signer generate`).
2. Put the public key in `tauri.conf.json` under `plugins.updater.pubkey`.
3. Keep the private key secure and use it when building release artifacts.
4. Publish the app bundle artifacts and updater metadata (`latest.json`) to your release host (for example GitHub Releases).
5. Users click **Check for Update** in the app to download/install updates directly.

### GitHub setup for updater (this repository)

Updater endpoint in `desktop/src-tauri/tauri.conf.json` is set to:

- `https://github.com/putitdigital/save-to-server/releases/latest/download/latest.json`

Complete these one-time steps:

1. Generate keys locally from `desktop/`:

	```bash
	npm run tauri signer generate -w ~/.tauri/flowit.key
	```

	Copy the printed public key and set it in `desktop/src-tauri/tauri.conf.json` as `plugins.updater.pubkey`.

2. Add GitHub repository secrets:

	- `TAURI_SIGNING_PRIVATE_KEY`: full contents of `~/.tauri/flowit.key`
	- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password you used

3. Push this workflow file:

	- `.github/workflows/release-tauri.yml`

4. Create a version tag and push it:

	```bash
	git tag v0.1.1
	git push origin v0.1.1
	```

GitHub Actions will build and publish release artifacts. Once release assets include `latest.json`, users can click **Check for Update** and install updates directly.

Build outputs (macOS) are created under:

- `desktop/src-tauri/target/release/bundle/dmg/`
- `desktop/src-tauri/target/release/bundle/macos/`

### Distribute to non-technical users

1. Build the app (`npm run tauri build`).
2. Share the generated `.dmg` from `desktop/src-tauri/target/release/bundle/dmg/`.
3. User opens the `.dmg`, drags **Flowit** to **Applications**, and launches it.
4. On first launch, the app creates a writable local workspace automatically for logs/settings/scripts.
5. User only needs to use the app UI (no terminal required).

### Optional: one-command packaging for maintainers

From repo root:

```bash
./package-desktop.sh
```

This script installs dependencies (if needed), builds the Tauri app, and prints the package output folder.

### Important notes

- The app expects `run.sh`, `scripts/`, and `logs/` to exist in this repository.
- On first sync, macOS may still prompt for SMB authentication if Keychain is not already configured.
- If Gatekeeper shows an "unidentified developer" warning for unsigned builds, right-click the app and choose **Open** the first time.