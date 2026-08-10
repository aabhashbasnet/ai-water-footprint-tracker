// Default conversion fallback values
const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_ML_PER_1000_TOKENS = 500; // ~0.5mL per 1k tokens

let isObservingResponse = false;

// Send accurate usage payload to background.js
async function reportUsage(totalChars) {
  const { settings } = await chrome.storage.local.get(["settings"]);
  const charsPerToken = settings?.charsPerToken || DEFAULT_CHARS_PER_TOKEN;
  const mlPer1000Tokens = settings?.mlPer1000Tokens || DEFAULT_ML_PER_1000_TOKENS;

  // Calculate actual tokens from prompt + response combined
  const totalTokens = Math.max(1, Math.ceil(totalChars / charsPerToken));
  const estimatedMl = (totalTokens / 1000) * mlPer1000Tokens;

  const payload = {
    domain: window.location.hostname.replace("www.", ""),
    estimatedMl: Math.max(0.1, estimatedMl),
    totalTokens: totalTokens,
    timestamp: Date.now()
  };

  chrome.runtime.sendMessage({ type: "LOG_USAGE", payload }, () => {
    console.log("[AI Water Tracker] Recorded real response usage:", payload);
  });
}

// Track response completion using DOM observation
function waitForResponseCompletion(promptCharCount) {
  if (isObservingResponse) return;
  isObservingResponse = true;

  const observer = new MutationObserver(() => {
    // Check if ChatGPT/Claude has finished generating
    // (e.g. stop button disappears or send button re-appears)
    const isGenerating = document.querySelector('button[aria-label*="Stop"], button[data-testid="stop-button"]');

    if (!isGenerating) {
      observer.disconnect();
      isObservingResponse = false;

      // Small delay to ensure last tokens are rendered
      setTimeout(() => {
        // Find the latest assistant response element
        const responses = document.querySelectorAll(
          'div[data-message-author-role="assistant"], div.font-claude-message, div[data-testid*="conversation-turn"]'
        );
        const lastResponse = responses[responses.length - 1];
        
        const responseText = lastResponse ? (lastResponse.innerText || "") : "";
        const totalChars = promptCharCount + responseText.length;

        reportUsage(totalChars);
      }, 500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function handlePromptSubmit() {
  const promptInput = document.querySelector(`
    #prompt-textarea, 
    div[contenteditable="true"], 
    textarea[placeholder*="Ask"], 
    textarea[placeholder*="Message"]
  `);

  const promptText = promptInput?.value || promptInput?.innerText || "";
  const promptCharCount = promptText.trim().length || 20;

  // Wait for the AI to start streaming and finish
  setTimeout(() => {
    waitForResponseCompletion(promptCharCount);
  }, 1000);
}

function initTracker() {
  // 1. Listen for Send Button Click
  document.addEventListener("click", (e) => {
    const sendButton = e.target.closest(`
      button[data-testid="send-button"], 
      button[aria-label*="Send"], 
      button[aria-label*="send"],
      button.send-button
    `);

    if (sendButton && !sendButton.disabled) {
      handlePromptSubmit();
    }
  });

  // 2. Listen for Enter key press
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;

    const activeElement = document.activeElement;
    if (!activeElement) return;

    const isAiInput = activeElement.matches(`
      #prompt-textarea, 
      div[contenteditable="true"], 
      textarea[placeholder*="Ask"], 
      textarea[placeholder*="Message"],
      rich-textarea div
    `);

    if (isAiInput && (activeElement.value || activeElement.innerText || "").trim().length > 0) {
      handlePromptSubmit();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTracker);
} else {
  initTracker();
}
