// Print document for README to PDF.
//
// Phase 2: this extension page receives a README payload (written to
// chrome.storage by the popup), sanitizes the imported HTML, renders it, and
// invokes the browser's native print dialog from this page's own context.
//
// A service worker cannot call window.print(), so printing must happen here.

(function () {
  "use strict";

  const EXPORT_KEY = "readme-to-pdf:export";
  const MAX_IMAGE_WAIT_MS = 5000;

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
  // Rendering
  // ---------------------------------------------------------------------------

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

  function buildFilename(repo) {
    const nwo = repo && repo.nwo ? repo.nwo : "github-readme";
    const safe = nwo
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `${safe || "github-readme"}-readme`;
  }

  function renderHeader(payload) {
    const header = document.getElementById("doc-header");
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

  function hardenImages() {
    document.querySelectorAll("#content img").forEach((img) => {
      img.loading = "eager";
      img.decoding = "async";
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
    const repo = payload.repo || {};
    document.title = buildFilename(repo);
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

    try {
      render(payload);
    } catch {
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
