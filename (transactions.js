document.addEventListener('DOMContentLoaded', function() {
    loadAndRender();

    document.getElementById('filterSelect').addEventListener('change', filterTransactions);
    document.getElementById('downloadExcel').addEventListener('click', downloadExcel);
});

let allTransactions = [];

function loadAndRender() {
    const saved = localStorage.getItem('budgetTrackerTransactions');
    allTransactions = saved ? JSON.parse(saved) : [];
    renderTable(allTransactions.slice().reverse().slice(0, 10)); // Default to last 10
}

function renderTable(data) {
    const tbody = document.getElementById('transactionsBody');
    tbody.innerHTML = '';

    data.forEach(t => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${t.date}</td>
            <td>${t.code}</td>
            <td>${t.amount.toFixed(2)}</td>
            <td>${t.fee.toFixed(2)}</td>
            <td><span class="category-tag">${t.category}</span></td>
            <td><strong>${(t.amount + t.fee).toFixed(2)}</strong></td>
        `;
        tbody.appendChild(row);
    });
}

function filterTransactions() {
    const val = document.getElementById('filterSelect').value;
    const now = new Date();
    let filtered = [...allTransactions];

    if (val === 'today') {
        filtered = allTransactions.filter(t => new Date(t.date).toDateString() === now.toDateString());
    } else if (val === 'thisWeek') {
        const weekAgo = new Date().setDate(now.getDate() - 7);
        filtered = allTransactions.filter(t => new Date(t.date) >= weekAgo);
    } else if (val === 'thisMonth') {
        filtered = allTransactions.filter(t => new Date(t.date).getMonth() === now.getMonth());
    }

    renderTable(filtered.reverse());
}

function downloadExcel() {
    if (allTransactions.length === 0) return alert("No data to export");

    const dataForExcel = allTransactions.map(t => ({
        "Date": t.date,
        "Transaction Code": t.code,
        "Amount": t.amount,
        "Transaction Fee": t.fee,
        "Category": t.category,
        "Total Amount": (t.amount + t.fee)
    }));

    const ws = XLSX.utils.json_to_sheet(dataForExcel);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, "MPesa_Budget_Report.xlsx");
}