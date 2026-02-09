//  Budget & KPI globals 
const DASHBOARD_BUDGET_KEY = "dashboardMonthlyBudget";

let monthlyIncome = 0;          // Used for Remaining Balance & Savings Rate
let currentMonthlyBudget = null;

// Keep ALL transactions here (unfiltered)
let allTransactions = [];

// Filtered transactions used for KPIs + charts
let filteredTransactions = [];

// Category totals based on filteredTransactions
let categoryTotals = {};

// Global Chart instances
let doughnutChart, barChart;

// Config
const TOP_N_CATEGORIES = 5;

// Consistent Color Palette
const CATEGORY_COLORS = [
  '#4F46E5', // Indigo
  '#06B6D4', // Cyan
  '#F59E0B', // Amber
  '#22C55E', // Green
  '#EF4444', // Red
  '#A855F7', // Purple
  '#EC4899', // Pink
  '#14B8A6'  // Teal
];

// Stable mapping: category -> color
const categoryColorMap = new Map();
function getColorForCategory(category) {
  if (categoryColorMap.has(category)) return categoryColorMap.get(category);
  const idx = categoryColorMap.size % CATEGORY_COLORS.length;
  const color = CATEGORY_COLORS[idx];
  categoryColorMap.set(category, color);
  return color;
}

/* ===
   Date helpers (filter ranges)
 */

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

// Week starts Monday
function startOfThisWeek(now = new Date()) {
  const day = now.getDay(); // 0=Sun
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

function getPresetRange(period) {
  const now = new Date();

  if (period === "today") {
    const s = startOfDay(now.getTime());
    const e = endOfDay(now.getTime());
    return { startMs: s, endMs: e, label: "Today" };
  }

  if (period === "thisWeek") {
    const s = startOfThisWeek(now);
    const e = endOfDay(now.getTime());
    return { startMs: s, endMs: e, label: "This Week" };
  }

  if (period === "lastWeek") {
    // previous calendar week (Mon–Sun)
    const thisWeekStart = startOfThisWeek(now);
    const lastWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;
    const lastWeekEnd = thisWeekStart - 1; // end of Sunday
    return { startMs: lastWeekStart, endMs: lastWeekEnd, label: "Last Week" };
  }

  // default: thisMonth
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startMs: startOfDay(monthStart.getTime()),
    endMs: endOfDay(monthEnd.getTime()),
    label: "This Month"
  };
}

/* Transaction date normalization */

function parseDmyTimeToMs(dateTimeStr) {
  if (!dateTimeStr || typeof dateTimeStr !== "string") return null;

  const m = dateTimeStr.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i
  );

  if (!m) return null;

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

// Ensures every transaction has txDateMs for filtering
function ensureTxDateMs(tx) {
  if (Number.isFinite(tx.txDateMs)) return tx.txDateMs;

  // Try parse from tx.date
  const parsed = parseDmyTimeToMs(tx.date);
  if (Number.isFinite(parsed)) {
    tx.txDateMs = parsed;
    return parsed;
  }

  // Fallback to other known fields
  if (Number.isFinite(tx.timestamp)) {
    tx.txDateMs = tx.timestamp;
    return tx.timestamp;
  }
  if (Number.isFinite(tx.ts)) {
    tx.txDateMs = tx.ts;
    return tx.ts;
  }

  // Last resort
  tx.txDateMs = Date.now();
  return tx.txDateMs;
}

