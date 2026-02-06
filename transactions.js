let allTransactions = [];

document.addEventListener('DOMContentLoaded', function() {
    const storedData = localStorage.getItem('budgetTrackerTransactions');
    
    if (storedData) {
        allTransactions = JSON.parse(storedData);
        allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    renderTable(allTransactions.slice(0, 10)); // Initially show the latest 10

    document.getElementById('filterSelect').addEventListener('change', filterTransactions);
    document.getElementById('downloadExcel').addEventListener('click', downloadExcel);
});

function renderTable(data) {
    const tbody = document.getElementById('transactionsBody');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px;">No transactions found.</td></tr>';
        return;
    }

    data.forEach(t => {
        const row = document.createElement('tr');
        
        const total = t.totalAmount || (t.amount + t.fee);

        // FIX: Safely handle balance display to avoid NaN
        const balanceCell = (t.balance !== undefined && t.balance !== null)
            ? `Ksh ${parseFloat(t.balance).toFixed(2)}`
            : '-';

        row.innerHTML = `
            <td>${t.date}</td>
            <td>${t.code}</td>
            <td>Ksh ${parseFloat(t.amount || 0).toFixed(2)}</td>
            <td>Ksh ${parseFloat(t.fee || 0).toFixed(2)}</td>
            <td><span class="category-badge">${t.category}</span></td>
            <td style="font-weight:bold;">Ksh ${parseFloat(total || 0).toFixed(2)}</td>
            <td>${balanceCell}</td>
        `;
        tbody.appendChild(row);
    });
}

function filterTransactions() {
    const filterType = document.getElementById('filterSelect').value;
    const now = new Date();
    
    let dataToRender;

    if (filterType === 'all') {
        dataToRender = allTransactions.slice(0, 10);
    } else {
        const filtered = allTransactions.filter(t => {
            if (!t.timestamp) return false;
            
            const tDate = new Date(t.timestamp);
            if (filterType === 'today') return tDate.toDateString() === now.toDateString();
            if (filterType === 'thisWeek') {
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(now.getDate() - 7);
                return tDate >= oneWeekAgo;
            }
            if (filterType === 'thisMonth') {
                return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
            }
            return false;
        });
        dataToRender = filtered;
    }
    renderTable(dataToRender);
}

function downloadExcel() {
    if (allTransactions.length === 0) {
        alert("No transactions to download.");
        return;
    }

    const excelData = allTransactions.map(t => ({
        "Date": t.date,
        "Transaction Code": t.code,
        "Amount (Ksh)": t.amount || 0,
        "Transaction Fee (Ksh)": t.fee || 0,
        "Category": t.category,
        "Total Amount (Ksh)": t.totalAmount || (t.amount + t.fee),
        "Balance (Ksh)": (t.balance !== undefined && t.balance !== null) ? t.balance : '' // Empty cell if no balance
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, "Budget_Report.xlsx");
}