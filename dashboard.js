let monthlyIncome = 0;

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

// Stable mapping: category
const categoryColorMap = new Map();
function getColorForCategory(category) {
  if (categoryColorMap.has(category)) return categoryColorMap.get(category);
  const idx = categoryColorMap.size % CATEGORY_COLORS.length;
  const color = CATEGORY_COLORS[idx];
  categoryColorMap.set(category, color);
  return color;
}

  //  Date helpers (filter ranges)
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

  //  Transaction date normalization
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
      const b = Number(String(tx.balance).replace(/ksh/ig, "").replace(/,/g, "").trim());
      tx.balance = Number.isFinite(b) ? b : null;
    } else {
      tx.balance = null;
    }
  });

  return { list, changed };
}
document.addEventListener('DOMContentLoaded', function () {
  loadData();

  const setBtn = document.getElementById('setIncome');
  if (setBtn) setBtn.addEventListener('click', setMonthlyIncome);

  initCharts();
  setupPeriodFilter();

  // Default: This Month
  applyPresetFilter("thisMonth");
});

function loadData() {
  monthlyIncome = parseFloat(localStorage.getItem('monthlyIncome') || '0');
  if (monthlyIncome > 0) document.getElementById('monthlyIncome').value = monthlyIncome;

  const saved = localStorage.getItem('budgetTrackerTransactions');
  allTransactions = saved ? JSON.parse(saved) : [];

  const normalized = normalizeTransactions(allTransactions);
  allTransactions = normalized.list;

  if (normalized.changed) {
    localStorage.setItem('budgetTrackerTransactions', JSON.stringify(allTransactions));
  }
}
function setupPeriodFilter() {
  const btnWrap = document.getElementById("dashPeriodButtons");
  const customBox = document.getElementById("dashCustomRange");
  const applyBtn = document.getElementById("dashApplyCustom");

  // If HTML not added yet, just return safely
  if (!btnWrap) return;

  // Click via event delegation
  btnWrap.addEventListener("click", (e) => {
    e.preventDefault();

    const btn = e.target.closest(".chip");
    if (!btn) return;

    const period = btn.dataset.period;
    setActiveChip(btnWrap, period);

    if (period === "custom") {
      // show custom inputs
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
    lbl.textContent = `${label}: ${new Date(startMs).toLocaleDateString()} → ${new Date(endMs).toLocaleDateString()}`;
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
    lbl.textContent = `Custom: ${new Date(startMs).toLocaleDateString()} → ${new Date(endMs).toLocaleDateString()}`;
  }

  updateFromFiltered();
}

  //  Budget handling
function setMonthlyIncome() {
  const input = document.getElementById('monthlyIncome');
  const value = parseFloat(input.value);

  if (isNaN(value) || value < 0) {
    alert("Please enter a valid non-negative number.");
    return;
  }

  monthlyIncome = value;
  localStorage.setItem('monthlyIncome', monthlyIncome.toString());

  // Recompute KPIs based on current filtered data
  updateFromFiltered();
}

  //  Totals + Charts
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
  return `Ksh ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function initCharts() {
  // DOUGHNUT CHART
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
        legend: { display: false }, // we use HTML legends
        tooltip: {
          callbacks: {
            label: (context) => `${context.label || ''}: ${formatCurrency(context.raw || 0)}`
          }
        }
      }
    }
  });

  // BAR CHART
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
  // if nothing filtered yet, default to all for first render
  const list = filteredTransactions.length ? filteredTransactions : allTransactions;

  calculateCategoryTotals(list);

  // KPIs based on list
  const totalSpent = list.reduce((sum, t) => sum + Number(t.totalAmount || 0), 0);
  const remainingBalance = monthlyIncome - totalSpent;
  const savingsRate = monthlyIncome > 0 ? (remainingBalance / monthlyIncome) * 100 : 0;

  document.getElementById('totalSpent').textContent = formatCurrency(totalSpent);
  document.getElementById('remainingBalance').textContent = formatCurrency(remainingBalance);
  document.getElementById('savingsRate').textContent = `${savingsRate.toFixed(1)}%`;
  document.getElementById('donutCenterValue').textContent = formatCurrency(totalSpent);

  // Top N + Others
  const topData = getTopCategoriesWithOthers(categoryTotals, TOP_N_CATEGORIES);

  // colors by category
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

  // Update HTML legends (bar + optional donut legend)
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