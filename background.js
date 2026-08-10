// AI Water Footprint Tracker — background service worker

const MAX_LOG_ENTRIES = 200;

// Ensure default settings exist on install / update
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["settings"]);
  if (!data.settings) {
    await chrome.storage.local.set({
      settings: {
        charsPerToken: 4,
        mlPer1000Tokens: 0.5, // Realistic data center cooling average (~0.5 ml / 1k tokens)
        minChars: 3,
        responseSettleMs: 1500,
        responseTimeoutMs: 30000
      }
    });
  }
});

// Listener for content script events
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "LOG_USAGE" || !message.payload) return false;

  recordUsage(message.payload)
    .then(() => sendResponse({ status: "success" }))
    .catch((err) => console.error("Error recording usage:", err));

  return true; // Keeps the message channel open for async response
});

async function recordUsage(entry) {
  const data = await chrome.storage.local.get(["totals", "byDomain", "log"]);

  // Calculate Running Totals
  const totals = data.totals || { totalMl: 0, totalTokens: 0, queryCount: 0 };
  totals.totalMl += entry.estimatedMl || 0;
  totals.totalTokens += entry.totalTokens || 0;
  totals.queryCount += 1;

  // Breakdown by Domain
  const byDomain = data.byDomain || {};
  const domainKey = entry.domain || "unknown";
  const domainData = byDomain[domainKey] || { totalMl: 0, totalTokens: 0, queryCount: 0 };
  domainData.totalMl += entry.estimatedMl || 0;
  domainData.totalTokens += entry.totalTokens || 0;
  domainData.queryCount += 1;
  byDomain[domainKey] = domainData;

  // Recent Activity Log (FIFO cap)
  const log = data.log || [];
  log.push(entry);
  if (log.length > MAX_LOG_ENTRIES) {
    log.splice(0, log.length - MAX_LOG_ENTRIES);
  }

  await chrome.storage.local.set({ totals, byDomain, log });
}