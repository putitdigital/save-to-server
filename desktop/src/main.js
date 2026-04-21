import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";

const commandOutput = document.getElementById("command-output");
const logOutput = document.getElementById("log-output");
const syncButton = document.getElementById("btn-sync");
const statusButton = document.getElementById("btn-status");
const logButton = document.getElementById("btn-log");
const updateButton = document.getElementById("btn-check-update") || document.getElementById("btn-update");
const updateStatus = document.getElementById("update-status") || document.getElementById("btn-update");
const appVersion = document.getElementById("app-version");
const serverStatusBadge = document.getElementById("server-status-badge");
const localSourceInput = document.getElementById("local-source-input");
const destSubpathInput = document.getElementById("dest-subpath-input");
const saveSettingsButton = document.getElementById("btn-save-settings");
const loadSettingsButton = document.getElementById("btn-load-settings");
const settingsStatus = document.getElementById("settings-status");
const ignoreList = document.getElementById("ignore-list");
const ignoreInput = document.getElementById("ignore-input");
const addIgnoreButton = document.getElementById("btn-add-ignore");
const refreshIgnoreButton = document.getElementById("btn-refresh-ignore");
const browseSourceButton = document.getElementById("btn-browse-source");
const refreshSyncItemsButton = document.getElementById("btn-refresh-sync-items");
const adminCodeInput = document.getElementById("admin-code-input");
const adminUnlockButton = document.getElementById("btn-admin-unlock");
const adminStatus = document.getElementById("admin-status");
const appShell = document.getElementById("app-shell");
const gettingStartedShell = document.getElementById("getting-started-shell");
const userTabButton = document.getElementById("tab-btn-user");
const homeTabButton = document.getElementById("tab-btn-home");
const adminTabButton = document.getElementById("tab-btn-admin");
const helpTabButton = document.getElementById("tab-btn-help");
const settingsTabButton = document.getElementById("tab-btn-settings");
const userTabPanel = document.getElementById("tab-panel-user");
const homeTabPanel = document.getElementById("tab-panel-home");
const adminTabPanel = document.getElementById("tab-panel-admin");
const helpTabPanel = document.getElementById("tab-panel-help");
const settingsTabPanel = document.getElementById("tab-panel-settings");
const userInfoLocalUser = document.getElementById("user-info-local-user");
const userInfoServerStatus = document.getElementById("user-info-server-status");
const userInfoLocalFolder = document.getElementById("user-info-local-folder");
const userInfoServerFolder = document.getElementById("user-info-server-folder");
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
let syncStateRequestToken = 0;
let autoSyncMonitorTimer = null;
let isAutoSyncMonitorRunning = false;
let currentServerConnectionLabel = "Checking...";
let currentServerMountPoint = "";
let activeMainTab = "home";
let lastBackgroundItemsRefreshAt = 0;
let ignoreEntries = [];

const AUTO_SYNC_MONITOR_MS = 15000;
const AUTO_SYNC_ITEMS_REFRESH_MS = 180000;
const BACKGROUND_NETWORK_CHECKS_ENABLED = false;

const currentView = new URLSearchParams(window.location.search).get("view");

function switchMainTab(tab) {
  const tabs = [
    { key: "user", button: userTabButton, panel: userTabPanel },
    { key: "home", button: homeTabButton, panel: homeTabPanel },
    { key: "settings", button: settingsTabButton, panel: settingsTabPanel },
    { key: "admin", button: adminTabButton, panel: adminTabPanel },
    { key: "help", button: helpTabButton, panel: helpTabPanel }
  ];

  const validTabs = tabs.filter((entry) => entry.button && entry.panel);
  if (validTabs.length === 0) {
    return;
  }

  for (const entry of validTabs) {
    const isActive = entry.key === tab;
    entry.panel.classList.toggle("hidden", !isActive);
    entry.button.classList.toggle("is-active", isActive);
    entry.button.setAttribute("aria-selected", String(isActive));
  }

  activeMainTab = tab;
}