function normalizeTransactions(list) {
  let changed = false;

  list.forEach(tx => {
    const before = tx.txDateMs;
    const ms = ensureTxDateMs(tx);
    if (before !== ms) changed = true;

    // Normalize numbers
    tx.amount = Number(tx.amount || 0);
    tx.fee = Number(tx.fee || 0);

    // Prefer totalAmount, else compute it
    if (!Number.isFinite(Number(tx.totalAmount))) {
      tx.totalAmount = Number(tx.totalAmount ?? (tx.amount + tx.fee));
      changed = true;
    } else {
      tx.totalAmount = Number(tx.totalAmount);
    }

    if (tx.balance !== undefined && tx.balance !== null) {
      const b = Number(
        String(tx.balance)
          .replace(/ksh/ig, "")
          .replace(/,/g, "")
          .trim()
      );
      tx.balance = Number.isFinite(b) ? b : null;
    } else {
      tx.balance = null;
    }
  });

  return { list, changed };
}

/* ===
   Init
=== */

document.addEventListener('DOMContentLoaded', function () {
  loadData();          // loads budget + transactions
  initBudgetSection(); // wires Set button + renders budget KPI if exists
  initCharts();
  setupPeriodFilter();

  // Default: This Month
  applyPresetFilter("thisMonth");
});

function loadData() {
  // Load budget from new key, fall back to old key for compatibility
  const storedBudget = localStorage.getItem(DASHBOARD_BUDGET_KEY);
  const legacyBudget = localStorage.getItem('monthlyIncome');
  let budgetVal = 0;

  if (storedBudget !== null && storedBudget !== "") {
    budgetVal = Number(storedBudget);
  } else if (legacyBudget !== null && legacyBudget !== "") {
    budgetVal = Number(legacyBudget);
  }

  if (!Number.isFinite(budgetVal) || budgetVal < 0) budgetVal = 0;

  monthlyIncome = budgetVal;
  currentMonthlyBudget = budgetVal > 0 ? budgetVal : null;

  // Load transactions
  const saved = localStorage.getItem('budgetTrackerTransactions');
  allTransactions = saved ? JSON.parse(saved) : [];

  const normalized = normalizeTransactions(allTransactions);
  allTransactions = normalized.list;

  if (normalized.changed) {
    localStorage.setItem('budgetTrackerTransactions', JSON.stringify(allTransactions));
  }
}

/* ===
   Period Filter
=== */

function setupPeriodFilter() {
  const btnWrap = document.getElementById("dashPeriodButtons");
  const customBox = document.getElementById("dashCustomRange");
  const applyBtn = document.getElementById("dashApplyCustom");

  if (!btnWrap) return;

  // Click via event delegation
  btnWrap.addEventListener("click", (e) => {
    e.preventDefault();

    const btn = e.target.closest(".chip");
    if (!btn) return;

    const period = btn.dataset.period;
    setActiveChip(btnWrap, period);

    if (period === "custom") {
      if (customBox) customBox.classList.add("show");
      const lbl = document.getElementById("dashRangeLabel");
      if (lbl) lbl.textContent = "Select Date From and Date To, then click Apply.";

      // Don't filter until Apply is clicked
      filteredTransactions = [];
      updateFromFiltered();
      return;
    }

    if (customBox) customBox.classList.remove("show");
    applyPresetFilter(period);
  });

  if (applyBtn) {
    applyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      applyCustomFilter();
    });
  }
}

function setActiveChip(container, period) {
  [...container.querySelectorAll(".chip")].forEach(b => {
    b.classList.toggle("active", b.dataset.period === period);
  });
}

function applyPresetFilter(period) {
  const { startMs, endMs, label } = getPresetRange(period);

  filteredTransactions = allTransactions.filter(tx => {
    const ms = ensureTxDateMs(tx);
    return ms >= startMs && ms <= endMs;
  });

  const lbl = document.getElementById("dashRangeLabel");
  if (lbl) {
    lbl.textContent =
      `${label}: ${new Date(startMs).toLocaleDateString()} → ${new Date(endMs).toLocaleDateString()}`;
  }

  updateFromFiltered();
}

