// AI Water Footprint Tracker — content script

(() => {
  const DEFAULTS = {
    charsPerToken: 4,
    mlPer1000Tokens: 0.5,
    minChars: 2,
    responseSettleMs: 1500,
    responseTimeoutMs: 30000
  };

  let settings = { ...DEFAULTS };

  chrome.storage.local.get(["settings"], (data) => {
    if (data?.settings) settings = { ...DEFAULTS, ...data.settings };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      settings = { ...DEFAULTS, ...changes.settings.newValue };
    }
  });

  function getAIProvider() {
    const host = location.hostname;
    if (host.includes("chatgpt.com") || host.includes("openai.com")) return "ChatGPT";
    if (host.includes("gemini.google.com")) return "Gemini";
    if (host.includes("claude.ai")) return "Claude";
    return "Unknown";
  }

  const provider = getAIProvider();
  console.log(`💧 AI Water Tracker listening on ${provider}`);

  // --------------------------------------------------
  // Helper: Extract Text from ChatGPT & Gemini Elements
  // --------------------------------------------------

  function extractTextFromElement(el) {
    if (!el) return "";

    // Check target or parent containers for text
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return el.value || "";
    }

    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      return el.innerText || el.textContent || "";
    }

    // Gemini specific custom component handling (<rich-textarea> / <p>)
    const richEditor = el.closest?.("rich-textarea, .ql-editor, [contenteditable]");
    if (richEditor) {
      return richEditor.innerText || richEditor.textContent || "";
    }

    return "";
  }

  function findActiveInput() {
    // 1. Try currently focused element
    let active = document.activeElement;
    let text = extractTextFromElement(active);
    if (text.trim()) return text;

    // 2. Query known AI input selectors directly
    const selectors = [
      '#prompt-textarea',                           // ChatGPT
      'rich-textarea [contenteditable="true"]',     // Gemini
      'div[contenteditable="true"]',                // Claude / General
      'textarea'
    ];

    for (const sel of selectors) {
      const inputEl = document.querySelector(sel);
      if (inputEl) {
        text = extractTextFromElement(inputEl);
        if (text.trim()) return text;
      }
    }

    return "";
  }

  // --------------------------------------------------
  // Token & Usage Calculation
  // --------------------------------------------------

  function estimateTokens(text) {
    if (!text) return 0;
    return Math.max(0, Math.ceil(text.trim().length / settings.charsPerToken));
  }

  function reportUsage(queryText, responseLength) {
    const queryTokens = estimateTokens(queryText);
    const responseTokens = estimateTokens("x".repeat(responseLength));
    const totalTokens = queryTokens + responseTokens;

    if (totalTokens === 0) return;

    const estimatedMl = (totalTokens / 1000) * settings.mlPer1000Tokens;

    console.log("💧 AI Water Usage Tracked:", {
      provider,
      queryTokens,
      responseTokens,
      totalTokens,
      estimatedMl: estimatedMl.toFixed(3) + " mL"
    });

    chrome.runtime.sendMessage({
      type: "LOG_USAGE",
      payload: {
        provider,
        domain: location.hostname,
        queryTokens,
        responseTokens,
        totalTokens,
        estimatedMl,
        timestamp: Date.now()
      }
    });
  }

  // --------------------------------------------------
  // Submission & Response Observers
  // --------------------------------------------------

  let lastSubmitAt = 0;
  let isWatching = false;

  function handleSubmission(text) {
    const trimmed = text.trim();
    if (trimmed.length < settings.minChars) return;

    const now = Date.now();
    if (now - lastSubmitAt < 1000) return; // Prevent double logging
    lastSubmitAt = now;

    console.log("📤 Detected Prompt:", trimmed);
    watchForResponse(trimmed);
  }

  function watchForResponse(queryText) {
    if (isWatching) return;
    isWatching = true;

    // Response element selectors per platform
    const SELECTORS = {
      ChatGPT: '[data-message-author-role="assistant"]',
      Gemini: 'model-response, message-content, .response-container-content',
      Claude: '.font-claude-message',
      Unknown: 'article, [role="article"]'
    };

    const selector = SELECTORS[provider] || SELECTORS.Unknown;
    const initialCount = document.querySelectorAll(selector).length;

    let settleTimer = null;
    let timeoutTimer = null;

    const finish = () => {
      observer.disconnect();
      clearTimeout(settleTimer);
      clearTimeout(timeoutTimer);
      isWatching = false;

      const currentResponses = document.querySelectorAll(selector);
      let responseLength = 0;

      if (currentResponses.length > 0) {
        const latest = currentResponses[currentResponses.length - 1];
        responseLength = (latest.innerText || latest.textContent || "").trim().length;
      }

      reportUsage(queryText, responseLength);
    };

    const resetSettleTimer = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, settings.responseSettleMs);
    };

    const observer = new MutationObserver(() => {
      resetSettleTimer();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    timeoutTimer = setTimeout(finish, settings.responseTimeoutMs);
    resetSettleTimer();
  }

  // --------------------------------------------------
  // Global Event Capturing (Capture Phase = True)
  // --------------------------------------------------

  // 1. Capture 'Enter' Key BEFORE input is cleared
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;

      const text = findActiveInput();
      if (text) {
        handleSubmission(text);
      }
    },
    true // Capture phase execution
  );

  // 2. Capture clicks on send buttons / icons
  window.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest(
        'button, [role="button"], input[type="submit"], [aria-label*="Send"], [aria-label*="Submit"]'
      );

      if (!btn) return;

      const text = findActiveInput();
      if (text) {
        handleSubmission(text);
      }
    },
    true // Capture phase execution
  );
})();