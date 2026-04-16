#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

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

fn run_sync_script(app: &tauri::AppHandle, args: &[&str]) -> Result<CommandResult, String> {
    let repo_root = find_repo_root(app)?;
    let script_path = repo_root.join("run.sh");

    let output = Command::new("/bin/zsh")
        .arg(script_path)
        .args(args)
        .current_dir(&repo_root)
        .output()
        .map_err(|error| format!("Failed to execute sync script: {error}"))?;

    Ok(CommandResult {
        ok: output.status.success(),
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
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
            _ => {}
        }
    }

    settings
}

fn escape_env_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[tauri::command]
fn sync_now(app: tauri::AppHandle) -> Result<CommandResult, String> {
    run_sync_script(&app, &[])
}

#[tauri::command]
fn sync_status(app: tauri::AppHandle) -> Result<CommandResult, String> {
    run_sync_script(&app, &["status"])
}

#[tauri::command]
fn read_sync_log(app: tauri::AppHandle, max_lines: Option<usize>) -> Result<String, String> {
    let repo_root = find_repo_root(&app)?;
    let log_path = repo_root.join(Path::new("logs").join("sync.log"));

    if !log_path.exists() {
        return Ok("No sync log yet. Run a sync first.".to_string());
    }

    let content = fs::read_to_string(&log_path)
        .map_err(|error| format!("Failed to read {}: {error}", log_path.display()))?;

    Ok(tail_lines(&content, max_lines.unwrap_or(150)))
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let repo_root = find_repo_root(&app)?;
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
) -> Result<String, String> {
    let repo_root = find_repo_root(&app)?;
    let env_path = local_env_path(&repo_root);

    let content = format!(
        "LOCAL_SOURCE=\"{}\"\nDEST_SUBPATH=\"{}\"\n",
        escape_env_value(local_source.trim()),
        escape_env_value(dest_subpath.trim())
    );

    fs::write(&env_path, content)
        .map_err(|error| format!("Failed to write {}: {error}", env_path.display()))?;

    Ok("Settings saved to .local.env".to_string())
}

#[tauri::command]
fn pick_local_source() -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new().pick_folder();
    Ok(picked.map(|path| path.display().to_string()))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            sync_now,
            sync_status,
            read_sync_log,
            get_settings,
            save_settings,
            pick_local_source
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
