// Content script for README to PDF.
//
// Phase 1: detect GitHub repository pages and identify the rendered README.
// No PDF generation happens here. This script responds to messages from the
// popup and never sends the full page HTML back.
//
// Everything that depends on GitHub's page structure lives in the GITHUB config
// below so it can be updated in one place if GitHub changes its DOM.

(function () {
  "use strict";

  // Must match the constant in popup/popup.js.
  const MESSAGE_GET_README = "readme-to-pdf:get-readme";

  // ---------------------------------------------------------------------------
  // GitHub-specific configuration (update here if the DOM changes).
  // ---------------------------------------------------------------------------
  const GITHUB = {
    // Authoritative repository markers that GitHub renders into <meta> tags.
    repoNwoMeta: 'meta[name="octolytics-dimension-repository_nwo"]',
    repoSubjectMeta: 'meta[name="hovercard-subject-tag"]',

    // Ordered from most to least specific. The first usable match wins.
    readmeSelectors: [
      "#readme article.markdown-body",
      "#readme .markdown-body",
      '[data-testid="readme"] .markdown-body',
      "article.markdown-body.entry-content",
      ".markdown-body.entry-content",
    ],

    // GitHub now embeds the rendered README as JSON for its React app.
    embeddedDataSelectors: [
      'script[type="application/json"][data-target="react-app.embeddedData"]',
    ],

    // Decorative/UI nodes that GitHub injects and that are not README content.
    stripSelectors: [
      "a.anchor",
      "svg.octicon",
      ".octicon",
      "clipboard-copy",
      ".clipboard-copy",
      "button",
      ".sr-only",
      '[aria-hidden="true"]',
    ],
  };

  // Owners that are GitHub features rather than real accounts. Only used by the
  // URL fallback when the meta tags are unavailable.
  const RESERVED_OWNERS = new Set([
    "about", "account", "apps", "codespaces", "collections", "contact",
    "dashboard", "discussions", "enterprise", "events", "explore", "features",
    "issues", "join", "login", "logout", "marketplace", "new", "notifications",
    "organizations", "orgs", "pricing", "pulls", "search", "security",
    "settings", "site", "sponsors", "stars", "topics", "trending", "users",
  ]);

  // ---------------------------------------------------------------------------
  // Page / repository detection
  // ---------------------------------------------------------------------------

  function isGitHubHost() {
    return location.hostname === "github.com";
  }

  function getRepoFromUrl() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
    if (repo.endsWith(".git")) return null;
    return { owner, repo, nwo: `${owner}/${repo}`, source: "url" };
  }

  function getRepoFromMeta() {
    const meta = document.querySelector(GITHUB.repoNwoMeta);
    const nwo = meta && meta.getAttribute("content");
    if (nwo && /^[^/]+\/[^/]+$/.test(nwo.trim())) {
      const [owner, repo] = nwo.trim().split("/");
      return { owner, repo, nwo: `${owner}/${repo}`, source: "meta" };
    }
    const subject = document.querySelector(GITHUB.repoSubjectMeta);
    const content = subject && subject.getAttribute("content");
    if (content && content.startsWith("repository:")) {
      return getRepoFromUrl();
    }
    return null;
  }

  function getRepoInfo() {
    if (!isGitHubHost()) return null;
    return getRepoFromMeta() || getRepoFromUrl();
  }

  // README content only renders on the "overview" views (repo root and tree
  // views), not on blob/issue/settings pages. Used to avoid mistaking any
  // rendered markdown file for the README.
  function isOverviewUrl() {
    const parts = location.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length < 2) return false;
    if (parts.length === 2) return true; // /owner/repo
    return parts[2] === "tree"; // /owner/repo/tree/<branch>/...
  }

  // ---------------------------------------------------------------------------
  // README location
  // ---------------------------------------------------------------------------

  function isVisible(el) {
    if (!el || el.hidden) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  }

  function looksLikeReadme(el) {
    if (!el || !isVisible(el)) return false;
    const hasText = (el.textContent || "").trim().length > 0;
    const hasMedia = el.querySelector("img, table, pre, video") !== null;
    return hasText || hasMedia;
  }

  function findReadmeElement() {
    // The generic selectors are only safe on overview pages; otherwise they
    // could match a rendered markdown file on a blob page.
    const genericAllowed = isOverviewUrl();
    for (const selector of GITHUB.readmeSelectors) {
      const isGeneric =
        selector === "article.markdown-body.entry-content" ||
        selector === ".markdown-body.entry-content";
      if (isGeneric && !genericAllowed) continue;
      let candidates;
      try {
        candidates = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of candidates) {
        if (looksLikeReadme(el)) return el;
      }
    }
    return null;
  }

  // Depth-first search for the first value of `key` in a nested structure.
  function findKey(root, key) {
    const seen = new Set();
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      if (!Array.isArray(current) && Object.prototype.hasOwnProperty.call(current, key)) {
        return current[key];
      }
      const values = Array.isArray(current) ? current : Object.values(current);
      for (const value of values) stack.push(value);
    }
    return undefined;
  }

  function readEmbeddedMeta() {
    for (const selector of GITHUB.embeddedDataSelectors) {
      const script = document.querySelector(selector);
      if (!script) continue;
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      const files = findKey(data, "overviewFiles");
      const recommend = findKey(data, "shouldRecommendReadme");
      if (!Array.isArray(files) && recommend === undefined) continue;
      let readme = null;
      if (Array.isArray(files)) {
        readme =
          files.find(
            (file) =>
              file &&
              (file.preferredFileType === "readme" ||
                /readme/i.test(file.displayName || ""))
          ) || null;
      }
      return {
        hasOverviewFiles: Array.isArray(files),
        shouldRecommendReadme: recommend === true,
        readme,
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // README representation (only the README is extracted, never the whole page)
  // ---------------------------------------------------------------------------

  function absolutize(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || /^[a-z]+:|^\/\//i.test(href)) return;
      try {
        a.setAttribute("href", new URL(href, document.baseURI).href);
      } catch {
        /* ignore malformed URLs */
      }
    });
    root.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (!src || /^[a-z]+:|^\/\//i.test(src)) return;
      try {
        img.setAttribute("src", new URL(src, document.baseURI).href);
      } catch {
        /* ignore malformed URLs */
      }
    });
  }

  function countWords(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function describeReadme(element, info = {}) {
    const clone = element.cloneNode(true);
    for (const selector of GITHUB.stripSelectors) {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    }
    absolutize(clone);
    const text = (clone.innerText || clone.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      name: info.name || "README",
      path: info.path || null,
      source: info.source || "dom",
      html: clone.innerHTML,
      text,
      stats: {
        words: countWords(text),
        headings: clone.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
        links: clone.querySelectorAll("a[href]").length,
        images: clone.querySelectorAll("img").length,
        codeBlocks: clone.querySelectorAll("pre").length,
        tables: clone.querySelectorAll("table").length,
      },
    };
  }

  function buildReadmeFromEmbedded(readme) {
    const container = document.createElement("div");
    container.innerHTML = readme.richText || "";
    const article =
      container.querySelector("article.markdown-body, article, .markdown-body") ||
      container;
    return describeReadme(article, {
      name: readme.displayName || readme.path || "README",
      path: readme.path || null,
      source: "embedded-json",
    });
  }

  // ---------------------------------------------------------------------------
  // Main inspection entry point
  // ---------------------------------------------------------------------------

  function errorResult(reason, message, repo) {
    return { ok: false, reason, message, repo: repo || null };
  }

  function inspectPage() {
    if (!isGitHubHost()) {
      return errorResult("not-github", "This is not a GitHub page.");
    }

    const repo = getRepoInfo();
    if (!repo) {
      return errorResult("not-repo", "This GitHub page is not a repository.");
    }

    // Recomputed on every request, so client-side navigation (GitHub's Turbo /
    // pjax transitions) is handled without caching or re-injection.
    const embedded = readEmbeddedMeta();

    const domElement = findReadmeElement();
    if (domElement) {
      return {
        ok: true,
        repo,
        readme: describeReadme(domElement, {
          name: embedded && embedded.readme && embedded.readme.displayName,
          path: embedded && embedded.readme && embedded.readme.path,
          source: "dom",
        }),
      };
    }

    if (embedded && embedded.readme && embedded.readme.richText) {
      return { ok: true, repo, readme: buildReadmeFromEmbedded(embedded.readme) };
    }

    if (embedded && (embedded.shouldRecommendReadme || embedded.hasOverviewFiles)) {
      return errorResult("no-readme", "This repository does not have a README.", repo);
    }

    return errorResult(
      "readme-not-found",
      "Couldn't locate the rendered README. GitHub's layout may have changed.",
      repo
    );
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_GET_README) return false;
    try {
      sendResponse(inspectPage());
    } catch (error) {
      sendResponse(
        errorResult(
          "error",
          "Failed to read the page.",
          null
        )
      );
    }
    return false; // response is sent synchronously
  });
})();
