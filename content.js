
// AI Water Footprint Tracker — content script

(() => {
  const DEFAULTS = {
    charsPerToken: 4,
    mlPer1000Tokens: 500,
    minChars: 12,
    responseSettleMs: 1200,
    responseTimeoutMs: 20000
  };

  let settings = { ...DEFAULTS };

  // Load saved settings
  chrome.storage.local.get(["settings"], (data) => {
    if (data && data.settings) {
      settings = { ...DEFAULTS, ...data.settings };
    }
  });

  // Update settings when popup changes them
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      settings = {
        ...DEFAULTS,
        ...changes.settings.newValue
      };
    }
  });

  // --------------------------------------------------
  // Identify which AI website we're running on
  // --------------------------------------------------

  function getAIProvider() {
    const hostname = location.hostname;

    if (
      hostname === "chatgpt.com" ||
      hostname === "chat.openai.com"
    ) {
      return "ChatGPT";
    }

    if (hostname === "gemini.google.com") {
      return "Gemini";
    }

    if (hostname === "claude.ai") {
      return "Claude";
    }

    return "Unknown";
  }

  const provider = getAIProvider();

  console.log(`💧 AI Water Tracker loaded on ${provider}`);

  // --------------------------------------------------
  // Token estimation
  // --------------------------------------------------

  function estimateTokens(text) {
    if (!text) return 0;

    return Math.max(
      0,
      Math.ceil(text.trim().length / settings.charsPerToken)
    );
  }

  // --------------------------------------------------
  // Get text from input element
  // --------------------------------------------------

  function getEditableText(el) {
    if (!el) return "";

    if (
      el.tagName === "TEXTAREA" ||
      el.tagName === "INPUT"
    ) {
      return el.value || "";
    }

    if (el.isContentEditable) {
      return el.innerText || el.textContent || "";
    }

    return "";
  }

  // --------------------------------------------------
  // Report usage to background.js
  // --------------------------------------------------

  function reportUsage(queryText, responseText) {
    const queryTokens = estimateTokens(queryText);
    const responseTokens = estimateTokens(responseText);

    const totalTokens = queryTokens + responseTokens;

    if (totalTokens === 0) return;

    const estimatedMl =
      (totalTokens / 1000) * settings.mlPer1000Tokens;

    console.log("💧 AI Water Usage", {
      provider,
      queryTokens,
      responseTokens,
      totalTokens,
      estimatedMl
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
  // Find input near a button
  // --------------------------------------------------

  function findNearbyEditable(startEl) {
    let node = startEl;

    for (let i = 0; i < 4 && node; i++) {
      const container =
        node.closest?.(
          "form, [role='form'], div"
        ) || node;

      const candidate =
        container?.querySelector?.(
          "textarea, [contenteditable='true'], [contenteditable='']"
        );

      if (candidate) {
        return candidate;
      }

      node = node.parentElement;
    }

    return document.activeElement;
  }

  // --------------------------------------------------
  // Track submission
  // --------------------------------------------------

  let lastSubmitAt = 0;
  let watching = false;

  function handleSubmission(text) {
    const trimmed = text.trim();

    if (trimmed.length < settings.minChars) {
      return;
    }

    const now = Date.now();

    // Prevent duplicate events
    if (now - lastSubmitAt < 800) {
      return;
    }

    lastSubmitAt = now;

    console.log("📤 AI query detected:", trimmed);

    watchForResponse(trimmed);
  }

  // --------------------------------------------------
  // Watch for AI response
  // --------------------------------------------------

  function watchForResponse(queryText) {
    if (watching) {
      return;
    }

    watching = true;

    let settleTimer = null;
    let addedChars = 0;

    const startedAt = Date.now();

    const finish = () => {
      observer.disconnect();

      watching = false;

      const responseText =
        "x".repeat(addedChars);

      console.log(
        "📥 AI response detected:",
        addedChars,
        "characters"
      );

      reportUsage(
        queryText,
        responseText
      );
    };

    const observer =
      new MutationObserver((mutations) => {

        for (const mutation of mutations) {

          mutation.addedNodes.forEach((node) => {

            if (
              node.nodeType === Node.TEXT_NODE
            ) {
              addedChars +=
                node.textContent.trim().length;
            }

            else if (
              node.nodeType === Node.ELEMENT_NODE
            ) {
              const text =
                node.innerText ||
                node.textContent ||
                "";

              addedChars +=
                text.trim().length;
            }

          });
        }

        clearTimeout(settleTimer);

        // Maximum response waiting time
        if (
          Date.now() - startedAt >
          settings.responseTimeoutMs
        ) {
          finish();
          return;
        }

        // Response is considered finished
        // after the DOM is quiet
        settleTimer = setTimeout(
          finish,
          settings.responseSettleMs
        );
      });

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    // Give up if nothing happens
    settleTimer = setTimeout(
      finish,
      settings.responseTimeoutMs
    );
  }

  // --------------------------------------------------
  // Detect Enter key
  // --------------------------------------------------

  document.addEventListener(
    "keydown",

    (e) => {

      if (
        e.key !== "Enter" ||
        e.shiftKey
      ) {
        return;
      }

      const el = e.target;

      const text =
        getEditableText(el);

      if (
        text &&
        text.trim().length >=
          settings.minChars
      ) {
        handleSubmission(text);
      }
    },

    true
  );

  // --------------------------------------------------
  // Detect send button clicks
  // --------------------------------------------------

  document.addEventListener(
    "click",

    (e) => {

      const target =
        e.target.closest?.(
          "button, [role='button'], input[type='submit']"
        );

      if (!target) {
        return;
      }

      const label = (
        target.getAttribute?.("aria-label") ||
        target.getAttribute?.("title") ||
        target.textContent ||
        ""
      ).toLowerCase();

      const sendKeywords = [
        "send",
        "submit",
        "ask",
        "generate"
      ];

      const isSendButton =
        target.type === "submit" ||
        sendKeywords.some(
          (keyword) =>
            label.includes(keyword)
        );

      if (!isSendButton) {
        return;
      }

      const editable =
        findNearbyEditable(target);

      const text =
        getEditableText(editable);

      if (text) {
        handleSubmission(text);
      }
    },

    true
  );

  // --------------------------------------------------
  // Detect form submission
  // --------------------------------------------------

  document.addEventListener(
    "submit",

    (e) => {

      const editable =
        e.target.querySelector?.(
          "textarea, [contenteditable='true'], [contenteditable='']"
        );

      const text =
        getEditableText(editable);

      if (text) {
        handleSubmission(text);
      }
    },

    true
  );

})();

