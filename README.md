# README to PDF

A lightweight Chrome extension (Manifest V3) that lets you export a GitHub
repository's rendered README as a clean, printable PDF.

Built with plain HTML, CSS, and vanilla JavaScript. No frameworks, no build
step, no backend, and no paid APIs.

## Features

Phase 1 (current):

- Detect GitHub repository pages using authoritative `meta` tags, with a URL
  fallback.
- Locate the rendered README through layered, GitHub-specific selectors.
- Fall back to GitHub's embedded React JSON when the README element is not yet
  hydrated.
- Extract only the README content (not navigation, sidebars, or file listings)
  and report stats such as word, heading, and image counts.
- Popup ↔ content script messaging using `chrome.tabs.sendMessage` /
  `chrome.runtime.onMessage`.
- Graceful, descriptive errors for every unsupported case.

Planned:

- Generate a clean, print-ready PDF with sensible typography.

## Project structure

```
readme-to-pdf/
├── manifest.json          # Manifest V3 configuration
├── README.md              # This file
├── popup/
│   ├── popup.html         # Popup markup
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic
├── scripts/
│   └── content.js         # Repo detection + README extraction (content script)
└── styles/
    └── print.css          # Reserved for print/PDF styling
```

## Installation (Load unpacked)

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the `readme-to-pdf` project folder (the one containing
   `manifest.json`).
5. The extension appears in the list. Pin it to the toolbar for quick access.

To apply changes after editing files, click the **reload** icon on the
extension card in `chrome://extensions`.

## Usage

1. Open any GitHub repository page, for example
   `https://github.com/user/repo` or
   `https://github.com/user/repo/tree/main`.
2. Click the **README to PDF** icon in the toolbar. The popup reports whether a
   README was detected.
3. Click **Export README to PDF**.

In Phase 1 the button confirms detection and shows a placeholder message. PDF
export is added in a later phase.

## How detection works

1. **Repository check:** GitHub writes `octolytics-dimension-repository_nwo` into
   a `<meta>` tag on repository pages. If that is missing, the URL is parsed as a
   fallback, ignoring GitHub's own reserved paths (`settings`, `marketplace`,
   etc.).
2. **README lookup:** an ordered list of selectors is tried, from most to least
   specific. Generic selectors only run on overview pages (repo root and `tree`
   views) so a rendered markdown file on a `blob` page is never mistaken for the
   README.
3. **Embedded fallback:** GitHub's React app embeds the rendered README as JSON.
   When the live element is not ready, that HTML is used instead.
4. **Extraction:** only the README element is cloned and cleaned. The popup
   receives a compact representation (cleaned HTML, plain text, and stats), never
   the full page HTML.
5. **Graceful failure:** if the DOM changes, the extension reports that it could
   not find the README instead of exporting the wrong content.

## Development roadmap

- **Phase 0 — Setup:** project structure, manifest, popup UI, placeholder logic.
- **Phase 1 — Detection & extraction:** identify repo pages and the rendered
  README (current).
- **Phase 2 — Styling:** apply print styles from `styles/print.css` to the
  extracted README.
- **Phase 3 — PDF generation:** render the cleaned content to a downloadable
  PDF.
- **Phase 4 — Polish:** error handling, edge cases, and UX improvements.

## Testing Phase 1

Manual checks (see also the Phase 0 checks):

1. **README with headings, lists, links, code blocks:**
   `https://github.com/sindresorhus/github-markdown-css` → status shows the
   README path and stats.
2. **Tables and images:** any README with tables/badges → image and table counts
   appear in the status.
3. **Long README:** `https://github.com/torvalds/linux` → large word count is
   reported without freezing the popup.
4. **No README:** a repository without a README → "This repository does not have
   a README."
5. **Non-repository GitHub page:** `https://github.com/settings/profile` or a
   topic page → "This GitHub page is not a repository."
6. **Non-GitHub page:** any other site → "Open a GitHub repository page..."
7. **Dynamic navigation:** navigate between repositories using GitHub's
   client-side links, then reopen the popup → the status reflects the new repo.

## Testing Phase 0

Manual checks:

1. **Manifest validity:** load the extension via
   `chrome://extensions` → **Load unpacked**. It should load without errors.
2. **File references:** confirm `popup/popup.html`, `popup/popup.css`,
   `popup/popup.js`, and `scripts/content.js` all exist at the paths referenced
   by `manifest.json`.
3. **Popup errors:** open the popup and check DevTools (right-click the popup →
   **Inspect**) for a clean console.
4. **Button responds:** click **Export README to PDF** on a GitHub repo page
   (expect the placeholder message) and on a non-repo page (expect the guidance
   error message).

## Permissions

- `activeTab` — read the active tab's URL to confirm you are on GitHub.
- Content script match on `https://github.com/*` — runs the content script on
  GitHub so the popup can request README detection.

## License

No license specified yet.
