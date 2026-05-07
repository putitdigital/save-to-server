import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";

const commandOutput = document.getElementById("command-output");
const logOutput = document.getElementById("log-output");
const logOutputAllUsers = document.getElementById("log-output-for-all-users");
const syncButton = document.getElementById("btn-sync");
const connectToServerButton = document.getElementById("btn-connect-to-server");
const autoSyncCheckbox = document.getElementById("btn-auto-sync-checkbox");
const updateButton = document.getElementById("btn-check-update") || document.getElementById("btn-update");
const updateStatus = document.getElementById("update-status") || document.getElementById("btn-update");
const appVersion = document.getElementById("app-version");
const serverStatusBadge = document.getElementById("server-status-badge");
const localSourceInput = document.getElementById("local-source-input");
const destSubpathInput = document.getElementById("dest-subpath-input");
const smbUrlInput = document.getElementById("smb-url-input");
const mountNameInput = document.getElementById("mount-name-input");
const saveSettingsButton = document.getElementById("btn-save-settings");
const loadSettingsButton = document.getElementById("btn-load-settings");
const settingsStatus = document.getElementById("settings-status");
const ignoreList = document.getElementById("ignore-list");
const ignoreInput = document.getElementById("ignore-input");
const addIgnoreButton = document.getElementById("btn-add-ignore");
const refreshIgnoreButton = document.getElementById("btn-refresh-ignore");
const browseSourceButton = document.getElementById("btn-browse-source");
const startTourButton = document.getElementById("btn-start-tour");
const refreshSyncItemsButton = document.getElementById("btn-refresh-sync-items");
const adminCodeInput = document.getElementById("admin-code-input");
const adminUnlockButton = document.getElementById("btn-admin-unlock");
const adminStatus = document.getElementById("admin-status");
const appShell = document.getElementById("app-shell");
const gettingStartedShell = document.getElementById("getting-started-shell");
const leftTabs = document.querySelector(".left-tabs");
const sidebarToggleButton = document.getElementById("btn-sidebar-toggle");
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
const appTour = document.getElementById("app-tour");
const tourScrim = appTour?.querySelector(".tour-scrim");
const tourStepLabel = document.getElementById("tour-step-label");
const tourTitle = document.getElementById("tour-title");
const tourBody = document.getElementById("tour-body");
const tourNextButton = document.getElementById("btn-tour-next");
const tourSkipButton = document.getElementById("btn-tour-skip");

const REQUEST_ADMIN_UNLOCK_EVENT = "flowit://request-admin-unlock";
const SYNC_PROGRESS_EVENT = "flowit://sync-progress";
const SYNC_COMPLETE_EVENT = "flowit://sync-complete";
const SESSION_STORAGE_KEY = "flowit.connectedUserSession";
const SIDEBAR_COLLAPSED_KEY = "flowit.sidebarCollapsed";
const TOUR_COMPLETED_KEY = "tour_completed";
const TELEMETRY_API_BASE = "https://putitdigital.co.za/flowit-api/api";
const TELEMETRY_INSTANCE_ID_KEY = "flowit.telemetryInstanceId";

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
let isServerConnected = false;
let connectedUserSession = null;
let isSidebarCollapsed = false;
let autoSyncEnabled = false;
let syncProgressTotalCount = 0;
let syncProgressPaths = new Set();
let syncProgressLines = [];
let activeMainTab = "home";
let lastBackgroundItemsRefreshAt = 0;
let ignoreEntries = [];
let activeTourStepIndex = -1;
let activeTourTarget = null;
let cachedAppVersion = "unknown";
let telemetryAuthToken = "";
let telemetryTokenExpiresAtMs = 0;

