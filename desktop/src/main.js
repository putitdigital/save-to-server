import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";

const commandOutput = document.getElementById("command-output");
const logOutput = document.getElementById("log-output");
const syncButton = document.getElementById("btn-sync");
const statusButton = document.getElementById("btn-status");
const logButton = document.getElementById("btn-log");
const updateButton = document.getElementById("btn-update");
const updateStatus = document.getElementById("update-status");
const serverStatusBadge = document.getElementById("server-status-badge");
const localSourceInput = document.getElementById("local-source-input");
const destSubpathInput = document.getElementById("dest-subpath-input");
const saveSettingsButton = document.getElementById("btn-save-settings");
const loadSettingsButton = document.getElementById("btn-load-settings");
const settingsStatus = document.getElementById("settings-status");
const browseSourceButton = document.getElementById("btn-browse-source");
const adminCodeInput = document.getElementById("admin-code-input");
const adminUnlockButton = document.getElementById("btn-admin-unlock");
const adminStatus = document.getElementById("admin-status");
const appShell = document.getElementById("app-shell");
const gettingStartedShell = document.getElementById("getting-started-shell");
const settingsPanel = document.getElementById("panel-settings");
const adminPanel = document.getElementById("panel-admin");
const adminUnlockModal = document.getElementById("admin-unlock-modal");
const modalAdminCodeInput = document.getElementById("modal-admin-code-input");
const modalAdminStatus = document.getElementById("modal-admin-status");
const modalUnlockButton = document.getElementById("btn-modal-unlock");
const modalCancelButton = document.getElementById("btn-modal-cancel");
const syncItemsStatus = document.getElementById("sync-items-status");
const syncItemsList = document.getElementById("sync-items-list");

const REQUEST_ADMIN_UNLOCK_EVENT = "flowit://request-admin-unlock";

let adminCode = "";
let isAdminUnlocked = false;
let syncItems = [];
let progressTicker = null;
let progressIndex = 0;
let isSyncInProgress = false;
let syncDoneTimer = null;

const currentView = new URLSearchParams(window.location.search).get("view");

function initGettingStartedView() {
  if (appShell) {
    appShell.classList.add("hidden");
    appShell.setAttribute("aria-hidden", "true");
  }

  if (gettingStartedShell) {
    gettingStartedShell.classList.remove("hidden");
    gettingStartedShell.setAttribute("aria-hidden", "false");
  }
}

function setCommandText(text) {
  if (commandOutput) {
    commandOutput.textContent = text;
  }
}

function setSettingsStatus(message, isError = false) {
  settingsStatus.textContent = message;
  settingsStatus.classList.toggle("is-error", isError);
}

function setSyncItemsStatus(message, isError = false) {
  if (!syncItemsStatus) {
    return;
  }

  syncItemsStatus.textContent = message;
  syncItemsStatus.classList.toggle("is-error", isError);
}

function setUpdateStatus(message, isError = false) {
  if (!updateStatus) {
    return;
  }

  updateStatus.textContent = `Update status: ${message}`;
  updateStatus.classList.toggle("is-error", isError);
}

function setServerStatusBadge(state, message) {
  if (!serverStatusBadge) {
    return;
  }

  serverStatusBadge.textContent = message;
  serverStatusBadge.classList.remove("server-status-connected", "server-status-disconnected", "server-status-unknown");

  if (state === "connected") {
    serverStatusBadge.classList.add("server-status-connected");
  } else if (state === "disconnected") {
    serverStatusBadge.classList.add("server-status-disconnected");
  } else {
    serverStatusBadge.classList.add("server-status-unknown");
  }
}

function setSyncButtonLabel(text) {
  if (!syncButton) {
    return;
  }

  syncButton.textContent = text;
}

async function refreshSyncButtonState() {
  if (isSyncInProgress || !syncButton) {
    return;
  }

  try {
    const result = await invoke("sync_pending_changes_count");
    const pendingCount = Number(result?.pending_count || 0);

    if (pendingCount > 0) {
      setSyncButtonLabel("Sync Now");
      syncButton.disabled = false;
      return;
    }

    setSyncButtonLabel("All up to date");
    syncButton.disabled = true;
  } catch (_error) {
    setSyncButtonLabel("Sync Now");
    syncButton.disabled = false;
  }
}

