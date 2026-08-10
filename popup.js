const fmt = (n, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

function formatMl(ml) {
  if (ml >= 1000) return `${fmt(ml / 1000, 2)} L`;
  return `${fmt(ml, 1)} mL`;
}

function setDropletFill(totalMl) {
  const rect = document.getElementById("fillRect");
  if (!rect) return;
  // Fills linearly every 1000 mL cycle (or caps gracefully)
  const progress = totalMl <= 0 ? 0 : ((totalMl - 0.001) % 1000) / 1000;
  const y = 150 - progress * 144;
  rect.setAttribute("y", y.toFixed(1));
}

function renderDomains(byDomain) {
  const list = document.getElementById("domainList");
  if (!list) return;
  
  const entries = Object.entries(byDomain || {}).sort((a, b) => b[1].totalMl - a[1].totalMl);

  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-row">Nothing tracked yet — start a chat on any AI site.</li>`;
    return;
  }

  list.innerHTML = entries
    .slice(0, 8)
    .map(
      ([domain, d]) => `
        <li>
          <span>${domain}</span>
          <span class="dval">${formatMl(d.totalMl)} · ${d.queryCount}×</span>
        </li>`
    )
    .join("");
}

async function render() {
  const data = await chrome.storage.local.get(["totals", "byDomain", "settings"]);
  const totals = data.totals || { totalMl: 0, totalTokens: 0, queryCount: 0 };
  const settings = data.settings || { mlPer1000Tokens: 0.5, charsPerToken: 4 };

  const totalValEl = document.getElementById("totalValue");
  if (totalValEl) totalValEl.textContent = formatMl(totals.totalMl);

  const glassesEl = document.getElementById("glassesNote");
  if (glassesEl) {
    glassesEl.textContent = `≈ ${fmt(totals.totalMl / 250, 1)} glasses of water (250 mL each)`;
  }

  const queryCountEl = document.getElementById("queryCount");
  if (queryCountEl) queryCountEl.textContent = fmt(totals.queryCount);

  const tokenCountEl = document.getElementById("tokenCount");
  if (tokenCountEl) tokenCountEl.textContent = fmt(totals.totalTokens);

  const mlInput = document.getElementById("mlPer1000");
  if (mlInput && document.activeElement !== mlInput) {
    mlInput.value = settings.mlPer1000Tokens;
  }

  const charsInput = document.getElementById("charsPerToken");
  if (charsInput && document.activeElement !== charsInput) {
    charsInput.value = settings.charsPerToken;
  }

  setDropletFill(totals.totalMl);
  renderDomains(data.byDomain);
}

// Event Listeners
document.getElementById("saveSettings")?.addEventListener("click", async () => {
  const mlPer1000Tokens = parseFloat(document.getElementById("mlPer1000").value) || 0.5;
  const charsPerToken = parseFloat(document.getElementById("charsPerToken").value) || 4;

  const data = await chrome.storage.local.get(["settings"]);
  const settings = { ...(data.settings || {}), mlPer1000Tokens, charsPerToken };
  await chrome.storage.local.set({ settings });

  const btn = document.getElementById("saveSettings");
  if (btn) {
    const original = btn.textContent;
    btn.textContent = "Saved";
    setTimeout(() => (btn.textContent = original), 1000);
  }
});

document.getElementById("resetBtn")?.addEventListener("click", async () => {
  if (!confirm("Clear all tracked usage data? This can't be undone.")) return;
  
  // 1. Clear storage totals
  await chrome.storage.local.set({
    totals: { totalMl: 0, totalTokens: 0, queryCount: 0 },
    byDomain: {},
    log: []
  });

  // 2. Clear extension icon badge text
  if (chrome.action?.setBadgeText) {
    chrome.action.setBadgeText({ text: "" });
  }

  // 3. Re-render UI
  render();
});

// Re-render automatically when background updates storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.totals || changes.byDomain)) {
    render();
  }
});

// Initial Render
render();