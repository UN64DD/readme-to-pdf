// Content script injected into GitHub repository pages.
// Phase 0: placeholder only. README extraction and PDF export come later.

(function () {
  "use strict";

  const README_SELECTOR = "#readme";

  function findReadme() {
    return document.querySelector(README_SELECTOR);
  }

  // Expose a tiny helper on the page's window for future messaging.
  window.__readmeToPdf = {
    getReadmeElement: findReadme,
  };
})();
