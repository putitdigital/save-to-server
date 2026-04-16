import "./styles.css";
import { invoke } from "@tauri-apps/api/core";

const commandOutput = document.getElementById("command-output");
const logOutput = document.getElementById("log-output");
const syncButton = document.getElementById("btn-sync");
const statusButton = document.getElementById("btn-status");
const logButton = document.getElementById("btn-log");
const localSourceInput = document.getElementById("local-source-input");
const destSubpathInput = document.getElementById("dest-subpath-input");
const saveSettingsButton = document.getElementById("btn-save-settings");
const loadSettingsButton = document.getElementById("btn-load-settings");
const settingsStatus = document.getElementById("settings-status");
const browseSourceButton = document.getElementById("btn-browse-source");

function setSettingsStatus(message, isError = false) {
  settingsStatus.textContent = message;
  settingsStatus.classList.toggle("is-error", isError);
}

function showCommandResult(label, result) {
  const chunks = [
    `# ${label}`,
    "",
    `ok: ${result.ok}`,
    `exit_code: ${result.code}`
  ];

  if (result.stdout?.trim()) {
    chunks.push("", "stdout:", result.stdout.trim());
  }

  if (result.stderr?.trim()) {
    chunks.push("", "stderr:", result.stderr.trim());
  }

  commandOutput.textContent = chunks.join("\n");
}

function showError(label, error) {
  commandOutput.textContent = `# ${label}\n\nerror:\n${String(error)}`;
}

async function checkStatus() {
  statusButton.disabled = true;
  try {
    const result = await invoke("sync_status");
    showCommandResult("Status", result);
  } catch (error) {
    showError("Status", error);
  } finally {
    statusButton.disabled = false;
  }
}

async function syncNow() {
  syncButton.disabled = true;
  commandOutput.textContent = "Running sync...";
  try {
    const result = await invoke("sync_now");
    showCommandResult("Sync", result);
    await refreshLog();
  } catch (error) {
    showError("Sync", error);
  } finally {
    syncButton.disabled = false;
  }
}

async function refreshLog() {
  logButton.disabled = true;
  try {
    const result = await invoke("read_sync_log", { maxLines: 180 });
    logOutput.textContent = result || "Log file is empty.";
  } catch (error) {
    logOutput.textContent = `Unable to read log:\n${String(error)}`;
  } finally {
    logButton.disabled = false;
  }
}

async function loadSettings() {
  loadSettingsButton.disabled = true;
  setSettingsStatus("Loading settings...");
  try {
    const settings = await invoke("get_settings");
    localSourceInput.value = settings.local_source || "";
    destSubpathInput.value = settings.dest_subpath || "";
    setSettingsStatus("Settings loaded.");
  } catch (error) {
    setSettingsStatus(`Failed to load settings: ${String(error)}`, true);
  } finally {
    loadSettingsButton.disabled = false;
  }
}

async function saveSettings() {
  saveSettingsButton.disabled = true;
  setSettingsStatus("Saving settings...");

  try {
    const localSource = localSourceInput.value.trim();
    const destSubpath = destSubpathInput.value.trim();

    const message = await invoke("save_settings", {
      localSource,
      destSubpath
    });

    setSettingsStatus(message || "Settings saved.");
  } catch (error) {
    setSettingsStatus(`Failed to save settings: ${String(error)}`, true);
  } finally {
    saveSettingsButton.disabled = false;
  }
}

async function browseLocalSource() {
  browseSourceButton.disabled = true;
  try {
    const selectedPath = await invoke("pick_local_source");
    if (selectedPath) {
      localSourceInput.value = selectedPath;
      setSettingsStatus("LOCAL_SOURCE selected. Save settings to apply.");
    } else {
      setSettingsStatus("Folder selection canceled.");
    }
  } catch (error) {
    setSettingsStatus(`Unable to open folder picker: ${String(error)}`, true);
  } finally {
    browseSourceButton.disabled = false;
  }
}

syncButton.addEventListener("click", syncNow);
statusButton.addEventListener("click", checkStatus);
logButton.addEventListener("click", refreshLog);
saveSettingsButton.addEventListener("click", saveSettings);
loadSettingsButton.addEventListener("click", loadSettings);
browseSourceButton.addEventListener("click", browseLocalSource);

checkStatus();
refreshLog();
loadSettings();