const appTourSteps = [
  {
    label: "Step 1 of 5",
    title: "Open Settings",
    body: "Click the Settings tab in the sidebar to open your configuration.",
    tab: "settings",
    getTarget: () => settingsTabButton
  },
  {
    label: "Step 2 of 5",
    title: "Configure Your Settings",
    body: "Fill in your Local Folder, Server Folder, SMB_URL, and MOUNT_NAME to tell Flowit where to sync from and to.",
    tab: "settings",
    getTarget: () => document.getElementById("panel-settings") || settingsTabButton
  },
  {
    label: "Step 3 of 5",
    title: "Save Settings",
    body: "Click the Save Settings button to apply and store your folder configuration.",
    tab: "settings",
    getTarget: () => saveSettingsButton || settingsTabButton
  },
  {
    label: "Step 4 of 5",
    title: "Go to Home",
    body: "Click the Home tab in the sidebar to go back to the main dashboard.",
    tab: "home",
    getTarget: () => homeTabButton
  },
  {
    label: "Step 5 of 5",
    title: "Sync Now",
    body: "Click Sync Now to run your first upload to the server.",
    tab: "home",
    getTarget: () => syncButton || homeTabButton
  }
];

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

function applySidebarState() {
  if (!leftTabs || !sidebarToggleButton) {
    return;
  }

  leftTabs.classList.toggle("is-collapsed", isSidebarCollapsed);
  sidebarToggleButton.setAttribute("aria-expanded", String(!isSidebarCollapsed));
  sidebarToggleButton.setAttribute(
    "aria-label",
    isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
  );
}

function loadSidebarState() {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    isSidebarCollapsed = stored === null ? true : stored === "true";
  } catch (_error) {
    isSidebarCollapsed = true;
  }

  applySidebarState();
}

function toggleSidebar() {
  isSidebarCollapsed = !isSidebarCollapsed;

  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isSidebarCollapsed));
  } catch (_error) {
    // Ignore storage failures and still apply the UI change.
  }

  applySidebarState();
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

function clearTourHighlight() {
  if (activeTourTarget) {
    activeTourTarget.classList.remove("tour-target");
    activeTourTarget = null;
  }

  if (tourScrim instanceof HTMLElement) {
    tourScrim.style.removeProperty("--tour-hole-left");
    tourScrim.style.removeProperty("--tour-hole-top");
    tourScrim.style.removeProperty("--tour-hole-right");
    tourScrim.style.removeProperty("--tour-hole-bottom");
    tourScrim.classList.remove("has-hole");
  }
}

function updateTourHighlight() {
  if (!(activeTourTarget instanceof HTMLElement) || !(tourScrim instanceof HTMLElement)) {
    return;
  }

  const padding = 10;
  const rect = activeTourTarget.getBoundingClientRect();
  const left = Math.max(0, rect.left - padding);
  const top = Math.max(0, rect.top - padding);
  const right = Math.min(window.innerWidth, rect.right + padding);
  const bottom = Math.min(window.innerHeight, rect.bottom + padding);

  tourScrim.style.setProperty("--tour-hole-left", `${left}px`);
  tourScrim.style.setProperty("--tour-hole-top", `${top}px`);
  tourScrim.style.setProperty("--tour-hole-right", `${right}px`);
  tourScrim.style.setProperty("--tour-hole-bottom", `${bottom}px`);
  tourScrim.classList.add("has-hole");
}

function setTourOpen(isOpen) {
  if (!appTour) {
    return;
  }

  appTour.classList.toggle("hidden", !isOpen);
  appTour.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("tour-open", isOpen);
}

async function markTourCompleted() {
  try {
    await invoke("set_app_setting", { key: TOUR_COMPLETED_KEY, value: "true" });
  } catch (error) {
    console.error("Failed to persist tour state", error);
  }
}

async function closeTour(options = {}) {
  const { completed = true } = options;
  clearTourHighlight();
  activeTourStepIndex = -1;
  setTourOpen(false);

  if (completed) {
    await markTourCompleted();
  }
}