function applyCustomFilter() {
  const fromEl = document.getElementById("dashDateFrom");
  const toEl = document.getElementById("dashDateTo");
  const lbl = document.getElementById("dashRangeLabel");

  if (!fromEl?.value || !toEl?.value) {
    alert("Please select both Date From and Date To.");
    return;
  }

  const startMs = startOfDay(new Date(fromEl.value).getTime());
  const endMs = endOfDay(new Date(toEl.value).getTime());

  if (endMs < startMs) {
    alert("Date To must be on/after Date From.");
    return;
  }

  filteredTransactions = allTransactions.filter(tx => {
    const ms = ensureTxDateMs(tx);
    return ms >= startMs && ms <= endMs;
  });

  if (lbl) {
    lbl.textContent =
      `Custom: ${new Date(startMs).toLocaleDateString()} → ${new Date(endMs).toLocaleDateString()}`;
  }

  updateFromFiltered();
}

/* ===
   Monthly Budget UI (Financial Overview)
=== */

function initBudgetSection() {
  const input = document.getElementById('monthlyIncome');
  const setBtn = document.getElementById('setIncome');
  if (!input || !setBtn) return;

  // If a budget already exists (loaded from storage), render its KPI card
  if (monthlyIncome > 0) {
    currentMonthlyBudget = monthlyIncome;
    renderBudgetKpi("view");
  }

  // When user clicks "Set" under Monthly Budget
  setBtn.addEventListener("click", (e) => {
    e.preventDefault();

    const raw = input.value.trim();
    const value = Number(raw);

    if (!raw || isNaN(value) || value < 0) {
      alert("Please enter a valid non-negative number.");
      return;
    }

    // Update globals + storage
    monthlyIncome = value;
    currentMonthlyBudget = value;
    localStorage.setItem(DASHBOARD_BUDGET_KEY, String(value));
    localStorage.setItem('monthlyIncome', String(value)); // for other pages if needed

    // Clear input as requested
    input.value = "";

    // Show / update the KPI card in Financial Overview
    renderBudgetKpi("view");

    // Recompute KPIs based on current filtered data
    updateFromFiltered();
  });
}

// Renders the budget KPI card in "view" or "edit" mode
function renderBudgetKpi(mode = "view") {
  const card = document.getElementById("budgetKpiCard");
  if (!card) return;

  if (!currentMonthlyBudget || currentMonthlyBudget <= 0) {
    card.classList.add("hidden");
    card.innerHTML = "";
    return;
  }

  card.classList.remove("hidden");
  const amount = currentMonthlyBudget;

  if (mode === "edit") {
    card.innerHTML = `
      <h3>Monthly Budget</h3>
      <div class="budget-edit-inline">
        <input type="number" class="budget-edit-input" value="${amount}" min="0" />
        <button type="button" class="budget-save-btn">Save</button>
        <button type="button" class="budget-cancel-btn">Cancel</button>
      </div>
    `;

    const editInput = card.querySelector(".budget-edit-input");
    const saveBtn = card.querySelector(".budget-save-btn");
    const cancelBtn = card.querySelector(".budget-cancel-btn");

    if (saveBtn && editInput) {
      saveBtn.addEventListener("click", () => {
        const raw = editInput.value.trim();
        const value = Number(raw);

        if (!raw || isNaN(value) || value < 0) {
          alert("Please enter a valid non-negative number.");
          editInput.focus();
          return;
        }

        currentMonthlyBudget = value;
        monthlyIncome = value;
        localStorage.setItem(DASHBOARD_BUDGET_KEY, String(value));
        localStorage.setItem('monthlyIncome', String(value));

        renderBudgetKpi("view");
        updateFromFiltered();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        renderBudgetKpi("view");
      });
    }
  } else {
    const formatted = Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    card.innerHTML = `
      <h3>Monthly Budget</h3>
      <div class="kpi-value" id="budgetKpiValue">Ksh ${formatted}</div>
      <button type="button" class="budget-edit-btn">Edit</button>
    `;

    const editBtn = card.querySelector(".budget-edit-btn");
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        renderBudgetKpi("edit");
      });
    }
  }
}

