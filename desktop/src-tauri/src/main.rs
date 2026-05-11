#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::menu::{AboutMetadataBuilder, MenuBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use rusqlite::{params, Connection, OptionalExtension};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const HELP_HOW_TO_USE_ID: &str = "help_how_to_use";
const HELP_START_TOUR_ID: &str = "help_start_tour";
const HELP_OPEN_README_ID: &str = "help_open_readme";
const HELP_OPEN_LOGS_ID: &str = "help_open_logs";
const HELP_ADMIN_HELP_ID: &str = "help_admin_help";
const FLOWIT_CHECK_UPDATE_ID: &str = "flowit_check_update";
const LOGS_OPEN_ADMIN_ID: &str = "logs_open_admin_dashboard";
const REQUEST_ADMIN_UNLOCK_EVENT: &str = "flowit://request-admin-unlock";
const REQUEST_UPDATE_CHECK_EVENT: &str = "flowit://request-update-check";
const SYNC_PROGRESS_EVENT: &str = "flowit://sync-progress";
const SYNC_COMPLETE_EVENT: &str = "flowit://sync-complete";
const GETTING_STARTED_WINDOW_LABEL: &str = "getting-started";
const RUNTIME_WORKSPACE_DIR: &str = "runtime-workspace";

#[derive(Serialize, Clone)]
struct AdminUnlockRequest {
    action: String,
}

#[derive(Serialize)]
struct CommandResult {
    ok: bool,
    code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Serialize, Deserialize, Default)]
struct AppSettings {
    local_source: String,
    dest_subpath: String,
    smb_url: String,
    mount_name: String,
    auto_sync: bool,
}

