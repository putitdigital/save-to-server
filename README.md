# Save To Server / Flowit

This repository is now a full sync + telemetry platform with four parts:

1. macOS SMB sync automation scripts (`run.sh`, `easy.sh`, `scripts/sync_to_smb.sh`)
2. Flowit desktop app built with Tauri (`desktop/`)
3. PHP telemetry ingestion API + MySQL schema (`backend/`)
4. Password-protected analytics dashboard (`flowit/`)

## What This Project Does

- Syncs a local folder to an SMB server using `rsync`.
- Supports manual sync, status checks, health check, and launchd auto-sync.
- Ships a desktop app UI that wraps sync operations and app settings.
- Collects telemetry events (`register`, `track`) from app installations.
- Shows usage analytics, installation health, notifications, and charts in a web dashboard.

## Repository Structure

- `run.sh`: CLI entrypoint for sync commands.
- `easy.sh`: Guided macOS menu for non-technical users.
- `scripts/sync_to_smb.sh`: Core sync logic (mount, rsync, logging, status, lockfile).
- `launchd/com.save-to-server.sync.plist`: launchd job template.
- `desktop/`: Tauri desktop app (Vite frontend + Rust backend).
- `backend/`: Telemetry API endpoints and SQL migrations.
- `flowit/`: Analytics dashboard (PHP + MySQL).

## Quick Start (End Users)

1. Double-click `Start Sync.command`.
2. Use menu options in `easy.sh`:
   - Sync now
   - Check status
   - Install auto-sync (launchd)
   - Set local workspace folder
3. View logs in `logs/`.

## Sync Commands (CLI)

```bash
chmod +x ./run.sh
./run.sh
./run.sh status
./ignore
```

Optional overrides:

```bash
LOCAL_SOURCE="/path/to/source" DEST_SUBPATH="server/folder" ./run.sh
DELETE_REMOTE="true" ./run.sh
```

Notes:

- Script reads optional overrides from `.local.env`.
- It can also read defaults from the Flowit SQLite app DB (`FLOWIT_DB_PATH`) when available.
- Sync logs are written to `logs/sync.log`.

## Auto-Sync (launchd)

Install and load the LaunchAgent:

```bash
mkdir -p "$HOME/Library/LaunchAgents"
cp launchd/com.save-to-server.sync.plist "$HOME/Library/LaunchAgents/com.save-to-server.sync.plist"
launchctl unload "$HOME/Library/LaunchAgents/com.save-to-server.sync.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/com.save-to-server.sync.plist"
launchctl list | grep com.save-to-server.sync
```

Frequency is controlled by `StartInterval` in `launchd/com.save-to-server.sync.plist`.

## Desktop App (Tauri)

Run in dev mode:

```bash
cd desktop
npm install
npm run tauri dev
```

Build desktop bundles:

```bash
cd desktop
npm install
npm run tauri build
```

Maintainer packaging helper:

```bash
./package-desktop.sh
```

Updater support is configured in `desktop/src-tauri/tauri.conf.json`.

## Telemetry API (backend)

Main endpoints:

- `backend/api/ping.php` (health)
- `backend/api/telemetry_token.php` (short-lived token)
- `backend/api/register.php` (installation registration)
- `backend/api/track.php` (event ingestion)

Auth:

- API key via `X-Api-Key`
- Telemetry token via `X-Telemetry-Token` (or API key fallback)

### Backend Setup

1. Copy config:

```bash
cp backend/config/config.php.example backend/config/config.php
```

2. Fill database and secrets in `backend/config/config.php`.

3. Run migrations in order:

- `backend/migrations/001_create_tables.sql`
- `backend/migrations/002_add_user_identity_links.sql`
- `backend/migrations/003_add_sync_control_to_app_instances.sql`

## Flowit Dashboard (`flowit/`)

Features currently included:

- Login-protected dashboard
- KPI cards (users, installs, DAU/MAU-style metrics)
- Installations view with per-device Start/Stop sync action
- Right-side notification panel with severity grouping
- Installation vulnerability/health detection
- Graphs with 7/14/30-day range controls:
  - Activity trend
  - Event mix
  - Installation health distribution

### Dashboard Setup

1. Copy config:

```bash
cp flowit/config/config.php.example flowit/config/config.php
```

2. Set DB credentials and dashboard password hash in `flowit/config/config.php`.

Generate password hash:

```bash
php -r "echo password_hash('your-strong-password', PASSWORD_DEFAULT), PHP_EOL;"
```

3. Serve from repo root using PHP built-in server:

```bash
php -S 127.0.0.1:8080
```

Open:

- `http://127.0.0.1:8080/flowit/login.php`

## Logs

- `logs/sync.log`: sync history
- `logs/launchd.out.log`: launchd stdout
- `logs/launchd.err.log`: launchd stderr

## Prerequisites

- macOS (for launchd scripts and desktop workflow)
- `zsh`, `rsync`
- Node.js + npm (desktop app)
- Rust + Cargo + Tauri CLI (desktop app build)
- PHP + MySQL/MariaDB (backend API and dashboard)
- Optional: `sqlite3` (to read desktop app settings into sync script)

## Troubleshooting

- If `php` is missing, install it before running dashboard/API locally.
- If launchd job appears loaded but no sync happens, check `logs/launchd.err.log` first.
- If sync prompts for SMB credentials repeatedly, verify Keychain saved credentials and share access.
- If dashboard install controls do not affect clients, ensure desktop/agent side consumes `desired_sync_enabled` state.