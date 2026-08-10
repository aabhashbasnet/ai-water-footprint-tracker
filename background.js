// AI Water Footprint Tracker — background service worker
// Receives usage events from content scripts and keeps a running tally
// in chrome.storage.local: an overall total, a per-domain breakdown,
// and a capped recent-activity log for the popup.

const MAX_LOG_ENTRIES = 200;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "LOG_USAGE") return;
  recordUsage(message.payload);
});

async function recordUsage(entry) {
  const data = await chrome.storage.local.get(["totals", "byDomain", "log"]);

  const totals = data.totals || { totalMl: 0, totalTokens: 0, queryCount: 0 };
  totals.totalMl += entry.estimatedMl;
  totals.totalTokens += entry.totalTokens;
  totals.queryCount += 1;

  const byDomain = data.byDomain || {};
  const d = byDomain[entry.domain] || { totalMl: 0, queryCount: 0 };
  d.totalMl += entry.estimatedMl;
  d.queryCount += 1;
  byDomain[entry.domain] = d;

  const log = data.log || [];
  log.push(entry);
  while (log.length > MAX_LOG_ENTRIES) log.shift();

  await chrome.storage.local.set({ totals, byDomain, log });
}

// Ensure default settings exist on install.
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["settings"]);
  if (!data.settings) {
    await chrome.storage.local.set({
      settings: {
        charsPerToken: 4,
        mlPer1000Tokens: 500,
        minChars: 12,
        responseSettleMs: 1200,
        responseTimeoutMs: 20000
      }
    });
  }
});