function renderTourStep(index) {
  const step = appTourSteps[index];
  if (!step || !tourStepLabel || !tourTitle || !tourBody || !tourNextButton) {
    return;
  }

  clearTourHighlight();
  switchMainTab(step.tab);

  tourStepLabel.textContent = step.label;
  tourTitle.textContent = step.title;
  tourBody.textContent = step.body;
  tourNextButton.textContent = index === appTourSteps.length - 1 ? "Finish" : "Next";

  const target = step.getTarget?.();
  if (target instanceof HTMLElement) {
    activeTourTarget = target;
    activeTourTarget.classList.add("tour-target");
    activeTourTarget.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    requestAnimationFrame(updateTourHighlight);
  }
}

function startTour() {
  if (!appTour || !appTourSteps.length) {
    return;
  }

  if (adminUnlockModal && !adminUnlockModal.classList.contains("hidden")) {
    closeAdminUnlockModal();
  }

  closeAdminUnlockModal();
  activeTourStepIndex = 0;
  setTourOpen(true);
  renderTourStep(activeTourStepIndex);
}

function completeTourUi() {
  clearTourHighlight();
  activeTourStepIndex = -1;
  setTourOpen(false);
  switchMainTab("home");
}

function skipTourUi() {
  clearTourHighlight();
  activeTourStepIndex = -1;
  setTourOpen(false);
}

async function advanceTour() {
  if (activeTourStepIndex < 0) {
    activeTourStepIndex = 0;
    setTourOpen(true);
    renderTourStep(activeTourStepIndex);
    return;
  }

  if (activeTourStepIndex >= appTourSteps.length - 1) {
    completeTourUi();
    await markTourCompleted();
    return;
  }

  activeTourStepIndex += 1;
  renderTourStep(activeTourStepIndex);
}

async function maybeStartFirstRunTour() {
  try {
    const completed = await invoke("get_app_setting", { key: TOUR_COMPLETED_KEY });
    if (completed === "true") {
      return;
    }
  } catch (error) {
    console.error("Failed to read tour state", error);
  }

  window.setTimeout(() => {
    startTour();
  }, 400);
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
    cachedAppVersion = version;
    appVersion.textContent = `v${version}`;
  } catch (_error) {
    cachedAppVersion = "unknown";
    appVersion.textContent = "Version unavailable";
  }
}

function createUuidV4() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = char === "x" ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

function getOrCreateTelemetryInstanceId() {
  try {
    const existing = window.localStorage.getItem(TELEMETRY_INSTANCE_ID_KEY);
    if (existing) {
      return existing;
    }

    const instanceId = createUuidV4();
    window.localStorage.setItem(TELEMETRY_INSTANCE_ID_KEY, instanceId);
    return instanceId;
  } catch (_error) {
    return createUuidV4();
  }
}

function detectOsName() {
  const platform = String(navigator?.userAgentData?.platform || navigator?.platform || "").toLowerCase();
  if (platform.includes("mac")) {
    return "macOS";
  }
  if (platform.includes("win")) {
    return "Windows";
  }
  if (platform.includes("linux")) {
    return "Linux";
  }
  return "Unknown";
}

function buildTelemetryUrl(path) {
  return `${TELEMETRY_API_BASE.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function postTelemetry(path, payload) {
  if (!TELEMETRY_API_BASE) {
    return;
  }

  try {
    const token = await getTelemetryAuthToken();
    if (!token) {
      return;
    }

    let response = await fetch(buildTelemetryUrl(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telemetry-Token": token
      },
      body: JSON.stringify(payload)
    });

    if (response.status === 401) {
      const refreshedToken = await getTelemetryAuthToken({ forceRefresh: true });
      if (!refreshedToken) {
        return;
      }

      response = await fetch(buildTelemetryUrl(path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telemetry-Token": refreshedToken
        },
        body: JSON.stringify(payload)
      });
    }

    if (!response.ok) {
      console.error(`Telemetry request failed (${path}): HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`Telemetry request failed (${path}): ${String(error)}`);
  }
}

