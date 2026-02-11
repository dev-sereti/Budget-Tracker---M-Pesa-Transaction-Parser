let allTransactions = [];
let filteredTransactions = [];
let currentPeriod = "thisMonth";
let isSearchActive = false;

document.addEventListener("DOMContentLoaded", async () => {
  await loadTransactions();

  setupPeriodFilter();
  setupSearch();
  document.getElementById("downloadExcel").addEventListener("click", exportFilteredExcel);

  // Default
  applyPresetFilter("thisMonth");
});


// ── Load + normalize (fetch from backend) ──
async function loadTransactions() {
  try {
    const response = await fetch('/api/transactions', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    if (!response.ok) throw new Error('Failed to load transactions');
    allTransactions = await response.json();

    const normalized = normalizeTransactions(allTransactions);
    allTransactions = normalized.list;
  } catch (err) {
    console.error('Error loading transactions:', err);
    allTransactions = [];
  }
}

function guessTxDateMs(tx) {
  if (Number.isFinite(tx.timestamp)) return tx.timestamp;

  if (typeof tx.date === "string") {
    const m = tx.date.trim().match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i
    );
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]) - 1;
      let yy = Number(m[3]);
      if (yy < 100) yy += 2000;

      let hh = Number(m[4]);
      const min = Number(m[5]);
      const ap = m[6].toUpperCase();
      if (ap === "PM" && hh !== 12) hh += 12;
      if (ap === "AM" && hh === 12) hh = 0;

      return new Date(yy, mm, dd, hh, min, 0, 0).getTime();
    }
  }

  return Date.now();
}


// ── Search by Transaction Code ──
function setupSearch() {
  const txSearchInput = document.getElementById("txSearchInput");
  const txSearchBtn = document.getElementById("txSearchBtn");
  const txClearSearchBtn = document.getElementById("txClearSearchBtn");

  txSearchBtn.addEventListener("click", performSearch);

  txSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") performSearch();
  });

  txSearchInput.addEventListener("paste", () => {
    setTimeout(performSearch, 150);
  });

  txClearSearchBtn.addEventListener("click", clearSearch);
}

function performSearch() {
  const txSearchInput = document.getElementById("txSearchInput");
  const txClearSearchBtn = document.getElementById("txClearSearchBtn");
  const txSearchResultLabel = document.getElementById("txSearchResultLabel");

  const query = txSearchInput.value.trim().toLowerCase();

  if (!query) {
    txSearchResultLabel.textContent = "Please enter a transaction code.";
    txSearchResultLabel.style.color = "#e67e22";
    return;
  }

  // Search across ALL transactions, not just the current filtered view
  const matches = allTransactions.filter(tx => {
    const code = (tx.code || "").toLowerCase();
    return code === query || code.includes(query);
  });

  if (matches.length > 0) {
    isSearchActive = true;
    filteredTransactions = matches;

    txSearchResultLabel.textContent = `✅ ${matches.length} transaction${matches.length > 1 ? "s" : ""} found!`;
    txSearchResultLabel.style.color = "#27ae60";

    // Deactivate period chips visually
    const btnWrap = document.getElementById("txPeriodButtons");
    [...btnWrap.querySelectorAll(".chip")].forEach(b => b.classList.remove("active"));

    document.getElementById("txRangeLabel").textContent = `Showing search results for "${txSearchInput.value.trim()}"`;

    renderTable(filteredTransactions, query);
  } else {
    isSearchActive = true;
    filteredTransactions = [];

    txSearchResultLabel.textContent = `❌ No transaction found for "${txSearchInput.value.trim()}"`;
    txSearchResultLabel.style.color = "#e74c3c";

    renderTable([]);
  }

  txClearSearchBtn.style.display = "inline-block";
}

function clearSearch() {
  const txSearchInput = document.getElementById("txSearchInput");
  const txClearSearchBtn = document.getElementById("txClearSearchBtn");
  const txSearchResultLabel = document.getElementById("txSearchResultLabel");

  txSearchInput.value = "";
  txSearchResultLabel.textContent = "";
  txClearSearchBtn.style.display = "none";
  isSearchActive = false;

  // Remove all highlights
  document.querySelectorAll("#transactionsBody tr").forEach(row => {
    row.classList.remove("highlight-row");
  });

  // Re-apply the last active period filter
  const btnWrap = document.getElementById("txPeriodButtons");
  setActiveChip(btnWrap, currentPeriod);
  applyPresetFilter(currentPeriod);
}


// ── Period filter UI ──
function setupPeriodFilter() {
  const btnWrap = document.getElementById("txPeriodButtons");
  const customBox = document.getElementById("txCustomRange");
  const applyBtn = document.getElementById("txApplyCustom");

  btnWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;

    const period = btn.dataset.period;
    setActiveChip(btnWrap, period);

    // Clear any active search when switching periods
    if (isSearchActive) {
      const txSearchInput = document.getElementById("txSearchInput");
      const txClearSearchBtn = document.getElementById("txClearSearchBtn");
      const txSearchResultLabel = document.getElementById("txSearchResultLabel");

      txSearchInput.value = "";
      txSearchResultLabel.textContent = "";
      txClearSearchBtn.style.display = "none";
      isSearchActive = false;
    }

    if (period === "custom") {
      currentPeriod = "custom";
      customBox.classList.add("show");
      document.getElementById("txRangeLabel").textContent =
        "Select Date From and Date To, then click Apply.";
      filteredTransactions = [];
      renderTable(filteredTransactions);
      return;
    }

    customBox.classList.remove("show");
    applyPresetFilter(period);
  });

  applyBtn.addEventListener("click", applyCustomFilter);
}

