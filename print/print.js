// Print document for README to PDF.
//
// Phase 3: reads the export payload (written to chrome.storage by the popup),
// applies the chosen paper size/theme settings, sanitizes the imported HTML,
// renders only the README, and invokes the browser's native print dialog from
// this page's own context.
//
// A service worker cannot call window.print(), so printing must happen here.

(function () {
  "use strict";

  const EXPORT_KEY = "readme-to-pdf:export";
  const MAX_IMAGE_WAIT_MS = 5000;

  const DEFAULT_SETTINGS = {
    paperSize: "a4",
    theme: "light",
    includeTitle: true,
  };

  // Content tags allowed in the print document. Everything else is either
  // dropped or unwrapped (see cleanTree).
  const ALLOWED_TAGS = new Set([
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr",
    "ul", "ol", "li", "dl", "dt", "dd",
    "blockquote", "pre", "code",
    "a", "strong", "em", "b", "i", "u", "s", "del", "ins", "mark",
    "small", "sub", "sup", "kbd", "samp", "var", "q", "cite", "abbr",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    "img", "picture", "figure", "figcaption", "div", "span",
    "details", "summary", "input",
  ]);

  // Tags removed entirely, including their contents. These can execute code or
  // load external resources and must never reach the document.
  const DROP_WITH_CONTENT = new Set([
    "script", "style", "iframe", "object", "embed", "link", "meta", "base",
    "form", "noscript", "template", "svg", "math", "canvas", "audio", "video",
    "source",
  ]);

  // Attributes allowed per tag, in addition to GLOBAL_ATTRS.
  const ATTR_ALLOW = {
    a: new Set(["href"]),
    img: new Set(["src", "alt", "width", "height"]),
    input: new Set(["type", "checked", "disabled"]),
    ol: new Set(["start"]),
  };
  const GLOBAL_ATTRS = new Set(["title", "colspan", "rowspan"]);
  const SAFE_ALIGN = new Set(["left", "center", "right", "justify"]);

  // ---------------------------------------------------------------------------
  // Sanitization
  // ---------------------------------------------------------------------------

  function isSafeUrl(raw) {
    if (!raw) return false;
    const value = raw.trim();
    if (value.startsWith("#")) return true;
    let url;
    try {
      url = new URL(value, location.href);
    } catch {
      return false;
    }
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  }

  function sanitizeAttributes(el, tag) {
    const allowed = ATTR_ALLOW[tag] || new Set();
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "class" || name === "id") {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "align") {
        if (SAFE_ALIGN.has(attr.value.toLowerCase())) {
          el.setAttribute("align", attr.value.toLowerCase());
        } else {
          el.removeAttribute(attr.name);
        }
        continue;
      }
      if (!GLOBAL_ATTRS.has(name) && !allowed.has(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src") && !isSafeUrl(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  function unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  function cleanTree(root) {
    for (const node of Array.from(root.childNodes)) {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = node.tagName.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) {
        node.remove();
        continue;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        cleanTree(node);
        unwrap(node);
        continue;
      }
      if (tag === "input") {
        if ((node.getAttribute("type") || "").toLowerCase() !== "checkbox") {
          node.remove();
          continue;
        }
        node.setAttribute("disabled", "");
      }
      sanitizeAttributes(node, tag);
      cleanTree(node);
    }
  }

  /** @param {string} html @returns {DocumentFragment} */
  function sanitizeHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html || "";
    cleanTree(template.content);
    return template.content;
  }

  // ---------------------------------------------------------------------------
  // Settings + filename
  // ---------------------------------------------------------------------------

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

  /** Scrub a filename part down to safe characters for all major OSes. */
  function sanitizeFilenamePart(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[<>\u0022:/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 80)
      .trim();
  }

  function buildFilename(repo, readme) {
    const owner = repo && repo.owner ? sanitizeFilenamePart(repo.owner) : "";
    const name = repo && repo.repo ? sanitizeFilenamePart(repo.repo) : "";
    let base = [owner, name].filter(Boolean).join("-");
    if (!base) {
      base =
        sanitizeFilenamePart(readme && (readme.name || readme.path)) ||
        "github-readme";
    }
    return `${base || "github-readme"}-readme`;
  }

  function safeSourceUrl(raw) {
    if (typeof raw !== "string") return null;
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && url.hostname === "github.com") {
        return url.href;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Apply paper size via @page and switch on the dark theme. */
  function applySettings(settings) {
    const isLetter = settings.paperSize === "letter";
    const paper = isLetter ? "letter" : "A4";
    const margin = isLetter ? "0.6in" : "16mm";

    const style = document.createElement("style");
    style.setAttribute("id", "page-size-rule");
    style.textContent = `@page { size: ${paper}; margin: ${margin}; }`;
    document.head.appendChild(style);

    if (settings.theme === "dark") {
      document.documentElement.classList.add("theme-dark");
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function renderHeader(payload) {
    const header = document.getElementById("doc-header");
    if (!payload.settings.includeTitle) {
      return; // keep the header hidden
    }

    const repo = payload.repo || {};
    const readme = payload.readme || {};

    const title = document.createElement("h1");
    title.className = "page__title";
    title.textContent = repo.nwo || "README";
    header.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "page__meta";
    meta.textContent = readme.path || readme.name || "README";

    const sourceUrl = safeSourceUrl(payload.sourceUrl);
    if (sourceUrl) {
      meta.appendChild(document.createTextNode(" \u00b7 "));
      const link = document.createElement("a");
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = sourceUrl;
      meta.appendChild(link);
    }
    header.appendChild(meta);
    header.hidden = false;
  }

  function renderToolbarInfo(settings) {
    const info = document.getElementById("toolbar-info");
    if (!info) return;
    const paper = settings.paperSize === "letter" ? "Letter" : "A4";
    const theme = settings.theme === "dark" ? "Dark" : "Light";
    info.textContent = `\u00b7 ${paper} \u00b7 ${theme} theme`;
  }

  function hardenImages() {
    document.querySelectorAll("#content img").forEach((img) => {
      img.loading = "eager";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener(
        "error",
        () => {
          const placeholder = document.createElement("span");
          placeholder.className = "readme__img-error";
          const alt = img.getAttribute("alt");
          placeholder.textContent = alt
            ? `[Image: ${alt}]`
            : "[Image unavailable]";
          img.replaceWith(placeholder);
        },
        { once: true }
      );
    });
  }

  function render(payload) {
    document.title = buildFilename(payload.repo, payload.readme);
    renderToolbarInfo(payload.settings);
    renderHeader(payload);

    const content = document.getElementById("content");
    content.appendChild(sanitizeHtml(payload.readme && payload.readme.html));
    hardenImages();
  }

  function showError(message) {
    const errorEl = document.getElementById("error");
    errorEl.textContent = message;
    errorEl.hidden = false;
    document.getElementById("content").hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Image readiness + printing
  // ---------------------------------------------------------------------------

  function waitForImages() {
    const images = Array.from(document.querySelectorAll("#content img"));
    if (images.length === 0) return Promise.resolve();

    return new Promise((resolve) => {
      let remaining = images.length;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, MAX_IMAGE_WAIT_MS);
      const done = () => {
        remaining -= 1;
        if (remaining <= 0) finish();
      };
      for (const img of images) {
        if (img.complete) {
          done();
        } else {
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        }
      }
    });
  }

  function triggerPrint() {
    try {
      window.print();
    } catch {
      showError("Printing isn't available here. Use the Print button above.");
    }
  }

  // ---------------------------------------------------------------------------
  // Storage + boot
  // ---------------------------------------------------------------------------

  function loadPayload() {
    return new Promise((resolve) => {
      chrome.storage.local.get(EXPORT_KEY, (data) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(data && data[EXPORT_KEY] ? data[EXPORT_KEY] : null);
      });
    });
  }

  async function init() {
    document.getElementById("print-button").addEventListener("click", triggerPrint);

    const payload = await loadPayload();
    if (!payload || !payload.readme || !payload.readme.html) {
      showError("Nothing to export. Open the extension popup on a GitHub repository and try again.");
      return;
    }

    // Default settings in the payload so older payloads still render.
    payload.settings = normalizeSettings(payload.settings);
    applySettings(payload.settings);

    try {
      render(payload);
    } catch (error) {
      showError("Something went wrong preparing the document.");
      return;
    }

    await waitForImages();
    // Defer one frame so layout and fonts settle before the dialog opens.
    requestAnimationFrame(() => setTimeout(triggerPrint, 50));
  }

  window.addEventListener("pagehide", () => {
    chrome.storage.local.remove(EXPORT_KEY);
  });

  init();
})();