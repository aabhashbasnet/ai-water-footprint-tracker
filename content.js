// AI Water Footprint Tracker — content script
// Runs on every page. Heuristically detects "you typed something and hit
// send" moments, watches the DOM for the reply that follows, estimates
// token counts for both, and reports an estimated water usage to the
// background service worker.

(() => {
  const DEFAULTS = {
    charsPerToken: 4,        // rough English-text heuristic
    mlPer1000Tokens: 500,    // editable in popup — this is a contested figure, treat as illustrative
    minChars: 12,            // ignore tiny inputs (search boxes, login fields, etc.)
    responseSettleMs: 1200,  // stop listening once the DOM has been quiet this long
    responseTimeoutMs: 20000 // give up waiting for a response after this long
  };

  let settings = { ...DEFAULTS };

  chrome.storage.local.get(["settings"], (data) => {
    if (data && data.settings) settings = { ...DEFAULTS, ...data.settings };
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      settings = { ...DEFAULTS, ...changes.settings.newValue };
    }
  });

  const SEND_KEYWORDS = ["send", "submit", "ask", "generate"];

  function looksLikeSendControl(el) {
    if (!el) return false;
    const label = (
      el.getAttribute?.("aria-label") ||
      el.getAttribute?.("title") ||
      el.textContent ||
      ""
    ).toLowerCase();
    if (el.type === "submit") return true;
    return SEND_KEYWORDS.some((k) => label.includes(k));
  }

  function getEditableText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    if (el.isContentEditable) return el.innerText || el.textContent || "";
    return "";
  }

  function findNearbyEditable(startEl) {
    // Walk up a few levels, then look for a textarea/contenteditable within
    // the same form/container — covers "send button next to the box" UIs.
    let node = startEl;
    for (let i = 0; i < 4 && node; i++) {
      const container = node.closest?.("form, [role='form'], div") || node;
      const candidate = container?.querySelector?.(
        "textarea, [contenteditable='true'], [contenteditable='']"
      );
      if (candidate) return candidate;
      node = node.parentElement;
    }
    return document.activeElement;
  }

  let lastSubmitAt = 0;
  let watching = false;

  function estimateTokens(text) {
    return Math.max(0, Math.ceil(text.trim().length / settings.charsPerToken));
  }

  function reportUsage(queryText, responseText) {
    const queryTokens = estimateTokens(queryText);
    const responseTokens = estimateTokens(responseText);
    const totalTokens = queryTokens + responseTokens;
    if (totalTokens === 0) return;

    const estimatedMl = (totalTokens / 1000) * settings.mlPer1000Tokens;

    chrome.runtime.sendMessage({
      type: "LOG_USAGE",
      payload: {
        domain: location.hostname,
        queryTokens,
        responseTokens,
        totalTokens,
        estimatedMl,
        timestamp: Date.now()
      }
    });
  }

  function watchForResponse(queryText) {
    if (watching) return;
    watching = true;

    let settleTimer = null;
    let addedChars = 0;
    const startedAt = Date.now();

    const finish = () => {
      observer.disconnect();
      watching = false;
      reportUsage(queryText, "x".repeat(addedChars)); // length is what matters, not content
    };

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            addedChars += node.textContent.trim().length;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const text = node.innerText || node.textContent || "";
            addedChars += text.trim().length;
          }
        });
      }
      clearTimeout(settleTimer);
      if (Date.now() - startedAt > settings.responseTimeoutMs) {
        finish();
        return;
      }
      settleTimer = setTimeout(finish, settings.responseSettleMs);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Nothing ever arrived — bail out eventually so we don't watch forever.
    settleTimer = setTimeout(finish, settings.responseTimeoutMs);
  }

  function handleSubmission(text) {
    const trimmed = text.trim();
    if (trimmed.length < settings.minChars) return;

    const now = Date.now();
    if (now - lastSubmitAt < 800) return; // debounce accidental double-fires
    lastSubmitAt = now;

    watchForResponse(trimmed);
  }

  // 1) Enter key (without Shift) inside a textarea / contenteditable
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const el = e.target;
      const text = getEditableText(el);
      if (text && text.trim().length >= settings.minChars) {
        handleSubmission(text);
      }
    },
    true
  );

  // 2) Clicks on send-like buttons
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target.closest?.("button, [role='button'], input[type='submit']");
      if (!target || !looksLikeSendControl(target)) return;
      const editable = findNearbyEditable(target);
      const text = getEditableText(editable);
      if (text) handleSubmission(text);
    },
    true
  );

  // 3) Native form submit
  document.addEventListener(
    "submit",
    (e) => {
      const editable = e.target.querySelector?.(
        "textarea, [contenteditable='true'], [contenteditable='']"
      );
      const text = getEditableText(editable);
      if (text) handleSubmission(text);
    },
    true
  );
})();