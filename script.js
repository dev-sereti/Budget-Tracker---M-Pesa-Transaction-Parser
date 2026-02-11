// transactions.js (combined parser + transactions list)
// Configure if your backend runs on another host/port:
// const API_BASE = 'http://localhost:3000';
const API_BASE = ''; // keep empty for same-origin relative '/api/...'

/* Globals */
let allTransactions = [];
let filteredTransactions = [];
let currentPeriod = 'thisMonth';
let isSearchActive = false;
let currentParsedData = null;

/* Helper to build API URL */
function apiUrl(path) {
  return (API_BASE ? API_BASE.replace(/\/$/, '') : '') + path;
}

/* Utility: parse numbers with commas */
function toNumberOr(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/* Format date for display like "4/2/26 5:55 PM" (two-digit year) */
function formatDateDisplay(ms) {
  const d = new Date(Number(ms) || Date.now());
  const yy = String(d.getFullYear()).slice(-2);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  let hh = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${m}/${day}/${yy} ${hh}:${minutes} ${ampm}`;
}

/* Guess transaction timestamp from various fields or fallback to now.
   Accepts tx objects that may have .timestamp, .date strings like "6/2/26 7:17 AM", etc. */
function guessTxDateMs(tx) {
  if (tx == null) return Date.now();

  // Prefer numeric timestamp property if present
  if (Number.isFinite(tx.timestamp)) return Number(tx.timestamp);
  if (Number.isFinite(tx.txDateMs)) return Number(tx.txDateMs);

  // Try parsing date/time string if present e.g. "6/2/26 7:17 AM" or tx.date and tx.time
  const raw = (tx.date && tx.time) ? `${tx.date} ${tx.time}` : (tx.date || tx.message || tx.text || '');
  const m = String(raw).trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([APMapm]+)$/i
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

  // Fallback
  return Date.now();
}

/* Normalize a variety of backend payload shapes into a consistent array of objects
   Fields produced: code, date (display string), amount (number), fee (number),
   balance (number|null), totalAmount (number), txDateMs (number), category, timestamp */
function normalizeTransactions(raw) {
  let list = [];
  if (!raw) {
    list = [];
  } else if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && Array.isArray(raw.list)) {
    list = raw.list;
  } else if (raw && Array.isArray(raw.data)) {
    list = raw.data;
  } else {
    list = [];
  }

  const normalized = list.map(item => {
    const txDateMs = item.txDateMs || item.timestamp || guessTxDateMs(item);
    const amount = toNumberOr(item.amount, 0);
    const fee = toNumberOr(item.fee, 0);
    const balance = (item.balance === null || item.balance === undefined) ? null : toNumberOr(item.balance, null);
    const totalAmount = (item.totalAmount !== undefined && item.totalAmount !== null)
      ? toNumberOr(item.totalAmount, +(amount + fee))
      : +(amount + fee).toFixed(2);

    const code = item.code || item.transactionCode || item.txn || item.reference || '';
    const category = item.category || 'Others';
    const dateDisplay = item.date || formatDateDisplay(txDateMs);
    const timestamp = item.timestamp || Date.now();

    return {
      ...item,
      code,
      date: dateDisplay,
      amount,
      fee,
      balance,
      totalAmount,
      txDateMs,
      timestamp,
      category
    };
  });

  return { list: normalized };
}

/* -----------------------
   TRANSACTIONS: load + render + period filter + Excel + search
   ----------------------- */

async function loadTransactions() {
  try {
    const token = localStorage.getItem('token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(apiUrl('/api/transactions'), { headers });
    if (!res.ok) throw new Error(`Failed to load transactions (${res.status})`);
    const data = await res.json();
    const normalized = normalizeTransactions(data);
    allTransactions = normalized.list;
    console.log('Loaded transactions:', allTransactions.length);
  } catch (err) {
    console.error('Error loading transactions:', err);
    allTransactions = [];
  }
}

/* Date helpers */
function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0,0,0,0);
  return d.getTime();
}
function endOfDay(ms) {
  const d = new Date(ms);
  d.setHours(23,59,59,999);
  return d.getTime();
}
function startOfThisWeek(now = new Date()) {
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0,0,0,0);
  return monday.getTime();
}
function getPresetRange(period) {
  const now = new Date();
  if (period === 'today') {
    return { startMs: startOfDay(now.getTime()), endMs: endOfDay(now.getTime()), label: 'Today' };
  }
  if (period === 'thisWeek') {
    return { startMs: startOfThisWeek(now), endMs: endOfDay(now.getTime()), label: 'This Week' };
  }
  if (period === 'lastWeek') {
    const thisWeekStart = startOfThisWeek(now);
    const lastWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;
    const lastWeekEnd = thisWeekStart - 1;
    return { startMs: lastWeekStart, endMs: lastWeekEnd, label: 'Last Week' };
  }
  // thisMonth
  const msStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const msEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
  return { startMs: startOfDay(msStart), endMs: endOfDay(msEnd), label: 'This Month' };
}

/* Fetch transactions for a preset period from backend */
async function applyPresetFilter(period) {
  currentPeriod = period;
  const range = getPresetRange(period);
  const labelEl = document.getElementById('txRangeLabel');
  if (labelEl) {
    labelEl.textContent = `${range.label}: ${new Date(range.startMs).toLocaleDateString()} → ${new Date(range.endMs).toLocaleDateString()}`;
  }

  try {
    const token = localStorage.getItem('token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(apiUrl(`/api/transactions?startMs=${range.startMs}&endMs=${range.endMs}`), { headers });
    if (!res.ok) throw new Error(`Failed to fetch filtered transactions (${res.status})`);
    const data = await res.json();
    const normalized = normalizeTransactions(data);
    filteredTransactions = normalized.list;
  } catch (err) {
    console.error('Error fetching filtered transactions:', err);
    filteredTransactions = [];
  }

  renderTable(filteredTransactions);
}

/* Custom date-range apply */
async function applyCustomFilter() {
  const fromVal = document.getElementById('txDateFrom') && document.getElementById('txDateFrom').value;
  const toVal = document.getElementById('txDateTo') && document.getElementById('txDateTo').value;
  if (!fromVal || !toVal) return alert('Please select both Date From and Date To.');
  const startMs = startOfDay(new Date(fromVal).getTime());
  const endMs = endOfDay(new Date(toVal).getTime());
  if (endMs < startMs) return alert('Date To must be on/after Date From.');
  const labelEl = document.getElementById('txRangeLabel');
  if (labelEl) {
    labelEl.textContent = `Custom: ${new Date(startMs).toLocaleDateString()} → ${new Date(endMs).toLocaleDateString()}`;
  }

  try {
    const token = localStorage.getItem('token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(apiUrl(`/api/transactions?startMs=${startMs}&endMs=${endMs}`), { headers });
    if (!res.ok) throw new Error(`Failed to fetch filtered transactions (${res.status})`);
    const data = await res.json();
    const normalized = normalizeTransactions(data);
    filteredTransactions = normalized.list;
  } catch (err) {
    console.error('Error fetching filtered transactions:', err);
    filteredTransactions = [];
  }

  renderTable(filteredTransactions);
}

/* Period filter UI wiring (chips + custom box) */
function setupPeriodFilter() {
  const btnWrap = document.getElementById('txPeriodButtons');
  const customBox = document.getElementById('txCustomRange');
  const applyBtn = document.getElementById('txApplyCustom');
  if (!btnWrap) return;

  btnWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    const period = btn.dataset.period;
    setActiveChip(btnWrap, period);

    // If a search was active, clear it
    if (isSearchActive) {
      clearSearch(); // will reset UI and re-apply period below
    }

    if (period === 'custom') {
      currentPeriod = 'custom';
      if (customBox) customBox.classList.add('show');
      const labelEl = document.getElementById('txRangeLabel');
      if (labelEl) labelEl.textContent = 'Select Date From and Date To, then click Apply.';
      filteredTransactions = [];
      renderTable(filteredTransactions);
      return;
    }

    if (customBox) customBox.classList.remove('show');
    applyPresetFilter(period);
  });

  if (applyBtn) applyBtn.addEventListener('click', applyCustomFilter);
}

function setActiveChip(container, period) {
  if (!container) return;
  [...container.querySelectorAll('.chip')].forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });
}

/* Render table */
function renderTable(rows, highlightQuery = '') {
  const tbody = document.getElementById('transactionsBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#666;">
      No transactions found${isSearchActive ? ' for this search.' : ' for this period.'}
    </td></tr>`;
    return;
  }

  const sorted = rows.slice().sort((a, b) => b.txDateMs - a.txDateMs);

  sorted.forEach(tx => {
    const row = document.createElement('tr');
    // Mark highlight if search query provided
    let highlightClass = '';
    if (highlightQuery) {
      const code = (tx.code || '').toLowerCase();
      const q = highlightQuery.toLowerCase();
      if (code === q || code.includes(q)) highlightClass = 'highlight-row';
    }

    row.className = highlightClass;
    row.innerHTML = `
      <td>${tx.date || '-'}</td>
      <td>${tx.code || '-'}</td>
      <td>Ksh ${tx.amount.toFixed(2)}</td>
      <td>Ksh ${tx.fee.toFixed(2)}</td>
      <td><span class="category-badge">${tx.category || 'Others'}</span></td>
      <td><b>Ksh ${tx.totalAmount.toFixed(2)}</b></td>
      <td>${tx.balance === null ? '-' : `Ksh ${Number(tx.balance).toFixed(2)}`}</td>
    `;
    tbody.appendChild(row);
  });

  if (highlightQuery) {
    const firstHighlight = tbody.querySelector('.highlight-row');
    if (firstHighlight) {
      setTimeout(() => firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    }
  }
}

/* Excel export: filtered if available, otherwise all */
function exportFilteredExcel() {
  if (typeof XLSX === 'undefined') {
    return alert('XLSX library is not loaded. Make sure you included xlsx.full.min.js in the page.');
  }
  const data = (filteredTransactions && filteredTransactions.length) ? filteredTransactions : allTransactions;
  if (!data || !data.length) return alert('No data to export.');

  const excelData = data.map(tx => ({
    Date: tx.date || '',
    'Transaction Code': tx.code || '',
    Amount: tx.amount,
    'Transaction Fee': tx.fee,
    Category: tx.category || 'Others',
    'Total Amount': tx.totalAmount,
    Balance: tx.balance === null ? '' : tx.balance
  }));

  const ws = XLSX.utils.json_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  XLSX.writeFile(wb, 'Budget_Transactions.xlsx');
}

/* -----------------------
   Search by transaction code UI
   ----------------------- */
function setupSearch() {
  const txSearchInput = document.getElementById('txSearchInput');
  const txSearchBtn = document.getElementById('txSearchBtn');
  const txClearSearchBtn = document.getElementById('txClearSearchBtn');

  if (!txSearchInput || !txSearchBtn || !txClearSearchBtn) return;

  txSearchBtn.addEventListener('click', performSearch);
  txSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  txSearchInput.addEventListener('paste', () => {
    setTimeout(performSearch, 150); // small delay so pasted value is available
  });
  txClearSearchBtn.addEventListener('click', clearSearch);
}

function performSearch() {
  const txSearchInput = document.getElementById('txSearchInput');
  const txSearchResultLabel = document.getElementById('txSearchResultLabel');
  const query = txSearchInput ? txSearchInput.value.trim().toLowerCase() : '';

  if (!query) {
    if (txSearchResultLabel) {
      txSearchResultLabel.textContent = 'Please enter a transaction code.';
      txSearchResultLabel.style.color = '#e67e22';
    }
    return;
  }

  // Search across allTransactions (normalized)
  const pool = (allTransactions && allTransactions.length) ? allTransactions : (filteredTransactions || []);
  const matches = pool.filter(tx => {
    const code = (tx.code || '').toLowerCase();
    return code === query || code.includes(query);
  });

  if (matches.length) {
    isSearchActive = true;
    filteredTransactions = matches;

    if (txSearchResultLabel) {
      txSearchResultLabel.textContent = `✅ ${matches.length} transaction${matches.length > 1 ? 's' : ''} found!`;
      txSearchResultLabel.style.color = '#27ae60';
    }

    // Remove active state from chips
    const btnWrap = document.getElementById('txPeriodButtons');
    if (btnWrap) [...btnWrap.querySelectorAll('.chip')].forEach(b => b.classList.remove('active'));

    const txRangeLabel = document.getElementById('txRangeLabel');
    if (txRangeLabel) txRangeLabel.textContent = `Showing search results for "${txSearchInput.value.trim()}"`;

    renderTable(filteredTransactions, query);
  } else {
    isSearchActive = true;
    filteredTransactions = [];
    renderTable([]);

    if (txSearchResultLabel) {
      txSearchResultLabel.textContent = `❌ No transaction found for "${txSearchInput.value.trim()}"`;
      txSearchResultLabel.style.color = '#e74c3c';
    }
  }

  const txClearSearchBtn = document.getElementById('txClearSearchBtn');
  if (txClearSearchBtn) txClearSearchBtn.style.display = 'inline-block';
}

function clearSearch() {
  const txSearchInput = document.getElementById('txSearchInput');
  const txSearchResultLabel = document.getElementById('txSearchResultLabel');
  const txClearSearchBtn = document.getElementById('txClearSearchBtn');

  if (txSearchInput) txSearchInput.value = '';
  if (txSearchResultLabel) txSearchResultLabel.textContent = '';
  if (txClearSearchBtn) txClearSearchBtn.style.display = 'none';

  isSearchActive = false;

  // Remove highlights
  document.querySelectorAll('#transactionsBody tr').forEach(r => r.classList.remove('highlight-row'));

  // Re-apply the last active period filter (if the transactions UI exists)
  if (document.getElementById('transactionsBody')) {
    setActiveChip(document.getElementById('txPeriodButtons'), currentPeriod);
    applyPresetFilter(currentPeriod).catch(err => console.warn('Could not reapply period filter:', err));
  }
}

/* -----------------------
   Parser UI: parse SMS + add transaction (POST)
   ----------------------- */

function parseTransaction() {
  const inputEl = document.getElementById('transactionInput');
  const resultsDiv = document.getElementById('parsedResults');
  if (!inputEl) return;
  const message = inputEl.value.trim();
  if (!message) return alert('Please enter a transaction message.');

  // Permissive regex to capture code, amount, date, time, balance, fee
  // Groups: 1=code, 2=amount, 3=date (d/m/yy), 4=time (h:mm AM/PM), 5=balance, 6=fee
  const regex = /([A-Z0-9]+)\s+Confirmed\.\s+Ksh\s*([\d,]+(?:\.\d{1,2})?)\s+sent\s+to\s+[\s\S]*?\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s*[APMapm]+)\.\s+New\s+M-?PESA\s+balance\s+is\s+Ksh\s*([\d,]+(?:\.\d{1,2})?)\.\s+Transaction\s+cost[,:]?\s*Ksh\s*([\d,]+(?:\.\d{1,2})?)/i;

  const match = message.match(regex);

  if (!match) {
    currentParsedData = null;
    if (resultsDiv) {
      resultsDiv.innerHTML = '<p style="color:#d63031;">Could not parse transaction. Please check the message format.</p>';
    }
    return;
  }

  const [ , code, amountStr, dateStr, timeStr, balanceStr, feeStr ] = match;

  const cleanAmount = toNumberOr(amountStr, 0);
  const cleanFee = toNumberOr(feeStr, 0);
  const cleanBalance = toNumberOr(balanceStr, null);

  currentParsedData = {
    code: code || '',
    date: dateStr || '',
    time: timeStr || '',
    amount: cleanAmount,
    fee: cleanFee,
    balance: cleanBalance
  };

  if (resultsDiv) {
    resultsDiv.innerHTML = `
      <div style="background: #e6fffa; padding: 15px; border-left: 4px solid #00b894; border-radius: 4px;">
        <p><strong>Code:</strong> ${currentParsedData.code}</p>
        <p><strong>Date:</strong> ${currentParsedData.date} ${currentParsedData.time}</p>
        <p><strong>Amount:</strong> Ksh ${currentParsedData.amount.toFixed(2)}</p>
        <p><strong>Fee:</strong> Ksh ${currentParsedData.fee.toFixed(2)}</p>
        <p><strong>Balance:</strong> ${currentParsedData.balance === null ? '-' : `Ksh ${currentParsedData.balance.toFixed(2)}`}</p>
      </div>
    `;
  }
}

