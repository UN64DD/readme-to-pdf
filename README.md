# README to PDF

A lightweight Chrome extension (Manifest V3) that lets you export a GitHub
repository's rendered README as a clean, printable PDF.

Built with plain HTML, CSS, and vanilla JavaScript. No frameworks, no build
step, no backend, and no paid APIs.

## Features

Phase 2 (current):

- Detect GitHub repository pages using authoritative `meta` tags, with a URL
  fallback.
- Locate the rendered README through layered, GitHub-specific selectors, with an
  embedded React JSON fallback.
- Extract only the README content (not navigation, sidebars, or file listings)
  and report stats such as word, heading, and image counts.
- Sanitize the imported HTML before it enters the print document.
- Render the README in a dedicated print page and open the browser's native
  print dialog, where **Save as PDF** produces the file.
- Print styles for typography, code blocks, tables, images, and page breaks.
- Sensible default filename such as `owner-repository-readme.pdf`.

Planned:

- Optional theme/styling settings and batch export.

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
├── print/
│   ├── print.html         # Print document (extension page)
│   └── print.js           # Sanitize, render, and call window.print()
└── styles/
    └── print.css          # Print document + print media styles
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
4. A print preview opens in a new tab. In the dialog, choose **Save as PDF** as
   the destination and save the file.

The extension uses the browser's native print dialog, so the PDF is produced by
Chrome (not silently by the extension) and the filename defaults to
`owner-repository-readme.pdf`.

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

## How export works

1. The popup asks the content script for the README payload (Phase 1).
2. The popup writes the payload to `chrome.storage.local` and opens the
   extension's print page in a new tab.
3. The print page reads the payload, sanitizes the HTML, and renders only the
   README.
4. It waits (briefly) for images, then calls `window.print()` from its own
   page context, opening the print dialog. A service worker cannot call
   `window.print()`, which is why a dedicated page is used.

## HTML sanitization

The print document never trusts the README HTML:

- Only an allowlist of content tags is kept; unknown tags are unwrapped and
  dangerous tags (`script`, `style`, `iframe`, `object`, `embed`, …) are removed
  with their contents.
- Event handler attributes (`on*`), `style`, `class`, and `id` are stripped.
- Only `href`/`src` values with `http`, `https`, `mailto`, `tel`, or fragment
  protocols are kept; `javascript:`, `data:`, and similar are dropped.
- No inline scripts or `eval` are used anywhere; the extension follows the
  Manifest V3 content security policy.

## Development roadmap

- **Phase 0 — Setup:** project structure, manifest, popup UI, placeholder logic.
- **Phase 1 — Detection & extraction:** identify repo pages and the rendered
  README.
- **Phase 2 — Export via native print:** sanitize, render a print document, and
  produce a PDF through the browser's print dialog (current).
- **Phase 3 — Polish:** theme settings, batch export, and further edge cases.

## Testing Phase 2

1. **Print preview opens:** on a repository with a README, click
   **Export README to PDF** → a new tab shows the README and the print dialog
   opens.
2. **Save as PDF is readable:** choose **Save as PDF**; the resulting file shows
   the README with headings, lists, links, tables, and code blocks.
3. **Multiple pages:** export a long README (`https://github.com/torvalds/linux`)
   → formatting survives page breaks.
4. **Code blocks and tables:** confirm code wraps/prints cleanly and tables fit
   the page width.
5. **Images:** wide images scale to the page; broken images show an
   `[Image: alt]` placeholder instead of breaking the export.
6. **Failed extraction:** try on a non-repo or no-README page → the popup shows
   an error and no print tab opens.
7. **Original page intact:** the GitHub tab is unchanged and still usable.
8. **No script execution:** a README containing raw HTML/scripts cannot execute
   code in the print document.

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
   (expect the print preview tab) and on a non-repo page (expect the guidance
   error message).

## Permissions

- `activeTab` — read the active tab's URL to confirm you are on GitHub.
- `storage` — pass the README payload from the popup to the print document.
- Content script match on `https://github.com/*` — runs the content script on
  GitHub so the popup can request README detection.

## License

No license specified yet.