async function getTelemetryAuthToken(options = {}) {
  const { forceRefresh = false } = options;
  const now = Date.now();

  if (!forceRefresh && telemetryAuthToken && telemetryTokenExpiresAtMs - now > 15000) {
    return telemetryAuthToken;
  }

  try {
    const response = await fetch(buildTelemetryUrl("telemetry_token.php"), {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      console.error(`Unable to fetch telemetry token: HTTP ${response.status}`);
      return "";
    }

    const data = await response.json();
    const nextToken = String(data?.token || "").trim();
    const expiresAt = Date.parse(String(data?.expires_at || ""));

    if (!nextToken || Number.isNaN(expiresAt)) {
      console.error("Telemetry token response missing token or expires_at");
      return "";
    }

    telemetryAuthToken = nextToken;
    telemetryTokenExpiresAtMs = expiresAt;
    return telemetryAuthToken;
  } catch (error) {
    console.error(`Unable to fetch telemetry token: ${String(error)}`);
    return "";
  }
}

async function sendTelemetryEvent(eventType, metadata = {}) {
  const instanceId = getOrCreateTelemetryInstanceId();
  const profile = getTelemetryUserProfile();
  await postTelemetry("track.php", {
    event_id: createUuidV4(),
    instance_id: instanceId,
    event_type: eventType,
    app_version: cachedAppVersion,
    os: detectOsName(),
    username: profile.username,
    name: profile.name,
    surname: profile.surname,
    metadata
  });
}

async function initializeTelemetry() {
  const instanceId = getOrCreateTelemetryInstanceId();
  const profile = getTelemetryUserProfile();

  await postTelemetry("register.php", {
    instance_id: instanceId,
    app_version: cachedAppVersion,
    os: detectOsName(),
    username: profile.username,
    name: profile.name,
    surname: profile.surname
  });

  await sendTelemetryEvent("app_open", {
    view: currentView || "main"
  });
}

function getTelemetryUserProfile() {
  const directUsername = String(connectedUserSession?.username || "").trim();
  const directName = String(connectedUserSession?.name || "").trim();
  const directSurname = String(connectedUserSession?.surname || "").trim();

  if (directUsername) {
    return {
      username: directUsername,
      name: directName,
      surname: directSurname
    };
  }

  const derived = deriveConnectedUserProfile();
  if (derived) {
    return {
      username: derived.username,
      name: derived.name,
      surname: derived.surname
    };
  }

  return {
    username: "",
    name: "",
    surname: ""
  };
}

function setServerStatusBadge(state, message) {
  if (!serverStatusBadge) {
    return;
  }

  isServerConnected = state === "connected";
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

  if (connectToServerButton) {
    if (state === "connected") {
      connectToServerButton.classList.add("hidden");
    } else {
      connectToServerButton.classList.remove("hidden");
    }
  }

  refreshUserInfoPanel();
}

function parseNamePartsFromUsername(username) {
  const parts = String(username || "")
    .trim()
    .split(/[._\-\s]+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      name: "Unknown",
      surname: "User"
    };
  }

  return {
    name: parts[0],
    surname: parts.length > 1 ? parts.slice(1).join(" ") : "User"
  };
}

function deriveConnectedUserProfile() {
  const localFolder = localSourceInput?.value?.trim() || "";
  const username = extractLocalUser(localFolder);

  if (!username || username === "Unknown") {
    return null;
  }

  const { name, surname } = parseNamePartsFromUsername(username);
  return {
    username,
    name,
    surname
  };
}

function persistConnectedUserSession(session) {
  connectedUserSession = session;

  try {
    if (!session) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.error(`Failed to persist user session: ${String(error)}`);
  }
}

function loadPersistedConnectedUserSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      connectedUserSession = null;
      return;
    }

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "number" && parsed.username) {
      connectedUserSession = parsed;
      return;
    }
  } catch (error) {
    console.error(`Failed to load persisted user session: ${String(error)}`);
  }

  connectedUserSession = null;
}