function extractLocalUser(path) {
  const match = path.match(/^\/Users\/([^/]+)\//);
  if (match?.[1]) {
    return match[1];
  }

  return "Unknown";
}

function refreshUserInfoPanel() {
  if (userInfoServerStatus) {
    userInfoServerStatus.textContent = currentServerConnectionLabel || "Unknown";
  }

  if (userInfoLocalFolder) {
    const localFolder = localSourceInput?.value?.trim();
    userInfoLocalFolder.textContent = localFolder || "Not set";
  }

  if (userInfoServerFolder) {
    const serverFolder = destSubpathInput?.value?.trim() || "";
    const normalizedSubpath = serverFolder.replace(/^\/+/, "");

    if (currentServerMountPoint && normalizedSubpath) {
      const normalizedMount = currentServerMountPoint.replace(/\/+$/, "");
      userInfoServerFolder.textContent = `${normalizedMount}/${normalizedSubpath}`;
    } else {
      userInfoServerFolder.textContent = serverFolder || "Not set";
    }
  }

  if (userInfoLocalUser) {
    const localFolder = localSourceInput?.value?.trim();
    userInfoLocalUser.textContent = localFolder ? extractLocalUser(localFolder) : "Unknown";
  }
}

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderIgnoreEntries() {
  if (!ignoreList) {
    return;
  }

  if (!ignoreEntries.length) {
    ignoreList.innerHTML = "";
    return;
  }

  ignoreList.innerHTML = ignoreEntries
    .map((entry) => {
      const safe = escapeHtml(entry);
      return `<li class="ignore-item"><span class="ignore-pattern">${safe}</span><button class="btn ignore-remove-btn" type="button" data-ignore-pattern="${safe}">Remove</button></li>`;
    })
    .join("");

}

async function loadIgnoreEntries() {
  if (refreshIgnoreButton) {
    refreshIgnoreButton.disabled = true;
  }

  try {
    const entries = await invoke("get_sync_ignore_entries");
    ignoreEntries = Array.isArray(entries) ? entries : [];
    renderIgnoreEntries();
  } catch (error) {
    ignoreEntries = [];
    if (ignoreList) {
      ignoreList.innerHTML = "";
    }
    console.error(`Failed to load ignore rules: ${String(error)}`);
  } finally {
    if (refreshIgnoreButton) {
      refreshIgnoreButton.disabled = false;
    }
  }
}

async function addIgnoreEntry() {
  if (!ignoreInput || !addIgnoreButton) {
    return;
  }

  const pattern = ignoreInput.value.trim();

  addIgnoreButton.disabled = true;

  try {
    const entries = await invoke("add_sync_ignore_entry", { pattern });
    ignoreEntries = Array.isArray(entries) ? entries : [];
    ignoreInput.value = "";
    renderIgnoreEntries();
    await loadSyncItems({ skipButtonRefresh: true, silent: true });
  } catch (error) {
    console.error(`Failed to add ignore rule: ${String(error)}`);
  } finally {
    addIgnoreButton.disabled = false;
  }
}

async function removeIgnoreEntry(pattern) {
  if (!pattern) {
    return;
  }

  try {
    const entries = await invoke("remove_sync_ignore_entry", { pattern });
    ignoreEntries = Array.isArray(entries) ? entries : [];
    renderIgnoreEntries();
    await loadSyncItems({ skipButtonRefresh: true, silent: true });
  } catch (error) {
    console.error(`Failed to remove ignore rule: ${String(error)}`);
  }
}

function setUpdateStatus(message, isError = false) {
  if (!updateStatus) {
    return;
  }

  updateStatus.textContent = `Update status: ${message}`;
  updateStatus.classList.toggle("is-error", isError);
}

async function loadAppVersion() {
  if (!appVersion) {
    return;
  }

  try {
    const version = await getVersion();
    appVersion.textContent = `v${version}`;
  } catch (_error) {
    appVersion.textContent = "Version unavailable";
  }
}

function setServerStatusBadge(state, message) {
  if (!serverStatusBadge) {
    return;
  }

  serverStatusBadge.textContent = message;
  currentServerConnectionLabel = message;
  serverStatusBadge.classList.remove("server-status-connected", "server-status-disconnected", "server-status-unknown");

  if (state === "connected") {
    serverStatusBadge.classList.add("server-status-connected");
  } else if (state === "disconnected") {
    serverStatusBadge.classList.add("server-status-disconnected");
  } else {
    serverStatusBadge.classList.add("server-status-unknown");
  }

  refreshUserInfoPanel();
}

function setSyncButtonLabel(text) {
  if (!syncButton) {
    return;
  }

  syncButton.textContent = text;
}

async function refreshSyncButtonState(options = {}) {
  const { force = false } = options;

  if (!force && !BACKGROUND_NETWORK_CHECKS_ENABLED) {
    setSyncButtonLabel("Sync Now");
    if (syncButton) {
      syncButton.disabled = false;
    }
    return;
  }

  if (isSyncInProgress || !syncButton) {
    return;
  }

  const requestToken = ++syncStateRequestToken;

  try {
    const result = await invoke("sync_pending_changes_count");
    if (requestToken !== syncStateRequestToken) {
      return;
    }

    const pendingCount = Number(result?.pending_count || 0);

    if (pendingCount > 0) {
      setSyncButtonLabel("Sync Now");
      syncButton.disabled = false;

      if (syncItems.length > 0 && syncItems.every((item) => item.status === "done")) {
        syncItems = syncItems.map((item) => ({ ...item, status: "pending" }));
        renderSyncItems();
        setSyncItemsStatus("Pending changes detected.");
      }

      return;
    }

    setSyncButtonLabel("All up to date");
    syncButton.disabled = false;

    if (syncItems.length > 0) {
      syncItems = syncItems.map((item) => ({ ...item, status: "done" }));
      renderSyncItems();
      const displayItems = getDisplaySyncItems();
      setSyncItemsStatus(`All ${displayItems.length} folders/files are up to date.`);
    }
  } catch (_error) {
    if (requestToken !== syncStateRequestToken) {
      return;
    }

    setSyncButtonLabel("Sync Now");
    syncButton.disabled = false;
  }
}

function stopAutoSyncMonitor() {
  if (autoSyncMonitorTimer) {
    window.clearInterval(autoSyncMonitorTimer);
    autoSyncMonitorTimer = null;
  }
}

async function runAutoSyncMonitorTick() {
  if (!BACKGROUND_NETWORK_CHECKS_ENABLED) {
    return;
  }

  if (isSyncInProgress || isAutoSyncMonitorRunning) {
    return;
  }

  if (activeMainTab !== "home") {
    return;
  }

  isAutoSyncMonitorRunning = true;

  try {
    const now = Date.now();
    const shouldRefreshItems =
      activeMainTab === "home" &&
      (syncItems.length === 0 || now - lastBackgroundItemsRefreshAt >= AUTO_SYNC_ITEMS_REFRESH_MS);

    if (shouldRefreshItems) {
      await loadSyncItems({
        silent: true,
        skipButtonRefresh: true
      });
      lastBackgroundItemsRefreshAt = now;
    }

    await refreshSyncButtonState();
  } finally {
    isAutoSyncMonitorRunning = false;
  }
}

function startAutoSyncMonitor() {
  if (!BACKGROUND_NETWORK_CHECKS_ENABLED) {
    return;
  }

  stopAutoSyncMonitor();
  autoSyncMonitorTimer = window.setInterval(() => {
    void runAutoSyncMonitorTick();
  }, AUTO_SYNC_MONITOR_MS);
}

async function refreshServerStatus() {
  setServerStatusBadge("unknown", "Checking...");
  currentServerMountPoint = "";

  try {
    const result = await invoke("get_server_connection_status");
    currentServerMountPoint = result?.mount_point || "";
    if (result?.connected) {
      setServerStatusBadge("connected", "Connected");
    } else {
      setServerStatusBadge("disconnected", "Not connected");
    }
  } catch (_error) {
    currentServerMountPoint = "";
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

async function loadSyncItems(options = {}) {
  const { silent = false, skipButtonRefresh = true } = options;

  if (!silent) {
    setSyncItemsStatus("Loading files and folders...");
  }

  try {
    const items = await invoke("get_sync_source_items", {
      maxItems: 180,
      maxDepth: 3
    });

    const nextSyncItems = (items || []).map((item) => ({
      path: item.path,
      is_dir: item.is_dir,
      status: "pending"
    }));

    const statusByItemKey = new Map(syncItems.map((item) => [`${item.path}::${item.is_dir ? "dir" : "file"}`, item.status]));

    syncItems = nextSyncItems.map((item) => {
      const key = `${item.path}::${item.is_dir ? "dir" : "file"}`;
      const previousStatus = statusByItemKey.get(key);
      return {
        ...item,
        status: previousStatus || "pending"
      };
    });

    renderSyncItems();
    if (syncItems.length === 0) {
      if (!silent) {
        setSyncItemsStatus("No files found in LOCAL_SOURCE. Save settings and try again.", true);
      }
      return;
    }

    if (!silent) {
      setSyncItemsStatus(`${syncItems.length} files/folders ready to sync.`);
    }

    if (!skipButtonRefresh) {
      await refreshSyncButtonState();
    }
  } catch (error) {
    if (!silent) {
      syncItems = [];
      renderSyncItems();
      setSyncItemsStatus(`Unable to load sync items: ${String(error)}`, true);
    }
  }
}

function showAdminDashboard() {
  if (adminPanel) {
    adminPanel.classList.remove("hidden");
    switchMainTab("admin");
    adminPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function hideAdminDashboard() {
  if (adminPanel) {
    adminPanel.classList.add("hidden");
  }
}

function handleAdminTabClick() {
  if (isAdminUnlocked) {
    showAdminDashboard();
    void refreshLog();
    return;
  }

  openAdminUnlockModal();
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
  if (!syncButton) {
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
      setSyncButtonLabel("Sync Now");
      syncButton.disabled = false;
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
    refreshUserInfoPanel();
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
    refreshUserInfoPanel();
    await loadSyncItems({ skipButtonRefresh: true });
    setSyncButtonLabel("Sync Now");
    syncButton.disabled = false;
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
      refreshUserInfoPanel();
    } else {
      setSettingsStatus("Folder selection canceled.");
    }
  } catch (error) {
    setSettingsStatus(`Unable to open folder picker: ${String(error)}`, true);
  } finally {
    browseSourceButton.disabled = false;
  }
}

async function refreshListAndAutoSync() {
  if (!refreshSyncItemsButton) {
    return;
  }

  if (isSyncInProgress) {
    setSyncItemsStatus("Sync is already in progress. Please wait...");
    return;
  }

  refreshSyncItemsButton.disabled = true;
  const previousLabel = refreshSyncItemsButton.textContent;
  refreshSyncItemsButton.textContent = "Refreshing...";

  try {
    await loadSyncItems({ skipButtonRefresh: true });

    const pendingInfo = await invoke("sync_pending_changes_count");
    const pendingCount = Number(pendingInfo?.pending_count || 0);

    if (pendingCount > 0) {
      setSyncButtonLabel("Sync Now");
      syncButton.disabled = false;
      setSyncItemsStatus(`Detected ${pendingCount} pending change(s). Starting auto sync...`);
      await syncNow();
      return;
    }

    setSyncButtonLabel("All up to date");
    syncButton.disabled = false;
    if (syncItems.length > 0) {
      syncItems = syncItems.map((item) => ({ ...item, status: "done" }));
      renderSyncItems();
      const displayItems = getDisplaySyncItems();
      setSyncItemsStatus(`No new files/folders found. All ${displayItems.length} items are up to date.`);
    } else {
      setSyncItemsStatus("No files found in LOCAL_SOURCE. Save settings and try again.", true);
    }
  } catch (error) {
    setSyncItemsStatus(`Unable to refresh list: ${String(error)}`, true);
  } finally {
    refreshSyncItemsButton.disabled = false;
    refreshSyncItemsButton.textContent = previousLabel || "Refresh List";
  }
}

if (currentView === "getting-started") {
  initGettingStartedView();
} else {
  closeAdminUnlockModal();
  hideAdminDashboard();

  syncButton.addEventListener("click", syncNow);
  userTabButton?.addEventListener("click", () => {
    switchMainTab("user");
  });
  homeTabButton?.addEventListener("click", () => {
    switchMainTab("home");
  });
  settingsTabButton?.addEventListener("click", () => {
    switchMainTab("settings");
  });
  adminTabButton?.addEventListener("click", handleAdminTabClick);
  helpTabButton?.addEventListener("click", () => {
    switchMainTab("help");
  });
  statusButton.addEventListener("click", checkStatus);
  logButton.addEventListener("click", refreshLog);
  updateButton?.addEventListener("click", checkForUpdate);
  saveSettingsButton.addEventListener("click", saveSettings);
  loadSettingsButton.addEventListener("click", loadSettings);
  browseSourceButton.addEventListener("click", browseLocalSource);
  addIgnoreButton?.addEventListener("click", () => {
    void addIgnoreEntry();
  });
  refreshIgnoreButton?.addEventListener("click", () => {
    void loadIgnoreEntries();
  });
  ignoreInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void addIgnoreEntry();
    }
  });
  ignoreList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const removeButton = target.closest(".ignore-remove-btn");
    if (!(removeButton instanceof HTMLButtonElement)) {
      return;
    }

    const pattern = removeButton.getAttribute("data-ignore-pattern") || "";
    void removeIgnoreEntry(pattern);
  });
  refreshSyncItemsButton?.addEventListener("click", () => {
    void refreshListAndAutoSync();
  });
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
  loadAppVersion();
  loadSyncItems({ skipButtonRefresh: true });
  loadIgnoreEntries();
  refreshServerStatus();
  setSyncButtonLabel("Sync Now");
  syncButton.disabled = false;
  refreshUserInfoPanel();
  switchMainTab("home");
  startAutoSyncMonitor();
}