/* Convert "6/2/26" + "7:17 AM" -> milliseconds since epoch */
function parseTransactionDateTime(dateStr, timeStr) {
  const full = `${dateStr} ${timeStr}`.trim();
  const m = full.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([APMapm]+)$/i);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    let hh = Number(m[4]);
    const min = Number(m[5]);
    const ap = m[6].toUpperCase();
    if (ap === 'PM' && hh !== 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    return new Date(yy, mm, dd, hh, min, 0, 0).getTime();
  }
  return Date.now();
}

/* Add parsed transaction to backend (POST). Improved error visibility. */
async function addTransactionToList() {
  if (!currentParsedData) {
    alert('Please parse a valid transaction first.');
    return;
  }
  const categorySelect = document.getElementById('categorySelect');
  const category = categorySelect ? categorySelect.value : '';
  if (!category) return alert('Please select a category.');

  const txDateMs = parseTransactionDateTime(currentParsedData.date, currentParsedData.time);

  const transaction = {
    date: `${currentParsedData.date} ${currentParsedData.time}`,
    code: currentParsedData.code,
    amount: currentParsedData.amount,
    fee: currentParsedData.fee,
    balance: currentParsedData.balance,
    category: category,
    totalAmount: +(currentParsedData.amount + currentParsedData.fee).toFixed(2),
    txDateMs: txDateMs,
    timestamp: Date.now()
  };

  // If your backend is on another port, set API_BASE above.
  const url = apiUrl('/api/transactions');
  console.log('Posting transaction to', url, transaction);

  try {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(transaction)
    });

    const contentType = res.headers.get('content-type') || '';
    let respBody;
    if (contentType.includes('application/json')) {
      respBody = await res.json();
    } else {
      respBody = await res.text();
    }

    console.log('Server response', res.status, respBody);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('Unauthorized (401/403). Check your token or login state.');
      }
      const serverMessage = respBody && respBody.message ? respBody.message : (typeof respBody === 'string' ? respBody : JSON.stringify(respBody));
      throw new Error(`Server returned ${res.status}: ${serverMessage}`);
    }

    alert('Transaction added successfully!');

    // Clear UI
    const inputEl = document.getElementById('transactionInput');
    if (inputEl) inputEl.value = '';
    if (categorySelect) categorySelect.value = '';
    const resultsDiv = document.getElementById('parsedResults');
    if (resultsDiv) resultsDiv.innerHTML = '';
    currentParsedData = null;

    // Refresh lists if transactions UI exists
    if (document.getElementById('transactionsBody')) {
      // re-apply current period filter (makes backend query for that range)
      try {
        await applyPresetFilter(currentPeriod);
      } catch (e) {
        console.warn('Could not refresh transactions after adding:', e);
      }
    } else {
      // If transactions UI not present, reload allTransactions (if needed)
      try {
        await loadTransactions();
      } catch (e) {
        console.warn('Could not reload all transactions after adding:', e);
      }
    }

  } catch (err) {
    console.error('Error adding transaction:', err);
    // Distinguish typical network/CORS TypeError
    if (err instanceof TypeError) {
      alert('Network/CORS error while sending transaction: ' + err.message + '\nCheck backend is running and CORS is configured.');
    } else {
      alert('Error adding transaction: ' + (err.message || String(err)));
    }
  }
}

/* -----------------------
   Initialize on DOM ready: wire up listeners for elements that exist on the page
   ----------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  // Transactions page elements present?
  if (document.getElementById('transactionsBody')) {
    await loadTransactions();
    setupPeriodFilter();
    setupSearch();
    const dlBtn = document.getElementById('downloadExcel');
    if (dlBtn) dlBtn.addEventListener('click', exportFilteredExcel);

    // Default view
    try {
      await applyPresetFilter(currentPeriod);
    } catch (e) {
      console.warn('applyPresetFilter failed on load:', e);
    }
  }

  // Parser page elements present?
  if (document.getElementById('transactionInput')) {
    const parseBtn = document.getElementById('parseButton');
    if (parseBtn) parseBtn.addEventListener('click', parseTransaction);

    const addBtn = document.getElementById('addTransaction');
    if (addBtn) addBtn.addEventListener('click', addTransactionToList);

    // Optional: allow Ctrl+Enter to parse
    const txInput = document.getElementById('transactionInput');
    if (txInput) {
      txInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) parseTransaction();
      });
    }
  }
});