/* ===
   Totals + Charts
=== */

function calculateCategoryTotals(list) {
  categoryTotals = {};
  list.forEach(transaction => {
    const category = transaction.category || 'Others';
    const amount = Number(transaction.totalAmount || 0);
    categoryTotals[category] = (categoryTotals[category] || 0) + amount;
  });
}

function getTopCategoriesWithOthers(totals, topN = 5) {
  const entries = Object.entries(totals)
    .map(([category, amount]) => ({ category, amount }))
    .filter(item => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const top = entries.slice(0, topN);
  const othersSum = entries.slice(topN).reduce((sum, item) => sum + item.amount, 0);

  if (othersSum > 0) top.push({ category: 'Others', amount: othersSum });
  return top;
}

function formatCurrency(amount) {
  const n = Number(amount || 0);
  return `Ksh ${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function initCharts() {
  const donutCanvas = document.getElementById('doughnutChart');
  const barCanvas = document.getElementById('barChart');
  if (!donutCanvas || !barCanvas) return;

  const donutCtx = donutCanvas.getContext('2d');
  doughnutChart = new Chart(donutCtx, {
    type: 'doughnut',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) =>
              `${context.label || ''}: ${formatCurrency(context.raw || 0)}`
          }
        }
      }
    }
  });

  const barCtx = barCanvas.getContext('2d');
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Spending',
        data: [],
        backgroundColor: [],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true },
        x: { display: false }
      }
    }
  });
}

function updateFromFiltered() {
  // If nothing filtered yet, default to all for first render
  const list = filteredTransactions.length ? filteredTransactions : allTransactions;

  calculateCategoryTotals(list);

  // KPIs based on list
  const totalSpent = list.reduce((sum, t) => sum + Number(t.totalAmount || 0), 0);
  const remainingBalance = monthlyIncome - totalSpent;
  const savingsRate = monthlyIncome > 0
    ? (remainingBalance / monthlyIncome) * 100
    : 0;

  const totalSpentEl = document.getElementById('totalSpent');
  const remainingBalanceEl = document.getElementById('remainingBalance');
  const savingsRateEl = document.getElementById('savingsRate');
  const donutCenterEl = document.getElementById('donutCenterValue');

  if (totalSpentEl) totalSpentEl.textContent = formatCurrency(totalSpent);
  if (remainingBalanceEl) remainingBalanceEl.textContent = formatCurrency(remainingBalance);
  if (savingsRateEl) savingsRateEl.textContent = `${savingsRate.toFixed(1)}%`;
  if (donutCenterEl) donutCenterEl.textContent = formatCurrency(totalSpent);

  // Top N + Others
  const topData = getTopCategoriesWithOthers(categoryTotals, TOP_N_CATEGORIES);
  const colors = topData.map(item => getColorForCategory(item.category));

  // Update Donut
  if (doughnutChart) {
    doughnutChart.data.labels = topData.map(item => item.category);
    doughnutChart.data.datasets[0].data = topData.map(item => item.amount);
    doughnutChart.data.datasets[0].backgroundColor = colors;
    doughnutChart.update();
  }

  // Update Bar (same colors as donut)
  if (barChart) {
    barChart.data.labels = topData.map(item => item.category);
    barChart.data.datasets[0].data = topData.map(item => item.amount);
    barChart.data.datasets[0].backgroundColor = colors;
    barChart.update();
  }

  // Update HTML legends
  const legendHTML = topData.map((item, idx) => `
    <div class="legend-item">
      <div class="legend-color" style="background-color:${colors[idx]}"></div>
      <span>${item.category}</span>
    </div>
  `).join("");

  const barLegend = document.getElementById('barChartLegend');
  if (barLegend) barLegend.innerHTML = legendHTML;

  const donutLegend = document.getElementById('donutLegend');
  if (donutLegend) donutLegend.innerHTML = legendHTML;
}