async function initializeSqliteBackend() {
  try {
    await invoke("init_sqlite_backend");
  } catch (error) {
    console.error(`Failed to initialize SQLite backend: ${String(error)}`);
  }
}

async function ensureConnectedUserSession(options = {}) {
  const { clearOnDisconnect = true } = options;

  if (!isServerConnected) {
    if (clearOnDisconnect) {
      persistConnectedUserSession(null);
    }
    return;
  }

  const profile = deriveConnectedUserProfile();
  if (!profile) {
    return;
  }

  if (connectedUserSession?.username === profile.username && connectedUserSession?.id) {
    return;
  }

  try {
    const user = await invoke("ensure_connected_user", {
      username: profile.username,
      name: profile.name,
      surname: profile.surname,
      lastEditedById: connectedUserSession?.id || null
    });

    if (user?.id) {
      persistConnectedUserSession(user);
    }
  } catch (error) {
    console.error(`Failed to persist connected user: ${String(error)}`);
  }
}

function getConnectedUserSession() {
  return connectedUserSession;
}

function setSyncButtonLabel(text) {
  if (!syncButton) {
    return;
  }

  syncButton.textContent = text;
}

function applyAutoSyncButtonState() {
  if (!syncButton) {
    return;
  }

  if (autoSyncEnabled) {
    setSyncButtonLabel("Auto Sync");
    syncButton.disabled = true;
    return;
  }

  if (!isSyncInProgress) {
    setSyncButtonLabel("Sync Now");
    syncButton.disabled = false;
  }
}

function setAutoSyncEnabled(nextValue) {
  autoSyncEnabled = Boolean(nextValue);

  if (autoSyncCheckbox) {
    autoSyncCheckbox.checked = autoSyncEnabled;
  }

  applyAutoSyncButtonState();
  startAutoSyncMonitor();
}

async function refreshSyncButtonState(options = {}) {
  const { force = false } = options;

  if (autoSyncEnabled) {
    applyAutoSyncButtonState();
    return;
  }

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
  if (!autoSyncEnabled) {
    return;
  }

  if (isSyncInProgress || isAutoSyncMonitorRunning) {
    return;
  }

  isAutoSyncMonitorRunning = true;

  try {
    await refreshServerStatus();
    applyAutoSyncButtonState();

    if (!isServerConnected) {
      setSyncItemsStatus("Auto Sync is on. Waiting for server connection.");
      return;
    }

    const now = Date.now();
    const shouldRefreshItems = syncItems.length === 0 || now - lastBackgroundItemsRefreshAt >= AUTO_SYNC_ITEMS_REFRESH_MS;

    if (shouldRefreshItems) {
      await loadSyncItems({
        silent: true,
        skipButtonRefresh: true
      });
      lastBackgroundItemsRefreshAt = now;
    }

    const pendingInfo = await invoke("sync_pending_changes_count");
    const pendingCount = Number(pendingInfo?.pending_count || 0);

    if (pendingCount > 0) {
      setSyncItemsStatus(`Auto Sync detected ${pendingCount} pending change(s). Starting sync...`);
      void syncNow();
      return;
    }

    if (syncItems.length > 0) {
      syncItems = syncItems.map((item) => ({ ...item, status: "done" }));
      renderSyncItems();
      const displayItems = getDisplaySyncItems();
      setSyncItemsStatus(`Auto Sync is on. All ${displayItems.length} folders/files are up to date.`);
    }
  } finally {
    isAutoSyncMonitorRunning = false;
  }
}

function startAutoSyncMonitor() {
  stopAutoSyncMonitor();

  if (!autoSyncEnabled) {
    return;
  }

  autoSyncMonitorTimer = window.setInterval(() => {
    void runAutoSyncMonitorTick();
  }, AUTO_SYNC_MONITOR_MS);
  void runAutoSyncMonitorTick();
}