async function refreshServerStatus() {
  setServerStatusBadge("unknown", "Checking...");

  try {
    const result = await invoke("get_server_connection_status");
    if (result?.connected) {
      setServerStatusBadge("connected", "Connected");
    } else {
      setServerStatusBadge("disconnected", "Not connected");
    }
  } catch (_error) {
    setServerStatusBadge("unknown", "Unknown");
  }
}

function normalizePath(value) {
  return value.replace(/^\.\//, "").replace(/\/$/, "").trim();
}

function formatItemLabel(item) {
  if (item.is_dir) {
    return `${item.path}/`;
  }

  return item.path;
}

function aggregateStatus(statuses) {
  if (statuses.some((value) => value === "in-progress")) {
    return "in-progress";
  }

  if (statuses.some((value) => value === "pending")) {
    return "pending";
  }

  return "done";
}

function getDisplaySyncItems() {
  const groupedFolders = new Map();
  const rootFiles = new Map();

  for (const item of syncItems) {
    const normalizedPath = normalizePath(item.path);
    if (!normalizedPath) {
      continue;
    }

    const parts = normalizedPath.split("/");

    if (parts.length === 1) {
      if (item.is_dir) {
        const existing = groupedFolders.get(normalizedPath) || [];
        existing.push(item.status);
        groupedFolders.set(normalizedPath, existing);
      } else {
        rootFiles.set(normalizedPath, item.status);
      }
      continue;
    }

    const topFolder = parts[0];
    const existing = groupedFolders.get(topFolder) || [];
    existing.push(item.status);
    groupedFolders.set(topFolder, existing);
  }

  const displayItems = [];

  for (const [folderName, statuses] of groupedFolders.entries()) {
    displayItems.push({
      path: folderName,
      is_dir: true,
      status: aggregateStatus(statuses)
    });
  }

  for (const [fileName, status] of rootFiles.entries()) {
    displayItems.push({
      path: fileName,
      is_dir: false,
      status
    });
  }

  return displayItems;
}

function renderSyncItems() {
  if (!syncItemsList) {
    return;
  }

  const displayItems = getDisplaySyncItems();

  if (displayItems.length === 0) {
    syncItemsList.innerHTML = "";
    return;
  }

  const statusRank = {
    "in-progress": 0,
    pending: 1,
    done: 2
  };

  const orderedItems = [...displayItems].sort((a, b) => {
    const rankA = statusRank[a.status] ?? 3;
    const rankB = statusRank[b.status] ?? 3;

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    return a.path.localeCompare(b.path);
  });

  const rows = orderedItems.slice(0, 160).map((item) => {
    const label = formatItemLabel(item)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const badge = item.status === "done" ? "done" : item.status === "in-progress" ? "in progress" : "pending";
    const statusClass = item.status === "done" ? "sync-item-done" : item.status === "in-progress" ? "sync-item-in-progress" : "sync-item-pending";

    return `<li class="sync-item ${statusClass}"><span class="sync-item-path" title="${label}">${label}</span><span class="sync-item-badge">${badge}</span></li>`;
  });

  syncItemsList.innerHTML = rows.join("");
}

function stopProgressTicker() {
  if (progressTicker) {
    window.clearInterval(progressTicker);
    progressTicker = null;
  }
}

function startProgressTicker() {
  stopProgressTicker();

  if (syncItems.length === 0) {
    return;
  }

  progressIndex = 0;
  syncItems = syncItems.map((item) => ({ ...item, status: "pending" }));

  progressTicker = window.setInterval(() => {
    if (syncItems.length === 0) {
      return;
    }

    const index = progressIndex % syncItems.length;
    syncItems = syncItems.map((item, itemIndex) => {
      if (item.status === "done") {
        return item;
      }

      return {
        ...item,
        status: itemIndex === index ? "in-progress" : "pending"
      };
    });

    renderSyncItems();
    progressIndex += 1;
  }, 420);
}

function parseRsyncPaths(stdout) {
  const paths = new Set();

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line || line === "./") {
      continue;
    }

    if (
      line.startsWith("sending incremental file list") ||
      line.startsWith("created directory") ||
      line.startsWith("sent ") ||
      line.startsWith("total size is ") ||
      line.startsWith("Number of files:") ||
      line.startsWith("Number of created files:") ||
      line.startsWith("Number of deleted files:") ||
      line.startsWith("Number of regular files transferred:") ||
      line.startsWith("Total file size:") ||
      line.startsWith("Total transferred file size:") ||
      line.startsWith("Literal data:") ||
      line.startsWith("Matched data:") ||
      line.startsWith("File list size:") ||
      line.startsWith("File list generation time:") ||
      line.startsWith("File list transfer time:") ||
      line.startsWith("Total bytes sent:") ||
      line.startsWith("Total bytes received:") ||
      line.startsWith("speedup is ")
    ) {
      continue;
    }

    const normalized = normalizePath(line);
    if (normalized) {
      paths.add(normalized);
    }
  }

  return paths;
}

