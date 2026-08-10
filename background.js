// AI Water Footprint Tracker — background service worker
// Receives usage events from content scripts, keeps a running tally
// in chrome.storage.local, and updates the extension toolbar badge live.

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

  // Update extension badge icon with live water tally
  updateBadge(totals.totalMl);
}

// Formats water volume to fit within the 4-character badge limit
function formatBadgeText(ml) {
  if (!ml || ml <= 0) return "";
  if (ml < 1000) {
    return `${Math.round(ml)}m`; // e.g. "10m", "500m"
  }
  const liters = ml / 1000;
  if (liters < 10) {
    return `${liters.toFixed(1)}L`; // e.g. "1.2L"
  }
  return `${Math.round(liters)}L`; // e.g. "12L"
}

// Set badge background color and label
async function updateBadge(totalMl) {
  const badgeText = formatBadgeText(totalMl);
  
  await chrome.action.setBadgeText({ text: badgeText });
  await chrome.action.setBadgeBackgroundColor({ color: "#0284C7" }); // Sky-blue accent
}

// Ensure default settings exist and badge state syncs on startup/install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["settings", "totals"]);
  
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

  // Restore badge state if previous totals exist
  if (data.totals?.totalMl) {
    updateBadge(data.totals.totalMl);
  }
});

// Restore badge text on service worker cold starts
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get(["totals"]);
  if (data.totals?.totalMl) {
    updateBadge(data.totals.totalMl);
  }
});