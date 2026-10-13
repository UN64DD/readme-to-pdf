// Popup logic for README to PDF.
//
// Phase 2: reuse the Phase 1 detection, stash the README payload in
// chrome.storage, and open the print document, which runs window.print() from
// its own context.

// Must match the constant in scripts/content.js.
const MESSAGE_GET_README = "readme-to-pdf:get-readme";
// Must match the constant in print/print.js.
const EXPORT_KEY = "readme-to-pdf:export";
const PRINT_PAGE = "print/print.html";
const GITHUB_URL_PATTERN = /^https:\/\/github\.com\//;

const exportButton = document.getElementById("export-button");
const statusEl = document.getElementById("status");
const STATUS_CLASSES = ["status--success", "status--error"];

// Guards against overlapping exports triggered by rapid clicks.
let isExporting = false;

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
 * Rejects when no content script is listening (e.g. the page needs reloading).
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
      message: "Open a GitHub repository page to use this extension.",
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

/** Render a detection result in the status area. */
function reportResult(result) {
  if (result.ok && result.readme) {
    const { path, name, stats } = result.readme;
    const label = path || name || "README";
    setStatus(
      `Found ${label} (${stats.words.toLocaleString()} words, ` +
        `${stats.headings} headings, ${stats.images} images).`,
      "success"
    );
    return true;
  }

  switch (result.reason) {
    case "not-github":
      setStatus(result.message, "error");
      break;
    case "not-repo":
      setStatus("This GitHub page is not a repository.", "error");
      break;
    case "no-readme":
      setStatus("This repository does not have a README.", "error");
      break;
    case "readme-not-found":
      setStatus(
        "Couldn't find the rendered README. GitHub's layout may have changed.",
        "error"
      );
      break;
    default:
      setStatus(result.message || "Unable to read the README.", "error");
  }
  return false;
}

async function handleExportClick() {
  if (isExporting) return;
  isExporting = true;
  setBusy(true);
  setStatus("Reading README...");

  try {
    const result = await detectReadme();
    if (!reportResult(result)) return; // an error message is already shown

    const { repo, readme } = result;
    if (!readme.html || !readme.html.trim() || !readme.text.trim()) {
      setStatus("The README appears to be empty.", "error");
      return;
    }

    const tab = await getActiveTab();
    setStatus("Opening print preview...");
    await savePayload({
      repo,
      readme,
      sourceUrl: tab && tab.url ? tab.url : null,
      createdAt: Date.now(),
    });
    await openPrintTab();
    setStatus(
      "Print preview opened. Choose 'Save as PDF' in the dialog.",
      "success"
    );
  } catch {
    setStatus("Couldn't start the export. Please try again.", "error");
  } finally {
    isExporting = false;
    setBusy(false);
  }
}

// Show the current page's status as soon as the popup opens.
async function init() {
  setBusy(true);
  setStatus("Checking this page...");
  const result = await detectReadme();
  setBusy(false);
  reportResult(result);
}

exportButton.addEventListener("click", handleExportClick);
init();