function applySyncResultStatuses(stdout) {
  const syncedPaths = parseRsyncPaths(stdout);

  syncItems = syncItems.map((item) => {
    const itemPath = normalizePath(item.path);
    const dirPrefix = `${itemPath}/`;
    const isDone = syncedPaths.has(itemPath) || (item.is_dir && Array.from(syncedPaths).some((path) => path.startsWith(dirPrefix)));

    return {
      ...item,
      status: isDone ? "done" : "pending"
    };
  });

  renderSyncItems();

  const displayItems = getDisplaySyncItems();
  const doneCount = displayItems.filter((item) => item.status === "done").length;
  if (displayItems.length > 0) {
    setSyncItemsStatus(`${doneCount}/${displayItems.length} folders/files done in latest sync.`);
  }
}

async function finalizeSyncStatuses(stdout) {
  try {
    const pendingInfo = await invoke("sync_pending_changes_count");
    const pendingCount = Number(pendingInfo?.pending_count || 0);

    if (pendingCount === 0 && syncItems.length > 0) {
      syncItems = syncItems.map((item) => ({ ...item, status: "done" }));
      renderSyncItems();
      const displayItems = getDisplaySyncItems();
      setSyncItemsStatus(`All ${displayItems.length} folders/files are up to date.`);
      return;
    }
  } catch (_error) {
    // Fallback to stdout parsing if pending count check fails.
  }

  applySyncResultStatuses(stdout);
}

async function loadSyncItems() {
  setSyncItemsStatus("Loading files and folders...");

  try {
    const items = await invoke("get_sync_source_items", {
      maxItems: 180,
      maxDepth: 3
    });

    syncItems = (items || []).map((item) => ({
      path: item.path,
      is_dir: item.is_dir,
      status: "pending"
    }));

    renderSyncItems();
    if (syncItems.length === 0) {
      setSyncItemsStatus("No files found in LOCAL_SOURCE. Save settings and try again.", true);
      return;
    }

    setSyncItemsStatus(`${syncItems.length} files/folders ready to sync.`);
  } catch (error) {
    syncItems = [];
    renderSyncItems();
    setSyncItemsStatus(`Unable to load sync items: ${String(error)}`, true);
  }
}

