// Popup logic for README to PDF.
// Phase 0: wire up the UI and show placeholder status messages only.

const exportButton = document.getElementById("export-button");
const statusEl = document.getElementById("status");

const STATUS_CLASSES = ["status--success", "status--error"];

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

/**
 * Ask the active tab for its URL so we can give useful context.
 * Resolves to null when the URL is unavailable.
 * @returns {Promise<string | null>}
 */
async function getActiveTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab?.url ?? null;
  } catch {
    return null;
  }
}

async function handleExportClick() {
  exportButton.disabled = true;
  setStatus("Checking the current page...");

  const url = await getActiveTabUrl();
  const isGitHubRepo = typeof url === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url);

  if (!isGitHubRepo) {
    setStatus("Open a GitHub repository page, then try again.", "error");
    exportButton.disabled = false;
    return;
  }

  // PDF generation is implemented in a later phase.
  setStatus("PDF export is coming soon in the next phase.", "success");
  exportButton.disabled = false;
}

exportButton.addEventListener("click", handleExportClick);