async function refreshServerStatus() {
  setServerStatusBadge("unknown", "Checking...");
  currentServerMountPoint = "";

  try {
    const result = await invoke("get_server_connection_status");
    currentServerMountPoint = result?.mount_point || "";
    if (result?.connected) {
      setServerStatusBadge("connected", "Connected");
      await ensureConnectedUserSession({ clearOnDisconnect: false });
    } else {
      setServerStatusBadge("disconnected", "Not connected");
      persistConnectedUserSession(null);
    }
  } catch (_error) {
    currentServerMountPoint = "";
    setServerStatusBadge("unknown", "Unknown");
    persistConnectedUserSession(null);
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

function isProcessedSyncItem(itemPath, isDir) {
  for (const processedPath of syncProgressPaths) {
    if (processedPath === itemPath) {
      return true;
    }

    if (isDir && processedPath.startsWith(`${itemPath}/`)) {
      return true;
    }
  }

  return false;
}

function updateLiveSyncStatuses(currentPath) {
  const normalizedCurrentPath = normalizePath(currentPath || "");

  syncItems = syncItems.map((item) => {
    const itemPath = normalizePath(item.path);
    const currentMatches =
      normalizedCurrentPath &&
      (normalizedCurrentPath === itemPath || (item.is_dir && normalizedCurrentPath.startsWith(`${itemPath}/`)));

    if (isProcessedSyncItem(itemPath, item.is_dir)) {
      return { ...item, status: "done" };
    }

    if (currentMatches) {
      return { ...item, status: "in-progress" };
    }

    return { ...item, status: "pending" };
  });

  renderSyncItems();
}

function pushSyncProgressLine(line) {
  if (!line) {
    return;
  }

  syncProgressLines.push(line);
  if (syncProgressLines.length > 8) {
    syncProgressLines = syncProgressLines.slice(-8);
  }

  setCommandText(`Sync in progress...\n\n${syncProgressLines.join("\n")}`);
}

function handleSyncProgress(payload) {
  if (!isSyncInProgress) {
    return;
  }

  stopProgressTicker();

  if (payload?.path) {
    syncProgressPaths.add(normalizePath(payload.path));
  }

  updateLiveSyncStatuses(payload?.path || "");
  pushSyncProgressLine(payload?.line || "");

  const processedCount = Number(payload?.processedCount || syncProgressPaths.size || 0);
  const totalCount = Math.max(
    Number(payload?.totalCount || 0),
    syncProgressTotalCount,
    syncItems.length,
    processedCount,
    1
  );
  const percentage = Math.min(100, Math.round((processedCount / totalCount) * 100));

  setSyncItemsStatus(`Sync in progress... ${percentage}% (${processedCount}/${totalCount})`);
}

async function handleSyncComplete(payload) {
  if (!isSyncInProgress) {
    return;
  }

  const result = {
    ok: Boolean(payload?.ok),
    code: Number(payload?.code ?? -1),
    stdout: payload?.stdout || "",
    stderr: payload?.stderr || ""
  };

  stopProgressTicker();

  if (result.ok) {
    showCommandResult("Sync", result);
    await finalizeSyncStatuses(result.stdout);
    await refreshLog();
    void sendTelemetryEvent("sync_completed", {
      code: result.code,
      total_items: syncItems.length
    });
  } else {
    showCommandResult("Sync", result);
    setSyncItemsStatus(`Sync failed: ${result.stderr || "Unknown error"}`, true);
    void sendTelemetryEvent("sync_failed", {
      code: result.code,
      reason: result.stderr || "Unknown error"
    });
  }

  syncItems = syncItems.map((item) => (item.status === "done" ? item : { ...item, status: "pending" }));
  renderSyncItems();
  isSyncInProgress = false;
  syncProgressTotalCount = 0;
  syncProgressPaths = new Set();
  syncProgressLines = [];
  setSyncButtonLabel("Sync done");
  syncDoneTimer = window.setTimeout(() => {
    syncDoneTimer = null;
    setSyncButtonLabel("Sync Now");
    syncButton.disabled = false;
  }, 1400);
  await refreshServerStatus();
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

async function recordSyncedItemsToDatabase() {
  if (!connectedUserSession?.id) {
    console.warn("No connected user session; skipping upload item recording");
    return;
  }

  const doneItems = syncItems.filter((item) => item.status === "done");
  if (doneItems.length === 0) {
    return;
  }

  try {
    await invoke("record_synced_items", {
      items: doneItems,
      lastEditedById: connectedUserSession.id
    });
    console.log(`Recorded ${doneItems.length} synced item(s) in database`);
  } catch (error) {
    console.error(`Failed to record synced items: ${String(error)}`);
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
      await recordSyncedItemsToDatabase();
      return;
    }
  } catch (_error) {
    // Fallback to stdout parsing if pending count check fails.
  }

  applySyncResultStatuses(stdout);
  await recordSyncedItemsToDatabase();
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

async function syncNow() {
  if (!syncButton) {
    return;
  }

  if (isSyncInProgress) {
    return;
  }

  if (syncDoneTimer) {
    window.clearTimeout(syncDoneTimer);
    syncDoneTimer = null;
  }

  isSyncInProgress = true;
  syncButton.disabled = true;
  syncProgressTotalCount = 0;
  syncProgressPaths = new Set();
  syncProgressLines = [];
  setSyncButtonLabel("Sync in progress");
  setCommandText("Starting sync...");
  setSyncItemsStatus("Sync in progress...");
  startProgressTicker();

  try {
    const session = connectedUserSession;
    const fullName = session
      ? [session.name, session.surname].filter(Boolean).join(" ")
      : "";
    const userName = session
      ? (fullName && fullName !== session.username
          ? `${fullName} (${session.username})`
          : session.username) || null
      : null;

    const response = await invoke("start_sync", { userName });
    void sendTelemetryEvent("sync_started", {
      auto_sync: autoSyncEnabled,
      initiated_by: userName || "unknown"
    });
    syncProgressTotalCount = Number(response?.totalCount || 0);
    const totalCount = Math.max(syncProgressTotalCount, syncItems.length, 0);
    if (totalCount > 0) {
      setSyncItemsStatus(`Sync in progress... 0% (0/${totalCount})`);
    }
  } catch (error) {
    stopProgressTicker();
    isSyncInProgress = false;
    syncProgressTotalCount = 0;
    syncProgressPaths = new Set();
    syncProgressLines = [];
    setSyncButtonLabel("Sync Now");
    syncButton.disabled = false;
    showError("Sync", error);
    setSyncItemsStatus(`Sync failed: ${String(error)}`, true);
    void sendTelemetryEvent("sync_failed", {
      code: -1,
      reason: String(error)
    });
  }
}

async function refreshLog() {
  if (!isAdminUnlocked) {
    logOutput.textContent = "Locked. Enter admin code to view logs.";
    if (logOutputAllUsers) {
      logOutputAllUsers.textContent = "Locked. Enter admin code to view logs.";
    }
    return;
  }
  try {
    const result = await invoke("read_sync_log", {
      maxLines: 180,
      adminCode
    });
    logOutput.textContent = result || "Log file is empty.";
  } catch (error) {
    logOutput.textContent = `Unable to read log:\n${String(error)}`;
  }

  if (logOutputAllUsers) {
    try {
      const allResult = await invoke("read_all_users_sync_log", {
        maxLines: 300,
        adminCode
      });
      logOutputAllUsers.textContent = allResult || "Shared log is empty.";
    } catch (error) {
      logOutputAllUsers.textContent = `Unable to read shared log:\n${String(error)}`;
    }
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
    if (smbUrlInput) {
      smbUrlInput.value = settings.smb_url || "";
    }
    if (mountNameInput) {
      mountNameInput.value = settings.mount_name || "";
    }

    // Prefer the DB value for auto_sync so toggling the checkbox persists
    // immediately without requiring "Save Settings".
    let autoSync = Boolean(settings.auto_sync);
    try {
      const dbValue = await invoke("get_app_setting", { key: "auto_sync" });
      if (dbValue !== null && dbValue !== undefined) {
        autoSync = dbValue === "true";
      }
    } catch (_) {
      // DB not ready yet — fall back to .local.env value
    }

    setAutoSyncEnabled(autoSync);
    setSettingsStatus("Settings loaded.");
    refreshUserInfoPanel();
    await ensureConnectedUserSession({ clearOnDisconnect: false });
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
    const smbUrl = smbUrlInput?.value?.trim() || "";
    const mountName = mountNameInput?.value?.trim() || "";
    const autoSync = Boolean(autoSyncCheckbox?.checked);

    const message = await invoke("save_settings", {
      localSource,
      destSubpath,
      smbUrl,
      mountName,
      autoSync
    });

    setAutoSyncEnabled(autoSync);
    setSettingsStatus(message || "Settings saved.");
    refreshUserInfoPanel();
    persistConnectedUserSession(null);
    await ensureConnectedUserSession({ clearOnDisconnect: false });
    await loadSyncItems({ skipButtonRefresh: true });
    applyAutoSyncButtonState();
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

  connectToServerButton?.addEventListener("click", async () => {
    connectToServerButton.disabled = true;
    connectToServerButton.textContent = "Connecting...";
    try {
      await invoke("mount_smb_share");
    } catch (_error) {
      // mount dialog may still open even on error; ignore
    }
    // Re-check status after a short delay to let the OS mount
    window.setTimeout(async () => {
      await refreshServerStatus();
      connectToServerButton.disabled = false;
      connectToServerButton.textContent = "Connect to Server";
    }, 3000);
  });

  sidebarToggleButton?.addEventListener("click", toggleSidebar);
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
  startTourButton?.addEventListener("click", startTour);
  autoSyncCheckbox?.addEventListener("change", () => {
    const checked = autoSyncCheckbox.checked;
    setAutoSyncEnabled(checked);
    invoke("set_app_setting", { key: "auto_sync", value: checked ? "true" : "false" }).catch(
      (err) => console.error("Failed to save auto_sync setting:", err)
    );
  });
  adminUnlockButton?.addEventListener("click", unlockAdmin);
  modalUnlockButton?.addEventListener("click", () => {
    void unlockAdminFromMenu();
  });
  modalCancelButton?.addEventListener("click", closeAdminUnlockModal);
  tourNextButton?.addEventListener("click", () => {
    void advanceTour();
  });
  tourSkipButton?.addEventListener("click", () => {
    skipTourUi();
    void markTourCompleted();
  });
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
    if (action === "start-tour") {
      startTour();
      return;
    }

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

  void listen(SYNC_PROGRESS_EVENT, (event) => {
    handleSyncProgress(event?.payload);
  }).catch((error) => {
    console.error("Failed to register sync progress listener", error);
  });

  void listen(SYNC_COMPLETE_EVENT, (event) => {
    void handleSyncComplete(event?.payload);
  }).catch((error) => {
    console.error("Failed to register sync completion listener", error);
  });

  loadSidebarState();
  loadPersistedConnectedUserSession();
  initializeSqliteBackend();
  const settingsLoadPromise = loadSettings();
  void Promise.allSettled([loadAppVersion(), settingsLoadPromise]).then(() => initializeTelemetry());
  loadSyncItems({ skipButtonRefresh: true });
  loadIgnoreEntries();
  refreshServerStatus();
  applyAutoSyncButtonState();
  refreshUserInfoPanel();
  switchMainTab("home");
  startAutoSyncMonitor();
  void maybeStartFirstRunTour();
}