function showAdminDashboard() {
  if (settingsPanel) {
    settingsPanel.classList.add("hidden");
  }

  if (adminPanel) {
    adminPanel.classList.remove("hidden");
    adminPanel.style.display = "grid";
    adminPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function hideAdminDashboard() {
  if (adminPanel) {
    adminPanel.classList.add("hidden");
    adminPanel.style.display = "none";
  }

  if (settingsPanel) {
    settingsPanel.classList.remove("hidden");
  }
}

function openAdminUnlockModal() {
  if (!adminUnlockModal) {
    return;
  }

  adminUnlockModal.classList.remove("hidden");
  if (modalAdminStatus) {
    modalAdminStatus.textContent = " ";
    modalAdminStatus.classList.remove("is-error");
  }
  if (modalAdminCodeInput) {
    modalAdminCodeInput.value = "";
    modalAdminCodeInput.focus();
  }
}

function closeAdminUnlockModal() {
  if (!adminUnlockModal) {
    return;
  }

  adminUnlockModal.classList.add("hidden");
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

  setCommandText(chunks.join("\n"));
}

function showError(label, error) {
  setCommandText(`# ${label}\n\nerror:\n${String(error)}`);
}

async function checkForUpdate() {
  if (!updateButton) {
    return;
  }

  updateButton.disabled = true;
  updateButton.textContent = "Checking...";
  setUpdateStatus("checking for updates...");
  setCommandText("Checking for app updates...");

  try {
    const update = await check();

    if (!update) {
      setCommandText("All up to date. You are already on the latest version.");
      setUpdateStatus("all up to date. You are already on the latest version.");
      return;
    }

    let downloaded = 0;
    let total = 0;
    setUpdateStatus(`update found (v${update.version}). Downloading now...`);
    setCommandText(`Update found: v${update.version}. Downloading...`);

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = Number(event.data?.contentLength || 0);
        setUpdateStatus(`download started for v${update.version}.`);
        setCommandText(`Update found: v${update.version}. Download started...`);
      }

      if (event.event === "Progress") {
        downloaded += Number(event.data?.chunkLength || 0);
        if (total > 0) {
          const percent = Math.min(100, Math.round((downloaded / total) * 100));
          setUpdateStatus(`downloading v${update.version}: ${percent}%`);
          setCommandText(`Downloading update v${update.version}: ${percent}%`);
        }
      }

      if (event.event === "Finished") {
        setUpdateStatus(`update installed (v${update.version}). Restart app to apply.`);
        setCommandText(`Update v${update.version} installed. Restart Flowit to finish.`);
      }
    });
  } catch (error) {
    const text = String(error);
    const missingReleaseJson = text.includes("Could not fetch a valid release JSON from the remote");
    const likelyNoPublishedRelease = text.includes("404") || text.includes("Not Found");

    if (missingReleaseJson || likelyNoPublishedRelease) {
      const guidance = "No published updater metadata found yet. Publish a signed GitHub release that includes latest.json, then try again.";
      setUpdateStatus(guidance, true);
      showError("Update", `${text}\n\n${guidance}`);
    } else {
      const help = "If this keeps happening, configure updater endpoints and pubkey in tauri.conf.json before packaging releases.";
      setUpdateStatus(`update check failed: ${text}`, true);
      showError("Update", `${text}\n\n${help}`);
    }
  } finally {
    updateButton.disabled = false;
    updateButton.textContent = "Check for Update";
  }
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
    await refreshServerStatus();
  }
}

async function syncNow() {
  if (!syncButton || syncButton.disabled) {
    return;
  }

  if (syncDoneTimer) {
    window.clearTimeout(syncDoneTimer);
    syncDoneTimer = null;
  }

  isSyncInProgress = true;
  syncButton.disabled = true;
  setSyncButtonLabel("Sync on process");
  setCommandText("Running sync...");
  setSyncItemsStatus("Sync in progress...");
  startProgressTicker();

  try {
    const result = await invoke("sync_now");
    showCommandResult("Sync", result);
    stopProgressTicker();
    await finalizeSyncStatuses(result.stdout || "");
    await refreshLog();
  } catch (error) {
    stopProgressTicker();
    showError("Sync", error);
    setSyncItemsStatus(`Sync failed: ${String(error)}`, true);
  } finally {
    stopProgressTicker();
    syncItems = syncItems.map((item) => (item.status === "done" ? item : { ...item, status: "pending" }));
    renderSyncItems();
    isSyncInProgress = false;
    setSyncButtonLabel("Sync done");
    syncDoneTimer = window.setTimeout(() => {
      syncDoneTimer = null;
      void refreshSyncButtonState();
    }, 1400);
    await refreshServerStatus();
  }
}