#[derive(Serialize)]
struct SyncSourceItem {
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
struct ServerConnectionStatus {
    connected: bool,
    mount_point: String,
    message: String,
}

#[derive(Serialize)]
struct PendingSyncInfo {
    pending_count: usize,
}

#[derive(Default)]
struct SyncRuntime {
    is_running: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartSyncResponse {
    started: bool,
    total_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncProgressPayload {
    line: String,
    path: Option<String>,
    processed_count: usize,
    total_count: usize,
    percentage: u8,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncCompletePayload {
    ok: bool,
    code: i32,
    stdout: String,
    stderr: String,
    processed_count: usize,
    total_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserRecord {
    id: i64,
    username: String,
    name: String,
    surname: String,
    created_at: String,
    last_edited_by_id: Option<i64>,
    deleted_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadedItemRecord {
    id: i64,
    name: String,
    file_type: String,
    created_at: String,
    last_edited_by_id: Option<i64>,
    deleted_at: Option<String>,
}

fn candidate_roots(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(repo_root) = manifest_dir.ancestors().nth(2) {
        roots.push(repo_root.to_path_buf());
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Failed to locate resource dir: {error}"))?;

    roots.push(resource_dir.clone());
    roots.push(resource_dir.join("resources"));

    Ok(roots)
}

fn find_repo_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    for root in candidate_roots(app)? {
        if root.join("run.sh").exists() {
            return Ok(root);
        }
    }

    Err("Could not find run.sh in known app paths".to_string())
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Failed to create {}: {error}", destination.display()))?;

    let entries = fs::read_dir(source)
        .map_err(|error| format!("Failed to read {}: {error}", source.display()))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to read file type for {}: {error}", source_path.display()))?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }

    Ok(())
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Failed to read metadata for {}: {error}", path.display()))?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .map_err(|error| format!("Failed to set permissions for {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn ensure_runtime_workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data dir: {error}"))?;

    let runtime_root = app_data_dir.join(RUNTIME_WORKSPACE_DIR);
    let runtime_run_sh = runtime_root.join("run.sh");

    let refresh_runtime_assets = |runtime_root: &Path| {
        let Ok(bundled_root) = find_repo_root(app) else {
            return;
        };

        let file_entries = ["run.sh", "easy.sh", "ignore", "README.md"];
        for file_name in file_entries {
            let source_path = bundled_root.join(file_name);
            if !source_path.exists() {
                continue;
            }

            let destination_path = runtime_root.join(file_name);
            let _ = fs::copy(&source_path, &destination_path);
        }

        let source_scripts = bundled_root.join("scripts");
        if source_scripts.exists() {
            let _ = copy_dir_recursive(&source_scripts, &runtime_root.join("scripts"));
        }

        let source_launchd = bundled_root.join("launchd");
        if source_launchd.exists() {
            let _ = copy_dir_recursive(&source_launchd, &runtime_root.join("launchd"));
        }
    };

    if runtime_run_sh.exists() {
        refresh_runtime_assets(&runtime_root);
        fs::create_dir_all(runtime_root.join("logs"))
            .map_err(|error| format!("Failed to create logs dir: {error}"))?;
        ensure_executable(&runtime_root.join("run.sh"))?;
        ensure_executable(&runtime_root.join("easy.sh"))?;
        ensure_executable(&runtime_root.join("ignore"))?;
        ensure_executable(&runtime_root.join("scripts/sync_to_smb.sh"))?;
        return Ok(runtime_root);
    }

    let bundled_root = find_repo_root(app)?;
    fs::create_dir_all(&runtime_root)
        .map_err(|error| format!("Failed to create runtime workspace: {error}"))?;

    let file_entries = ["run.sh", "easy.sh", "ignore", ".syncignore", "README.md"];
    for file_name in file_entries {
        let source_path = bundled_root.join(file_name);
        if !source_path.exists() {
            continue;
        }

        let destination_path = runtime_root.join(file_name);
        fs::copy(&source_path, &destination_path).map_err(|error| {
            format!(
                "Failed to copy {} to {}: {error}",
                source_path.display(),
                destination_path.display()
            )
        })?;
    }

    let dir_entries = ["scripts", "launchd", "logs"];
    for dir_name in dir_entries {
        let source_path = bundled_root.join(dir_name);
        if !source_path.exists() {
            continue;
        }

        let destination_path = runtime_root.join(dir_name);
        copy_dir_recursive(&source_path, &destination_path)?;
    }

    fs::create_dir_all(runtime_root.join("logs"))
        .map_err(|error| format!("Failed to create logs dir: {error}"))?;

    ensure_executable(&runtime_root.join("run.sh"))?;
    ensure_executable(&runtime_root.join("easy.sh"))?;
    ensure_executable(&runtime_root.join("ignore"))?;
    ensure_executable(&runtime_root.join("scripts/sync_to_smb.sh"))?;

    Ok(runtime_root)
}

fn workspace_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return find_repo_root(app);
    }

    ensure_runtime_workspace(app)
}

fn run_sync_script(app: &tauri::AppHandle, args: &[&str], user_name: Option<&str>) -> Result<CommandResult, String> {
    let repo_root = workspace_root(app)?;
    let script_path = repo_root.join("run.sh");

    let mut cmd = Command::new("/bin/zsh");
    cmd.arg(script_path).args(args).current_dir(&repo_root);
    if let Some(name) = user_name {
        cmd.env("FLOWIT_USER", name);
    }

    let output = cmd
        .output()
        .map_err(|error| format!("Failed to execute sync script: {error}"))?;

    Ok(CommandResult {
        ok: output.status.success(),
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

fn parse_pending_count(stdout: &str) -> usize {
    for line in stdout.lines().rev() {
        if let Some(value) = line.trim().strip_prefix("PENDING_COUNT=") {
            return value.trim().parse::<usize>().unwrap_or(0);
        }
    }

    0
}

fn parse_sync_output_path(line: &str) -> Option<String> {
    let trimmed = line.trim();

    if trimmed.is_empty()
        || trimmed == "./"
        || trimmed.starts_with("sending incremental file list")
        || trimmed.starts_with("created directory")
        || trimmed.starts_with("sent ")
        || trimmed.starts_with("total size is ")
        || trimmed.starts_with("Number of files:")
        || trimmed.starts_with("Number of created files:")
        || trimmed.starts_with("Number of deleted files:")
        || trimmed.starts_with("Number of regular files transferred:")
        || trimmed.starts_with("Total file size:")
        || trimmed.starts_with("Total transferred file size:")
        || trimmed.starts_with("Literal data:")
        || trimmed.starts_with("Matched data:")
        || trimmed.starts_with("File list size:")
        || trimmed.starts_with("File list generation time:")
        || trimmed.starts_with("File list transfer time:")
        || trimmed.starts_with("Total bytes sent:")
        || trimmed.starts_with("Total bytes received:")
        || trimmed.starts_with("speedup is ")
        || trimmed.starts_with("[")
    {
        return None;
    }

    Some(trimmed.replace('\\', "/"))
}

fn run_sync_script_with_progress(
    app: &tauri::AppHandle,
    total_count: usize,
    user_name: Option<&str>,
) -> Result<(CommandResult, usize), String> {
    let repo_root = workspace_root(app)?;
    let script_path = repo_root.join("run.sh");

    let mut cmd = Command::new("/bin/zsh");
    cmd.arg(script_path)
        .current_dir(&repo_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(name) = user_name {
        cmd.env("FLOWIT_USER", name);
    }

    let mut child = cmd
        .spawn()
        .map_err(|error| format!("Failed to execute sync script: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture sync stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture sync stderr".to_string())?;

    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        let mut lines = Vec::new();
        for line in reader.lines() {
            if let Ok(line) = line {
                lines.push(line);
            }
        }
        lines.join("\n")
    });

    let reader = BufReader::new(stdout);
    let mut stdout_lines = Vec::new();
    let mut processed_count = 0usize;

    for line in reader.lines() {
        let line = line.map_err(|error| format!("Failed to read sync output: {error}"))?;
        let maybe_path = parse_sync_output_path(&line);

        if maybe_path.is_some() {
            processed_count += 1;
            let denominator = total_count.max(processed_count).max(1);
            let percentage = ((processed_count * 100) / denominator).min(100) as u8;

            let payload = SyncProgressPayload {
                line: line.clone(),
                path: maybe_path,
                processed_count,
                total_count,
                percentage,
            };

            let _ = app.emit(SYNC_PROGRESS_EVENT, payload);
        }

        stdout_lines.push(line);
    }

    let status = child
        .wait()
        .map_err(|error| format!("Failed waiting for sync script: {error}"))?;
    let stderr_output = stderr_handle
        .join()
        .map_err(|_| "Failed to join stderr reader thread".to_string())?;

    Ok((
        CommandResult {
            ok: status.success(),
            code: status.code().unwrap_or(-1),
            stdout: stdout_lines.join("\n"),
            stderr: stderr_output,
        },
        processed_count,
    ))
}

fn tail_lines(text: &str, max_lines: usize) -> String {
    if max_lines == 0 {
        return String::new();
    }

    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

fn local_env_path(repo_root: &Path) -> PathBuf {
    repo_root.join(".local.env")
}

fn sqlite_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data dir: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Failed to create app data dir: {error}"))?;

    Ok(app_data_dir.join("flowit.db"))
}

fn ensure_sqlite_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                surname TEXT NOT NULL,
                "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
                "lastEditedById" INTEGER,
                "deletedAt" TEXT,
                FOREIGN KEY("lastEditedById") REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS uploaded_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                "fileType" TEXT NOT NULL CHECK ("fileType" IN ('file', 'folder')),
                "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
                "lastEditedById" INTEGER,
                "deletedAt" TEXT,
                FOREIGN KEY("lastEditedById") REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
            CREATE INDEX IF NOT EXISTS idx_uploaded_items_file_type ON uploaded_items("fileType");
            CREATE INDEX IF NOT EXISTS idx_uploaded_items_deleted_at ON uploaded_items("deletedAt");

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
            );
            "#,
        )
        .map_err(|error| format!("Failed to initialize SQLite schema: {error}"))?;

    Ok(())
}

fn open_sqlite_connection(app: &tauri::AppHandle) -> Result<Connection, String> {
    let database_path = sqlite_db_path(app)?;
    let connection = Connection::open(&database_path)
        .map_err(|error| format!("Failed to open SQLite database {}: {error}", database_path.display()))?;

    ensure_sqlite_schema(&connection)?;
    Ok(connection)
}

fn read_app_setting_value(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read app setting '{key}': {error}"))
}

fn should_show_start_tour_menu_item(app: &tauri::AppHandle) -> bool {
    let Ok(connection) = open_sqlite_connection(app) else {
        return false;
    };

    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params!["tour_completed"],
            |row| row.get::<_, String>(0),
        )
        .optional();

    matches!(value.ok().flatten().as_deref(), Some("true"))
}

fn parse_user_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UserRecord> {
    Ok(UserRecord {
        id: row.get("id")?,
        username: row.get("username")?,
        name: row.get("name")?,
        surname: row.get("surname")?,
        created_at: row.get("created_at")?,
        last_edited_by_id: row.get("last_edited_by_id")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn parse_uploaded_item_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UploadedItemRecord> {
    Ok(UploadedItemRecord {
        id: row.get("id")?,
        name: row.get("name")?,
        file_type: row.get("file_type")?,
        created_at: row.get("created_at")?,
        last_edited_by_id: row.get("last_edited_by_id")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn sync_ignore_path(repo_root: &Path) -> PathBuf {
    repo_root.join(".syncignore")
}

fn parse_sync_ignore_entries(content: &str) -> Vec<String> {
    let mut entries = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        entries.push(line.to_string());
    }

    entries
}

fn read_sync_ignore_entries(ignore_path: &Path) -> Result<Vec<String>, String> {
    if !ignore_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(ignore_path)
        .map_err(|error| format!("Failed to read {}: {error}", ignore_path.display()))?;

    Ok(parse_sync_ignore_entries(&content))
}

fn build_sync_ignore(repo_root: &Path, source_path: &Path) -> Result<Gitignore, String> {
    let ignore_path = sync_ignore_path(repo_root);
    let mut builder = GitignoreBuilder::new(source_path);

    if ignore_path.exists() {
        let content = fs::read_to_string(&ignore_path)
            .map_err(|error| format!("Failed to read {}: {error}", ignore_path.display()))?;

        for (line_number, raw_line) in content.lines().enumerate() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            builder
                .add_line(Some(ignore_path.clone()), line)
                .map_err(|error| {
                    format!(
                        "Invalid .syncignore pattern on line {}: {}",
                        line_number + 1,
                        error
                    )
                })?;
        }
    }

    builder
        .build()
        .map_err(|error| format!("Failed to build .syncignore matcher: {error}"))
}

fn default_local_source() -> String {
    String::new()
}

fn parse_local_env(content: &str) -> AppSettings {
    let mut settings = AppSettings::default();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((key, value_part)) = line.split_once('=') else {
            continue;
        };

        let key = key.trim();
        let mut value = value_part.trim().to_string();
        if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            value = value[1..value.len() - 1].to_string();
        }

        match key {
            "LOCAL_SOURCE" => settings.local_source = value,
            "DEST_SUBPATH" => settings.dest_subpath = value,
            "SMB_URL" => settings.smb_url = value,
            "MOUNT_NAME" => settings.mount_name = value,
            "AUTO_SYNC" => {
                settings.auto_sync = matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "true" | "1" | "yes" | "on"
                )
            }
            _ => {}
        }
    }

    settings
}

fn resolved_local_source(repo_root: &Path) -> String {
    let env_path = local_env_path(repo_root);
    if let Ok(content) = fs::read_to_string(env_path) {
        let settings = parse_local_env(&content);
        let trimmed = settings.local_source.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    default_local_source()
}

fn collect_sync_items(
    base: &Path,
    current: &Path,
    depth: usize,
    max_depth: usize,
    max_items: usize,
    ignore_matcher: &Gitignore,
    out: &mut Vec<SyncSourceItem>,
) -> Result<(), String> {
    if out.len() >= max_items || depth > max_depth {
        return Ok(());
    }

    let entries = fs::read_dir(current)
        .map_err(|error| format!("Failed to read {}: {error}", current.display()))?;

    let mut ordered_entries: Vec<_> = entries.filter_map(Result::ok).collect();
    ordered_entries.sort_by_key(|entry| entry.path());

    for entry in ordered_entries {
        if out.len() >= max_items {
            break;
        }

        let entry_path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Failed to read metadata for {}: {error}", entry_path.display()))?;

        let relative = entry_path
            .strip_prefix(base)
            .unwrap_or(&entry_path)
            .to_string_lossy()
            .replace('\\', "/");

        let is_dir = metadata.is_dir();

        if ignore_matcher
            .matched_path_or_any_parents(&entry_path, is_dir)
            .is_ignore()
        {
            continue;
        }

        out.push(SyncSourceItem {
            path: relative,
            is_dir,
        });

        if is_dir {
            collect_sync_items(
                base,
                &entry_path,
                depth + 1,
                max_depth,
                max_items,
                ignore_matcher,
                out,
            )?;
        }
    }

    Ok(())
}

fn read_env_value(content: &str, target_key: &str) -> Option<String> {
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((key, value_part)) = line.split_once('=') else {
            continue;
        };

        if key.trim() != target_key {
            continue;
        }

        let mut value = value_part.trim().to_string();
        if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            value = value[1..value.len() - 1].to_string();
        }

        return Some(value);
    }

    None
}

fn configured_admin_code(repo_root: &Path) -> String {
    if let Ok(from_env) = std::env::var("FLOWIT_ADMIN_CODE") {
        let trimmed = from_env.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let env_path = local_env_path(repo_root);
    if let Ok(content) = fs::read_to_string(env_path) {
        if let Some(from_file) = read_env_value(&content, "ADMIN_CODE") {
            let trimmed = from_file.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    "1234".to_string()
}

fn configured_mount_name(app: &tauri::AppHandle, repo_root: &Path) -> String {
    if let Ok(connection) = open_sqlite_connection(app) {
        if let Ok(Some(from_db)) = read_app_setting_value(&connection, "mount_name") {
            let trimmed = from_db.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    let env_path = local_env_path(repo_root);
    if let Ok(content) = fs::read_to_string(env_path) {
        if let Some(from_file) = read_env_value(&content, "MOUNT_NAME") {
            let trimmed = from_file.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    String::new()
}

fn escape_env_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn open_path_with_default_app(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg(path)
        .status()
        .map_err(|error| format!("Failed to run 'open': {error}"))?;

    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open")
        .arg(path)
        .status()
        .map_err(|error| format!("Failed to run 'xdg-open': {error}"))?;

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd")
        .arg("/C")
        .arg("start")
        .arg("")
        .arg(path)
        .status()
        .map_err(|error| format!("Failed to run 'start': {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to open path with default app: {}",
            path.display()
        ))
    }
}

fn show_admin_help() {
    let _ = rfd::MessageDialog::new()
        .set_title("Admin Dashboard Access")
        .set_description(
            "The Sync Log dashboard is protected.\n\
Set ADMIN_CODE in .local.env (or FLOWIT_ADMIN_CODE env var) and share it only with trusted admins.",
        )
        .set_level(rfd::MessageLevel::Info)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

fn open_getting_started_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(GETTING_STARTED_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        GETTING_STARTED_WINDOW_LABEL,
        WebviewUrl::App("index.html?view=getting-started".into()),
    )
    .title("Flowit - Getting Started")
    .inner_size(860.0, 620.0)
    .min_inner_size(680.0, 480.0)
    .resizable(true)
    .build()
    .map_err(|error| format!("Failed to open Getting Started window: {error}"))?;

    Ok(())
}

#[tauri::command]
fn sync_now(app: tauri::AppHandle) -> Result<CommandResult, String> {
    run_sync_script(&app, &[], None)
}

#[tauri::command]
fn start_sync(
    app: tauri::AppHandle,
    sync_runtime: tauri::State<'_, SyncRuntime>,
    user_name: Option<String>,
) -> Result<StartSyncResponse, String> {
    {
        let mut is_running = sync_runtime
            .is_running
            .lock()
            .map_err(|_| "Failed to lock sync state".to_string())?;

        if *is_running {
            return Err("Sync is already running".to_string());
        }

        *is_running = true;
    }

    let total_count = run_sync_script(&app, &["changes-count"], user_name.as_deref())
        .map(|result| parse_pending_count(&result.stdout))
        .unwrap_or(0);

    let app_handle = app.clone();
    thread::spawn(move || {
        let completion = match run_sync_script_with_progress(&app_handle, total_count, user_name.as_deref()) {
            Ok((result, processed_count)) => SyncCompletePayload {
                ok: result.ok,
                code: result.code,
                stdout: result.stdout,
                stderr: result.stderr,
                processed_count,
                total_count,
            },
            Err(error) => SyncCompletePayload {
                ok: false,
                code: -1,
                stdout: String::new(),
                stderr: error,
                processed_count: 0,
                total_count,
            },
        };

        let _ = app_handle.emit(SYNC_COMPLETE_EVENT, completion);

        if let Ok(mut is_running) = app_handle.state::<SyncRuntime>().is_running.lock() {
            *is_running = false;
        }
    });

    Ok(StartSyncResponse {
        started: true,
        total_count,
    })
}

#[tauri::command]
fn sync_status(app: tauri::AppHandle) -> Result<CommandResult, String> {
    run_sync_script(&app, &["status"], None)
}

#[tauri::command]
fn read_sync_log(
    app: tauri::AppHandle,
    max_lines: Option<usize>,
    admin_code: String,
) -> Result<String, String> {
    let repo_root = workspace_root(&app)?;
    let expected_code = configured_admin_code(&repo_root);
    if admin_code.trim() != expected_code {
        return Err("Unauthorized: invalid admin code".to_string());
    }

    let log_path = repo_root.join(Path::new("logs").join("sync.log"));

    if !log_path.exists() {
        return Ok("No sync log yet. Run a sync first.".to_string());
    }

    let content = fs::read_to_string(&log_path)
        .map_err(|error| format!("Failed to read {}: {error}", log_path.display()))?;

    Ok(tail_lines(&content, max_lines.unwrap_or(150)))
}

#[tauri::command]
fn read_all_users_sync_log(
    app: tauri::AppHandle,
    max_lines: Option<usize>,
    admin_code: String,
) -> Result<String, String> {
    let repo_root = workspace_root(&app)?;
    let expected_code = configured_admin_code(&repo_root);
    if admin_code.trim() != expected_code {
        return Err("Unauthorized: invalid admin code".to_string());
    }

    let mount_name = configured_mount_name(&app, &repo_root).trim().to_string();
    if mount_name.is_empty() {
        return Ok("MOUNT_NAME is not configured yet. Save Settings first.".to_string());
    }
    let dest_subpath = {
        let env_path = local_env_path(&repo_root);
        let from_db = open_sqlite_connection(&app)
            .ok()
            .and_then(|connection| read_app_setting_value(&connection, "server_folder").ok().flatten());
        from_db
            .or_else(|| {
                fs::read_to_string(&env_path)
                    .ok()
                    .and_then(|c| read_env_value(&c, "DEST_SUBPATH"))
            })
            .unwrap_or_default()
            .trim()
            .to_string()
    };

    let log_path = if dest_subpath.is_empty() {
        PathBuf::from(format!("/Volumes/{}/syncAll.log", mount_name))
    } else {
        PathBuf::from(format!("/Volumes/{}/{}/syncAll.log", mount_name, dest_subpath))
    };

    if !log_path.exists() {
        return Ok("No shared log yet. Run a sync while connected to the server.".to_string());
    }

    let content = fs::read_to_string(&log_path)
        .map_err(|error| format!("Failed to read {}: {error}", log_path.display()))?;

    Ok(tail_lines(&content, max_lines.unwrap_or(300)))
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let repo_root = workspace_root(&app)?;
    let env_path = local_env_path(&repo_root);

    if !env_path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(&env_path)
        .map_err(|error| format!("Failed to read {}: {error}", env_path.display()))?;

    Ok(parse_local_env(&content))
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    local_source: String,
    dest_subpath: String,
    smb_url: String,
    mount_name: String,
    auto_sync: bool,
) -> Result<String, String> {
    let repo_root = workspace_root(&app)?;
    let env_path = local_env_path(&repo_root);
    let local_source_trimmed = local_source.trim().to_string();
    let dest_subpath_trimmed = dest_subpath.trim().to_string();
    let smb_url_trimmed = smb_url.trim().to_string();
    let mount_name_trimmed = mount_name.trim().to_string();
    let existing_admin_code = fs::read_to_string(&env_path)
        .ok()
        .and_then(|content| read_env_value(&content, "ADMIN_CODE"));

    let mut content = format!(
        "LOCAL_SOURCE=\"{}\"\nDEST_SUBPATH=\"{}\"\nSMB_URL=\"{}\"\nMOUNT_NAME=\"{}\"\nAUTO_SYNC=\"{}\"\n",
        escape_env_value(&local_source_trimmed),
        escape_env_value(&dest_subpath_trimmed),
        escape_env_value(&smb_url_trimmed),
        escape_env_value(&mount_name_trimmed),
        if auto_sync { "true" } else { "false" }
    );

    if let Some(code) = existing_admin_code {
        content.push_str(&format!("ADMIN_CODE=\"{}\"\n", escape_env_value(code.trim())));
    }

    fs::write(&env_path, content)
        .map_err(|error| format!("Failed to write {}: {error}", env_path.display()))?;

    let connection = open_sqlite_connection(&app)?;
    upsert_app_setting(&connection, "local_folder", &local_source_trimmed)?;
    upsert_app_setting(&connection, "server_folder", &dest_subpath_trimmed)?;
    upsert_app_setting(&connection, "smb_url", &smb_url_trimmed)?;
    upsert_app_setting(&connection, "mount_name", &mount_name_trimmed)?;

    Ok("Settings saved to .local.env".to_string())
}

#[tauri::command]
fn get_sync_ignore_entries(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let repo_root = workspace_root(&app)?;
    let ignore_path = sync_ignore_path(&repo_root);
    read_sync_ignore_entries(&ignore_path)
}

#[tauri::command]
fn add_sync_ignore_entry(app: tauri::AppHandle, pattern: String) -> Result<Vec<String>, String> {
    let repo_root = workspace_root(&app)?;
    let ignore_path = sync_ignore_path(&repo_root);
    let next_pattern = pattern.trim();

    if next_pattern.is_empty() {
        return Err("Ignore pattern cannot be empty".to_string());
    }

    if next_pattern.starts_with('#') {
        return Err("Ignore pattern cannot start with #".to_string());
    }

    let mut entries = read_sync_ignore_entries(&ignore_path)?;
    if entries.iter().any(|entry| entry == next_pattern) {
        return Ok(entries);
    }

    entries.push(next_pattern.to_string());
    let content = format!("{}\n", entries.join("\n"));
    fs::write(&ignore_path, content)
        .map_err(|error| format!("Failed to write {}: {error}", ignore_path.display()))?;

    Ok(entries)
}

#[tauri::command]
fn remove_sync_ignore_entry(app: tauri::AppHandle, pattern: String) -> Result<Vec<String>, String> {
    let repo_root = workspace_root(&app)?;
    let ignore_path = sync_ignore_path(&repo_root);
    let target = pattern.trim();

    if target.is_empty() {
        return Err("Ignore pattern cannot be empty".to_string());
    }

    if !ignore_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&ignore_path)
        .map_err(|error| format!("Failed to read {}: {error}", ignore_path.display()))?;

    let mut kept_lines = Vec::new();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if !line.is_empty() && !line.starts_with('#') && line == target {
            continue;
        }

        kept_lines.push(raw_line.to_string());
    }

    let next_content = if kept_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", kept_lines.join("\n"))
    };

    fs::write(&ignore_path, next_content)
        .map_err(|error| format!("Failed to write {}: {error}", ignore_path.display()))?;

    read_sync_ignore_entries(&ignore_path)
}

#[tauri::command]
fn pick_local_source() -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new().pick_folder();
    Ok(picked.map(|path| path.display().to_string()))
}

#[tauri::command]
fn verify_admin_code(app: tauri::AppHandle, code: String) -> Result<bool, String> {
    let repo_root = workspace_root(&app)?;
    let expected_code = configured_admin_code(&repo_root);
    Ok(code.trim() == expected_code)
}

#[tauri::command]
fn get_sync_source_items(
    app: tauri::AppHandle,
    max_items: Option<usize>,
    max_depth: Option<usize>,
) -> Result<Vec<SyncSourceItem>, String> {
    let repo_root = workspace_root(&app)?;
    let source = resolved_local_source(&repo_root);
    let source_path = PathBuf::from(source);

    if !source_path.exists() {
        return Ok(Vec::new());
    }

    if !source_path.is_dir() {
        return Err("LOCAL_SOURCE is not a folder".to_string());
    }

    let mut items = Vec::new();
    let item_limit = max_items.unwrap_or(180).min(400);
    let depth_limit = max_depth.unwrap_or(3).min(6);
    let ignore_matcher = build_sync_ignore(&repo_root, &source_path)?;

    collect_sync_items(
        &source_path,
        &source_path,
        1,
        depth_limit,
        item_limit,
        &ignore_matcher,
        &mut items,
    )?;

    Ok(items)
}

#[tauri::command]
fn mount_smb_share(app: tauri::AppHandle) -> Result<(), String> {
    let repo_root = workspace_root(&app)?;
    let env_path = local_env_path(&repo_root);
    let connection = open_sqlite_connection(&app)?;
    let smb_url_from_db = read_app_setting_value(&connection, "smb_url")?;
    let smb_url = smb_url_from_db
        .or_else(|| {
            fs::read_to_string(&env_path)
                .ok()
                .and_then(|content| read_env_value(&content, "SMB_URL"))
        })
        .unwrap_or_default();

    if smb_url.trim().is_empty() {
        return Err("SMB_URL is empty. Open Settings, set SMB_URL, and click Save Settings.".to_string());
    }

    Command::new("open")
        .arg(&smb_url)
        .spawn()
        .map_err(|error| format!("Failed to open SMB share: {error}"))?;

    Ok(())
}

#[tauri::command]
fn get_server_connection_status(app: tauri::AppHandle) -> Result<ServerConnectionStatus, String> {
    let repo_root = workspace_root(&app)?;
    let mount_name = configured_mount_name(&app, &repo_root);
    if mount_name.trim().is_empty() {
        return Ok(ServerConnectionStatus {
            connected: false,
            mount_point: String::new(),
            message: "MOUNT_NAME not set".to_string(),
        });
    }
    let mount_point = format!("/Volumes/{}", mount_name);

    let mount_output = Command::new("mount")
        .output()
        .map_err(|error| format!("Failed to execute mount command: {error}"))?;

    let mounts = String::from_utf8_lossy(&mount_output.stdout);
    let marker = format!("on {} ", mount_point);
    let connected = mounts.contains(&marker);

    let message = if connected {
        "Connected".to_string()
    } else {
        "Not connected".to_string()
    };

    Ok(ServerConnectionStatus {
        connected,
        mount_point,
        message,
    })
}

#[tauri::command]
fn sync_pending_changes_count(app: tauri::AppHandle) -> Result<PendingSyncInfo, String> {
    let result = run_sync_script(&app, &["changes-count"], None)?;
    let mut pending_count = 0usize;

    for line in result.stdout.lines().rev() {
        if let Some(value) = line.trim().strip_prefix("PENDING_COUNT=") {
            pending_count = value.trim().parse::<usize>().unwrap_or(0);
            break;
        }
    }

    Ok(PendingSyncInfo { pending_count })
}

#[tauri::command]
fn init_sqlite_backend(app: tauri::AppHandle) -> Result<String, String> {
    let database_path = sqlite_db_path(&app)?;
    let connection = open_sqlite_connection(&app)?;
    drop(connection);
    Ok(format!(
        "SQLite backend initialized at {}",
        database_path.display()
    ))
}

#[tauri::command]
fn ensure_connected_user(
    app: tauri::AppHandle,
    username: String,
    name: String,
    surname: String,
    last_edited_by_id: Option<i64>,
) -> Result<UserRecord, String> {
    let username = username.trim();
    let name = name.trim();
    let surname = surname.trim();

    if username.is_empty() {
        return Err("username is required".to_string());
    }

    if name.is_empty() {
        return Err("name is required".to_string());
    }

    if surname.is_empty() {
        return Err("surname is required".to_string());
    }

    let connection = open_sqlite_connection(&app)?;

    let existing = connection
        .query_row(
            r#"
            SELECT
                id,
                username,
                name,
                surname,
                "createdAt" as created_at,
                "lastEditedById" as last_edited_by_id,
                "deletedAt" as deleted_at
            FROM users
            WHERE username = ?1
              AND "deletedAt" IS NULL
            LIMIT 1
            "#,
            params![username],
            parse_user_row,
        )
        .optional()
        .map_err(|error| format!("Failed to query user: {error}"))?;

    if let Some(user) = existing {
        return Ok(user);
    }

    connection
        .execute(
            r#"
            INSERT INTO users (username, name, surname, "lastEditedById")
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![username, name, surname, last_edited_by_id],
        )
        .map_err(|error| format!("Failed to create user: {error}"))?;

    connection
        .query_row(
            r#"
            SELECT
                id,
                username,
                name,
                surname,
                "createdAt" as created_at,
                "lastEditedById" as last_edited_by_id,
                "deletedAt" as deleted_at
            FROM users
            WHERE id = last_insert_rowid()
            "#,
            [],
            parse_user_row,
        )
        .map_err(|error| format!("Failed to fetch created user: {error}"))
}

#[tauri::command]
fn create_uploaded_item(
    app: tauri::AppHandle,
    name: String,
    file_type: String,
    last_edited_by_id: Option<i64>,
) -> Result<UploadedItemRecord, String> {
    let name = name.trim();
    let file_type = file_type.trim().to_lowercase();

    if name.is_empty() {
        return Err("name is required".to_string());
    }

    if file_type != "file" && file_type != "folder" {
        return Err("fileType must be either 'file' or 'folder'".to_string());
    }

    let connection = open_sqlite_connection(&app)?;

    connection
        .execute(
            r#"
            INSERT INTO uploaded_items (name, "fileType", "lastEditedById")
            VALUES (?1, ?2, ?3)
            "#,
            params![name, file_type, last_edited_by_id],
        )
        .map_err(|error| format!("Failed to create uploaded item: {error}"))?;

    connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                "fileType" as file_type,
                "createdAt" as created_at,
                "lastEditedById" as last_edited_by_id,
                "deletedAt" as deleted_at
            FROM uploaded_items
            WHERE id = last_insert_rowid()
            "#,
            [],
            parse_uploaded_item_row,
        )
        .map_err(|error| format!("Failed to fetch created uploaded item: {error}"))
}

#[tauri::command]
fn list_uploaded_items(app: tauri::AppHandle) -> Result<Vec<UploadedItemRecord>, String> {
    let connection = open_sqlite_connection(&app)?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT
                id,
                name,
                "fileType" as file_type,
                "createdAt" as created_at,
                "lastEditedById" as last_edited_by_id,
                "deletedAt" as deleted_at
            FROM uploaded_items
            WHERE "deletedAt" IS NULL
            ORDER BY id DESC
            "#,
        )
        .map_err(|error| format!("Failed to prepare uploaded items query: {error}"))?;

    let rows = statement
        .query_map([], parse_uploaded_item_row)
        .map_err(|error| format!("Failed to query uploaded items: {error}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| format!("Failed to read uploaded item row: {error}"))?);
    }

    Ok(items)
}

#[tauri::command]
fn record_synced_items(
    app: tauri::AppHandle,
    items: Vec<serde_json::Value>,
    last_edited_by_id: Option<i64>,
) -> Result<Vec<UploadedItemRecord>, String> {
    let connection = open_sqlite_connection(&app)?;
    let items_count = items.len();

    for item in items {
        let name = item
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        let file_type = if item.get("is_dir").and_then(|v| v.as_bool()).unwrap_or(false) {
            "folder"
        } else {
            "file"
        };

        connection
            .execute(
                r#"
                INSERT OR IGNORE INTO uploaded_items (name, "fileType", "lastEditedById")
                VALUES (?1, ?2, ?3)
                "#,
                params![name, file_type, last_edited_by_id],
            )
            .map_err(|error| format!("Failed to insert uploaded item: {error}"))?;
    }

    let mut statement = connection
        .prepare(
            r#"
            SELECT
                id,
                name,
                "fileType" as file_type,
                "createdAt" as created_at,
                "lastEditedById" as last_edited_by_id,
                "deletedAt" as deleted_at
            FROM uploaded_items
            WHERE "deletedAt" IS NULL
            ORDER BY id DESC
            LIMIT ?1
            "#,
        )
        .map_err(|error| format!("Failed to prepare query: {error}"))?;

    let rows = statement
        .query_map(params![items_count], parse_uploaded_item_row)
        .map_err(|error| format!("Failed to query uploaded items: {error}"))?;

    let mut recorded = Vec::new();
    for row in rows {
        recorded.push(row.map_err(|error| format!("Failed to read row: {error}"))?);
    }

    Ok(recorded)
}

#[tauri::command]
fn get_app_setting(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let connection = open_sqlite_connection(&app)?;
    let value = read_app_setting_value(&connection, &key)?;
    Ok(value)
}

#[tauri::command]
fn set_app_setting(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let connection = open_sqlite_connection(&app)?;
    upsert_app_setting(&connection, &key, &value)
}

fn upsert_app_setting(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            r#"INSERT INTO app_settings (key, value, "updatedAt")
               VALUES (?1, ?2, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, "updatedAt" = excluded."updatedAt""#,
            params![key, value],
        )
        .map_err(|error| format!("Failed to save app setting '{key}': {error}"))?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(SyncRuntime::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Err(error) = open_sqlite_connection(app.handle()) {
                return Err(Box::new(std::io::Error::new(std::io::ErrorKind::Other, error)));
            }

            let file_menu = SubmenuBuilder::new(app, "File")
                .close_window()
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;

            let logs_menu = SubmenuBuilder::new(app, "Logs")
                .text(LOGS_OPEN_ADMIN_ID, "Open Admin Dashboard")
                .build()?;

            let about_metadata = AboutMetadataBuilder::new()
                .name(Some("Flowit"))
                .version(Some(env!("CARGO_PKG_VERSION")))
                .icon(app.default_window_icon().cloned())
                .build();

            let home_menu = SubmenuBuilder::new(app, "Flowit")
                .about(Some(about_metadata))
                .separator()
                .text(FLOWIT_CHECK_UPDATE_ID, "Check for Update")
                .build()?;

            let mut help_menu_builder = SubmenuBuilder::new(app, "Help");
            if should_show_start_tour_menu_item(app.handle()) {
                help_menu_builder = help_menu_builder.text(HELP_START_TOUR_ID, "Start Tour");
            }
            let help_menu = help_menu_builder
                .text(HELP_HOW_TO_USE_ID, "How to Use Flowit")
                .text(HELP_OPEN_README_ID, "Open User Guide (README)")
                .text(HELP_OPEN_LOGS_ID, "Open Sync Logs Folder")
                .separator()
                .text(HELP_ADMIN_HELP_ID, "Admin Dashboard Help")
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &home_menu,
                    &file_menu,
                    &edit_menu,
                    &view_menu,
                    &logs_menu,
                    &window_menu,
                    &help_menu,
                ])
                .build()?;

            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == FLOWIT_CHECK_UPDATE_ID {
                let payload = AdminUnlockRequest {
                    action: "check-update".to_string(),
                };

                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.emit(REQUEST_UPDATE_CHECK_EVENT, payload.clone()) {
                        eprintln!("Failed to emit update-check event to main window: {error}");
                    }
                } else if let Err(error) = app.emit(REQUEST_UPDATE_CHECK_EVENT, payload) {
                    eprintln!("Failed to emit update-check event: {error}");
                }
                return;
            }

            if event.id() == HELP_START_TOUR_ID {
                let payload = AdminUnlockRequest {
                    action: "start-tour".to_string(),
                };

                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.emit(REQUEST_ADMIN_UNLOCK_EVENT, payload.clone()) {
                        eprintln!("Failed to emit start tour event to main window: {error}");
                    }
                } else if let Err(error) = app.emit(REQUEST_ADMIN_UNLOCK_EVENT, payload) {
                    eprintln!("Failed to emit start tour event: {error}");
                }
                return;
            }

            if event.id() == HELP_HOW_TO_USE_ID {
                if let Err(error) = open_getting_started_window(app) {
                    eprintln!("{error}");
                }
                return;
            }

            if event.id() == HELP_ADMIN_HELP_ID {
                show_admin_help();
                return;
            }

            if event.id() == LOGS_OPEN_ADMIN_ID {
                let payload = AdminUnlockRequest {
                    action: "open-admin-dashboard".to_string(),
                };
                let mut delivered = false;

                if let Some(window) = app.get_webview_window("main") {
                    match window.emit(REQUEST_ADMIN_UNLOCK_EVENT, payload.clone()) {
                        Ok(()) => delivered = true,
                        Err(error) => eprintln!("Failed to emit admin unlock event to main window: {error}"),
                    }
                }

                if !delivered {
                    if let Err(error) = app.emit(REQUEST_ADMIN_UNLOCK_EVENT, payload) {
                        eprintln!("Failed to emit admin unlock event: {error}");
                    }
                }
                return;
            }

            if event.id() == HELP_OPEN_README_ID {
                match workspace_root(app)
                    .and_then(|root| open_path_with_default_app(&root.join("README.md")))
                {
                    Ok(()) => {}
                    Err(error) => eprintln!("{error}"),
                }
                return;
            }

            if event.id() == HELP_OPEN_LOGS_ID {
                match workspace_root(app).and_then(|root| {
                    let logs_dir = root.join("logs");
                    fs::create_dir_all(&logs_dir)
                        .map_err(|error| format!("Failed to create logs directory: {error}"))?;
                    open_path_with_default_app(&logs_dir)
                }) {
                    Ok(()) => {}
                    Err(error) => eprintln!("{error}"),
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            sync_now,
            start_sync,
            sync_status,
            read_sync_log,
            get_settings,
            save_settings,
            get_sync_ignore_entries,
            add_sync_ignore_entry,
            remove_sync_ignore_entry,
            pick_local_source,
            verify_admin_code,
            get_sync_source_items,
            get_server_connection_status,
            mount_smb_share,
            sync_pending_changes_count,
            init_sqlite_backend,
            ensure_connected_user,
            create_uploaded_item,
            list_uploaded_items,
            record_synced_items,
            get_app_setting,
            set_app_setting,
            read_all_users_sync_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
