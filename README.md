# README to PDF

A lightweight Chrome extension (Manifest V3) that lets you export a GitHub
repository's rendered README as a clean, printable PDF.

Built with plain HTML, CSS, and vanilla JavaScript. No frameworks, no build
step, no backend, and no paid APIs.

## Features

Phase 0 (current):

- Popup UI with an **Export README to PDF** button and a status area.
- Context-aware messaging based on the active tab.
- Manifest V3 configuration with minimal permissions.
- Content script placeholder wired up for GitHub repository pages.

Planned:

- Extract the rendered README from the active GitHub page.
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
│   └── content.js         # Content script (GitHub pages)
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
   `https://github.com/user/repo`.
2. Click the **README to PDF** icon in the toolbar.
3. Click **Export README to PDF**.

In Phase 0 the button validates that you are on a GitHub repository and shows a
placeholder message. PDF export is added in a later phase.

## Development roadmap

- **Phase 0 — Setup:** project structure, manifest, popup UI, placeholder logic.
- **Phase 1 — README detection:** detect the README element on the active page
  and report availability in the popup.
- **Phase 2 — Extraction & styling:** clone and clean the README content and
  apply print styles from `styles/print.css`.
- **Phase 3 — PDF generation:** render the cleaned content to a downloadable
  PDF.
- **Phase 4 — Polish:** error handling, edge cases, and UX improvements.

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

- `activeTab` — read the active tab's URL to confirm you are on a GitHub
  repository page.
- Content script match on `https://github.com/*/*` — runs the (placeholder)
  content script on repository pages.

## License

No license specified yet.