async function refreshLog() {
  if (!isAdminUnlocked) {
    logOutput.textContent = "Locked. Enter admin code to view logs.";
    return;
  }

  logButton.disabled = true;
  try {
    const result = await invoke("read_sync_log", {
      maxLines: 180,
      adminCode
    });
    logOutput.textContent = result || "Log file is empty.";
  } catch (error) {
    logOutput.textContent = `Unable to read log:\n${String(error)}`;
  } finally {
    logButton.disabled = false;
  }
}

async function unlockAdmin() {
  adminUnlockButton.disabled = true;
  adminStatus.classList.remove("is-error");

  try {
    const enteredCode = adminCodeInput.value.trim();
    if (!enteredCode) {
      adminStatus.textContent = "Enter a code first.";
      adminStatus.classList.add("is-error");
      return;
    }

    const ok = await invoke("verify_admin_code", { code: enteredCode });
    if (!ok) {
      isAdminUnlocked = false;
      adminCode = "";
      adminStatus.textContent = "Invalid admin code.";
      adminStatus.classList.add("is-error");
      logOutput.textContent = "Locked. Enter admin code to view logs.";
      return;
    }

    isAdminUnlocked = true;
    adminCode = enteredCode;
    adminStatus.textContent = "Unlocked";
    await refreshLog();
  } catch (error) {
    adminStatus.textContent = `Unable to verify code: ${String(error)}`;
    adminStatus.classList.add("is-error");
  } finally {
    adminUnlockButton.disabled = false;
  }
}

async function unlockAdminFromMenu() {
  const enteredCode = modalAdminCodeInput?.value.trim() || "";
  if (!enteredCode) {
    hideAdminDashboard();
    if (modalAdminStatus) {
      modalAdminStatus.textContent = "Enter admin code first.";
      modalAdminStatus.classList.add("is-error");
    }
    return;
  }

  try {
    const ok = await invoke("verify_admin_code", { code: enteredCode });
    if (!ok) {
      hideAdminDashboard();
      if (modalAdminStatus) {
        modalAdminStatus.textContent = "Invalid admin code.";
        modalAdminStatus.classList.add("is-error");
      }
      return;
    }

    isAdminUnlocked = true;
    adminCode = enteredCode;
    adminStatus.textContent = "Unlocked";
    adminStatus.classList.remove("is-error");
    showAdminDashboard();
    closeAdminUnlockModal();
    await refreshLog();
  } catch (error) {
    hideAdminDashboard();
    if (modalAdminStatus) {
      modalAdminStatus.textContent = `Unable to verify code: ${String(error)}`;
      modalAdminStatus.classList.add("is-error");
    }
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
    await loadSyncItems();
    await refreshSyncButtonState();
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

if (currentView === "getting-started") {
  initGettingStartedView();
} else {
  closeAdminUnlockModal();
  hideAdminDashboard();

  syncButton.addEventListener("click", syncNow);
  statusButton.addEventListener("click", checkStatus);
  logButton.addEventListener("click", refreshLog);
  updateButton?.addEventListener("click", checkForUpdate);
  saveSettingsButton.addEventListener("click", saveSettings);
  loadSettingsButton.addEventListener("click", loadSettings);
  browseSourceButton.addEventListener("click", browseLocalSource);
  adminUnlockButton?.addEventListener("click", unlockAdmin);
  modalUnlockButton?.addEventListener("click", () => {
    void unlockAdminFromMenu();
  });
  modalCancelButton?.addEventListener("click", closeAdminUnlockModal);
  modalAdminCodeInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void unlockAdminFromMenu();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeAdminUnlockModal();
    }
  });

  void listen(REQUEST_ADMIN_UNLOCK_EVENT, (event) => {
    const action = event?.payload?.action;
    if (action === "open-admin-dashboard") {
      if (isAdminUnlocked) {
        showAdminDashboard();
        void refreshLog();
        return;
      }

      openAdminUnlockModal();
    }
  }).catch((error) => {
    console.error("Failed to register admin unlock listener", error);
  });

  checkStatus();
  loadSettings();
  loadSyncItems();
  refreshServerStatus();
  refreshSyncButtonState();
}
