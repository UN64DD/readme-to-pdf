// Popup logic for README to PDF.
//
// Phase 3: detection (Phase 1) plus export settings. The export flow reuses the
// Phase 2 pipeline: stash a payload in chrome.storage and open the print
// document, which runs window.print() from its own context.

// Must match the constant in scripts/content.js.
const MESSAGE_GET_README = "readme-to-pdf:get-readme";
// Must match the constant in print/print.js.
const EXPORT_KEY = "readme-to-pdf:export";
const PRINT_PAGE = "print/print.html";
const GITHUB_URL_PATTERN = /^https:\/\/github\.com\//;

const SETTINGS_KEY = "readme-to-pdf:settings";
const DEFAULT_SETTINGS = Object.freeze({
  paperSize: "a4",
  theme: "light",
  includeTitle: true,
});

const exportButton = document.getElementById("export-button");
const statusEl = document.getElementById("status");
const paperSelect = document.getElementById("paper-size");
const themeSelect = document.getElementById("theme");
const includeTitleCheckbox = document.getElementById("include-title");
const resetSettingsButton = document.getElementById("reset-settings");

const STATUS_CLASSES = ["status--success", "status--error"];

// Guards against overlapping exports triggered by rapid clicks.
let isExporting = false;
let settings = { ...DEFAULT_SETTINGS };
let settingsReady = false;

/**
 * Update the status area with a message and optional tone.
 * @param {string} message
 * @param {"info" | "success" | "error"} [tone="info"]
 */
function setStatus(message, tone = "info") {
  statusEl.textContent = message;
  statusEl.classList.remove(...STATUS_CLASSES);
  if (tone !== "info") {
    statusEl.classList.add(`status--${tone}`);
  }
}

/** Enable or disable the export button while work is in progress. */
function setBusy(busy) {
  exportButton.disabled = busy;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Sanitize a loaded settings object against the defaults. */
function normalizeSettings(raw) {
  const result = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === "object") {
    if (raw.paperSize === "letter" || raw.paperSize === "a4") {
      result.paperSize = raw.paperSize;
    }
    if (raw.theme === "light" || raw.theme === "dark") {
      result.theme = raw.theme;
    }
    if (typeof raw.includeTitle === "boolean") {
      result.includeTitle = raw.includeTitle;
    }
  }
  return result;
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (data) => {
      if (chrome.runtime.lastError) {
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }
      resolve(normalizeSettings(data && data[SETTINGS_KEY]));
    });
  });
}

function saveSettings(next) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [SETTINGS_KEY]: next }, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

function applySettingsToUI(value) {
  paperSelect.value = value.paperSize;
  themeSelect.value = value.theme;
  includeTitleCheckbox.checked = value.includeTitle;
}

function readSettingsFromUI() {
  return {
    paperSize: paperSelect.value === "letter" ? "letter" : "a4",
    theme: themeSelect.value === "dark" ? "dark" : "light",
    includeTitle: includeTitleCheckbox.checked,
  };
}

async function persistSettingsFromUI() {
  settings = normalizeSettings(readSettingsFromUI());
  settingsReady = true;
  await saveSettings(settings);
}

async function resetSettings() {
  settings = { ...DEFAULT_SETTINGS };
  settingsReady = true;
  applySettingsToUI(settings);
  await saveSettings(settings);
  setStatus("Settings reset to defaults.", "info");
}

// ---------------------------------------------------------------------------
// Tab / messaging helpers
// ---------------------------------------------------------------------------

/** @returns {Promise<chrome.tabs.Tab | null>} */
async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

/** Persist the export payload for the print document to read. */
function savePayload(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [EXPORT_KEY]: payload }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

/** Open the print document in a new tab. */
function openPrintTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: chrome.runtime.getURL(PRINT_PAGE) }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

/**
 * Send a message to the content script in the given tab.
 * @returns {Promise<object>}
 */
function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || null);
    });
  });
}

/**
 * Detect the README in the active tab.
 * @returns {Promise<object>} The content script response, or a synthesized
 *   error result when the popup can't reach a content script.
 */
async function detectReadme() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    return { ok: false, reason: "no-tab", message: "No active tab found." };
  }
  if (!tab.url || !GITHUB_URL_PATTERN.test(tab.url)) {
    return {
      ok: false,
      reason: "not-github",
      message: "This page is not on GitHub.",
    };
  }
  try {
    const response = await sendMessageToTab(tab.id, { type: MESSAGE_GET_README });
    if (!response) {
      return {
        ok: false,
        reason: "no-response",
        message: "No response from the page. Reload the GitHub tab and try again.",
      };
    }
    return response;
  } catch {
    return {
      ok: false,
      reason: "no-content-script",
      message: "Couldn't read the page. Reload the GitHub tab and try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Status reporting
// ---------------------------------------------------------------------------

/**
 * Show a result from the content script. Returns true when a README was found.
 * @param {object} result
 * @returns {boolean}
 */
function reportResult(result) {
  if (result.ok && result.readme) {
    const { path, name, stats } = result.readme;
    const label = path || name || "README";
    setStatus(
      `Found ${label} (${stats.words.toLocaleString()} words, ` +
        `${stats.headings} headings, ${stats.images} images). Ready to export.`,
      "success"
    );
    return true;
  }

  switch (result.reason) {
    case "not-github":
    case "not-repo":
      setStatus(
        "Unsupported page. Open a GitHub repository to export its README.",
        "error"
      );
      break;
    case "no-readme":
      setStatus("This repository doesn't have a README.", "error");
      break;
    case "readme-not-found":
      setStatus(
        "Couldn't find the rendered README. GitHub's layout may have changed.",
        "error"
      );
      break;
    case "no-tab":
      setStatus("No active tab found.", "error");
      break;
    default:
      setStatus(result.message || "Export failed.", "error");
  }
  return false;
}

// ---------------------------------------------------------------------------
// Export flow
// ---------------------------------------------------------------------------

async function handleExportClick() {
  if (isExporting) return;
  isExporting = true;
  setBusy(true);

  try {
    setStatus("Extracting README...");
    const result = await detectReadme();
    if (!reportResult(result)) return; // an error message is already shown

    const { repo, readme } = result;
    if (!readme.html || !readme.html.trim() || !readme.text.trim()) {
      setStatus("The README appears to be empty. Nothing to export.", "error");
      return;
    }

    setStatus("Preparing print document...");
    await persistSettingsFromUI();

    const tab = await getActiveTab();
    await savePayload({
      repo,
      readme,
      settings,
      sourceUrl: tab && tab.url ? tab.url : null,
      createdAt: Date.now(),
    });
    await openPrintTab();

    setStatus(
      "Print preview opened in a new tab. Choose 'Save as PDF' to finish.",
      "success"
    );
  } catch {
    setStatus("Export failed. Please try again.", "error");
  } finally {
    isExporting = false;
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

paperSelect.addEventListener("change", persistSettingsFromUI);
themeSelect.addEventListener("change", persistSettingsFromUI);
includeTitleCheckbox.addEventListener("change", persistSettingsFromUI);
resetSettingsButton.addEventListener("click", resetSettings);
exportButton.addEventListener("click", handleExportClick);

async function init() {
  // Load settings before touching the UI so persisted values are applied.
  settings = await loadSettings();
  settingsReady = true;
  applySettingsToUI(settings);

  setBusy(true);
  setStatus("Checking this page...");
  const result = await detectReadme();
  setBusy(false);
  reportResult(result);
}

init();