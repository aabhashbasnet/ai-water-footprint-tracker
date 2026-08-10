const fmt = (n, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

function formatMl(ml) {
  if (ml >= 1000) return `${fmt(ml / 1000, 2)} L`;
  return `${fmt(ml, 1)} mL`;
}

function setDropletFill(totalMl) {
  const rect = document.getElementById("fillRect");
  const progress = totalMl <= 0 ? 0 : ((totalMl - 0.001) % 1000) / 1000;
  const y = 150 - progress * 144;
  rect.setAttribute("y", y.toFixed(1));
}

function renderDomains(byDomain) {
  const list = document.getElementById("domainList");
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
  const settings = data.settings || { mlPer1000Tokens: 500, charsPerToken: 4 };

  document.getElementById("totalValue").textContent = formatMl(totals.totalMl);
  document.getElementById("glassesNote").textContent =
    `≈ ${fmt(totals.totalMl / 250, 1)} glasses of water (250 mL each)`;
  document.getElementById("queryCount").textContent = fmt(totals.queryCount);
  document.getElementById("tokenCount").textContent = fmt(totals.totalTokens);

  document.getElementById("mlPer1000").value = settings.mlPer1000Tokens;
  document.getElementById("charsPerToken").value = settings.charsPerToken;

  setDropletFill(totals.totalMl);
  renderDomains(data.byDomain);
}

document.getElementById("saveSettings").addEventListener("click", async () => {
  const mlPer1000Tokens = parseFloat(document.getElementById("mlPer1000").value) || 0;
  const charsPerToken = parseFloat(document.getElementById("charsPerToken").value) || 4;

  const data = await chrome.storage.local.get(["settings"]);
  const settings = { ...(data.settings || {}), mlPer1000Tokens, charsPerToken };
  await chrome.storage.local.set({ settings });

  const btn = document.getElementById("saveSettings");
  const original = btn.textContent;
  btn.textContent = "Saved";
  setTimeout(() => (btn.textContent = original), 1000);
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  if (!confirm("Clear all tracked usage data? This can't be undone.")) return;
  await chrome.storage.local.set({
    totals: { totalMl: 0, totalTokens: 0, queryCount: 0 },
    byDomain: {},
    log: []
  });
  render();
});

render();