function setActiveChip(container, period) {
  [...container.querySelectorAll(".chip")].forEach(b => {
    b.classList.toggle("active", b.dataset.period === period);
  });
}


// ── Date ranges ──
function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(ms) {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function startOfThisWeek(now = new Date()) {
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

function getPresetRange(period) {
  const now = new Date();

  if (period === "today") {
    return { startMs: startOfDay(now.getTime()), endMs: endOfDay(now.getTime()), label: "Today" };
  }

  if (period === "thisWeek") {
    return { startMs: startOfThisWeek(now), endMs: endOfDay(now.getTime()), label: "This Week" };
  }

  if (period === "lastWeek") {
    const thisWeekStart = startOfThisWeek(now);
    const lastWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;
    const lastWeekEnd = thisWeekStart - 1;
    return { startMs: lastWeekStart, endMs: lastWeekEnd, label: "Last Week" };
  }

  const msStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const msEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
  return { startMs: startOfDay(msStart), endMs: endOfDay(msEnd), label: "This Month" };
}

async function applyPresetFilter(period) {
  currentPeriod = period;
  const { startMs, endMs, label } = getPresetRange(period);

  document.getElementById("txRangeLabel").textContent =
    `${label}: ${new Date(startMs).toLocaleDateString()} → ${new Date(endMs).toLocaleDateString()}`;

  try {
    const response = await fetch(`/api/transactions?startMs=${startMs}&endMs=${endMs}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    if (!response.ok) throw new Error('Failed to fetch filtered transactions');
    filteredTransactions = await response.json();

    const normalized = normalizeTransactions(filteredTransactions);
    filteredTransactions = normalized.list;
  } catch (err) {
    console.error('Error fetching filtered transactions:', err);
    filteredTransactions = [];
  }

  renderTable(filteredTransactions);
}

async function applyCustomFilter() {
  const fromVal = document.getElementById("txDateFrom").value;
  const toVal = document.getElementById("txDateTo").value;

  if (!fromVal || !toVal) return alert("Please select both Date From and Date To.");

  const startMs = startOfDay(new Date(fromVal).getTime());
  const endMs = endOfDay(new Date(toVal).getTime());

  if (endMs < startMs) return alert("Date To must be on/after Date From.");

  document.getElementById("txRangeLabel").textContent =
    `Custom: ${new Date(startMs).toLocaleDateString()} → ${new Date(endMs).toLocaleDateString()}`;

  try {
    const response = await fetch(`/api/transactions?startMs=${startMs}&endMs=${endMs}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    if (!response.ok) throw new Error('Failed to fetch filtered transactions');
    filteredTransactions = await response.json();

    const normalized = normalizeTransactions(filteredTransactions);
    filteredTransactions = normalized.list;
  } catch (err) {
    console.error('Error fetching filtered transactions:', err);
    filteredTransactions = [];
  }

  renderTable(filteredTransactions);
}


// ── Render table (with optional highlight query) ──
function renderTable(rows, highlightQuery = "") {
  const tbody = document.getElementById("transactionsBody");
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#666;">
      No transactions found${isSearchActive ? " for this search" : " for this period"}.
    </td></tr>`;
    return;
  }

  const sorted = rows.slice().sort((a, b) => b.txDateMs - a.txDateMs);

  sorted.forEach(tx => {
    const row = document.createElement("tr");

    // Highlight if this row matches the search query
    if (highlightQuery) {
      const code = (tx.code || "").toLowerCase();
      if (code === highlightQuery || code.includes(highlightQuery)) {
        row.classList.add("highlight-row");
      }
    }

    row.innerHTML = `
      <td>${tx.date || "-"}</td>
      <td>${tx.code || "-"}</td>
      <td>Ksh ${tx.amount.toFixed(2)}</td>
      <td>Ksh ${tx.fee.toFixed(2)}</td>
      <td><span class="category-badge">${tx.category || "Others"}</span></td>
      <td><b>Ksh ${tx.totalAmount.toFixed(2)}</b></td>
      <td>${tx.balance === null ? "-" : `Ksh ${tx.balance.toFixed(2)}`}</td>
    `;

    tbody.appendChild(row);
  });

  // Scroll to the first highlighted row if search is active
  if (highlightQuery) {
    const firstHighlight = tbody.querySelector(".highlight-row");
    if (firstHighlight) {
      setTimeout(() => {
        firstHighlight.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
  }
}


// ── Excel export ──
function exportFilteredExcel() {
  const data = filteredTransactions.length ? filteredTransactions : allTransactions;

  if (!data.length) return alert("No data to export.");

  const excelData = data.map(tx => ({
    "Date": tx.date || "",
    "Transaction Code": tx.code || "",
    "Amount": tx.amount,
    "Transaction Fee": tx.fee,
    "Category": tx.category || "Others",
    "Total Amount": tx.totalAmount,
    "Balance": tx.balance === null ? "" : tx.balance
  }));

  const ws = XLSX.utils.json_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  XLSX.writeFile(wb, "Budget_Transactions.xlsx");
}