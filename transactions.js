let allTransactions = [];
let filteredTransactions = [];
let currentPeriod = "thisMonth";

document.addEventListener("DOMContentLoaded", () => {
  loadTransactions();

  setupPeriodFilter();
  document.getElementById("downloadExcel").addEventListener("click", exportFilteredExcel);

  // Default
  applyPresetFilter("thisMonth");
});

/* -------------------
   Load + normalize
-------------------- */
function loadTransactions() {
  const saved = localStorage.getItem("budgetTrackerTransactions");
  allTransactions = saved ? JSON.parse(saved) : [];

  // Ensure txDateMs exists for filtering
  let changed = false;
  allTransactions.forEach(tx => {
    if (!Number.isFinite(tx.txDateMs)) {
      tx.txDateMs = guessTxDateMs(tx);
      changed = true;
    }
    tx.amount = Number(tx.amount || 0);
    tx.fee = Number(tx.fee || 0);
    tx.totalAmount = Number(tx.totalAmount ?? (tx.amount + tx.fee));
    tx.balance = tx.balance !== undefined && tx.balance !== null ? Number(tx.balance) : null;
  });

  if (changed) localStorage.setItem("budgetTrackerTransactions", JSON.stringify(allTransactions));
}

function guessTxDateMs(tx) {
  // Prefer timestamp field if exists
  if (Number.isFinite(tx.timestamp)) return tx.timestamp;

  // Parse "6/2/26 7:17 AM"
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

/* -------------------
   Period filter UI
-------------------- */
function setupPeriodFilter() {
  const btnWrap = document.getElementById("txPeriodButtons");
  const customBox = document.getElementById("txCustomRange");
  const applyBtn = document.getElementById("txApplyCustom");

  btnWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;

    const period = btn.dataset.period;
    setActiveChip(btnWrap, period);

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

/* -------------------
   Date ranges
-------------------- */
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

// Monday-start week
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

  // thisMonth default
  const msStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const msEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
  return { startMs: startOfDay(msStart), endMs: endOfDay(msEnd), label: "This Month" };
}

function applyPresetFilter(period) {
  currentPeriod = period;
  const { startMs, endMs, label } = getPresetRange(period);

  filteredTransactions = allTransactions.filter(tx => tx.txDateMs >= startMs && tx.txDateMs <= endMs);

  document.getElementById("txRangeLabel").textContent =
    `${label}: ${new Date(startMs).toLocaleDateString()} → ${new Date(endMs).toLocaleDateString()}`;

  renderTable(filteredTransactions);
}

function applyCustomFilter() {
  const fromVal = document.getElementById("txDateFrom").value;
  const toVal = document.getElementById("txDateTo").value;

  if (!fromVal || !toVal) return alert("Please select both Date From and Date To.");

  const startMs = startOfDay(new Date(fromVal).getTime());
  const endMs = endOfDay(new Date(toVal).getTime());

  if (endMs < startMs) return alert("Date To must be on/after Date From.");

  filteredTransactions = allTransactions.filter(tx => tx.txDateMs >= startMs && tx.txDateMs <= endMs);

  document.getElementById("txRangeLabel").textContent =
    `Custom: ${new Date(startMs).toLocaleDateString()} → ${new Date(endMs).toLocaleDateString()}`;

  renderTable(filteredTransactions);
}

/* -------------------
   Render table
-------------------- */
function renderTable(rows) {
  const tbody = document.getElementById("transactionsBody");
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#666;">
      No transactions found for this period.
    </td></tr>`;
    return;
  }

  rows
    .slice()
    .sort((a, b) => b.txDateMs - a.txDateMs)
    .forEach(tx => {
      tbody.innerHTML += `
        <tr>
          <td>${tx.date || "-"}</td>
          <td>${tx.code || "-"}</td>
          <td>Ksh ${tx.amount.toFixed(2)}</td>
          <td>Ksh ${tx.fee.toFixed(2)}</td>
          <td><span class="category-badge">${tx.category || "Others"}</span></td>
          <td><b>Ksh ${tx.totalAmount.toFixed(2)}</b></td>
          <td>${tx.balance === null ? "-" : `Ksh ${tx.balance.toFixed(2)}`}</td>
        </tr>
      `;
    });
}

/* -------------------
   Excel export
-------------------- */
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