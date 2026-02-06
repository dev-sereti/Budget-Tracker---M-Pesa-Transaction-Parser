// 1. Initialize variables
let allTransactions = [];

// 2. Load data when the page opens
document.addEventListener('DOMContentLoaded', function() {
    // Fetch data from LocalStorage
    const storedData = localStorage.getItem('budgetTrackerTransactions');

    if (storedData) {
        allTransactions = JSON.parse(storedData);
        // Sort by timestamp descending (newest first) if timestamp exists
        allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    // Initial Render (Show all)
    renderTable(allTransactions);

    // Setup Event Listeners
    document.getElementById('filterSelect').addEventListener('change', filterTransactions);
    document.getElementById('downloadExcel').addEventListener('click', downloadExcel);
});

// 3. Function to draw the table rows
function renderTable(data) {
    const tbody = document.getElementById('transactionsBody');
    tbody.innerHTML = ''; // Clear existing rows

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">No transactions found.</td></tr>';
        return;
    }

    // Loop through data and create rows
    data.forEach(t => {
        const row = document.createElement('tr');

        // Calculate total if not already there
        const total = (t.totalAmount !== undefined) ? t.totalAmount : (t.amount + t.fee);

        row.innerHTML = `
            <td>${t.date}</td>
            <td>${t.code}</td>
            <td>Ksh ${parseFloat(t.amount).toFixed(2)}</td>
            <td>Ksh ${parseFloat(t.fee).toFixed(2)}</td>
            <td><span class="category-badge">${t.category}</span></td>
            <td style="font-weight:bold;">Ksh ${parseFloat(total).toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });
}

// 4. Function to Filter (Today, Week, Month)
function filterTransactions() {
    const filterType = document.getElementById('filterSelect').value;
    const now = new Date();

    let filteredData = allTransactions.filter(t => {
        if (!t.timestamp) return true; // Keep if no timestamp (legacy data)

        const tDate = new Date(t.timestamp);

        if (filterType === 'all') return true;

        if (filterType === 'today') {
            return tDate.toDateString() === now.toDateString();
        }

        if (filterType === 'thisWeek') {
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(now.getDate() - 7);
            return tDate >= oneWeekAgo;
        }

        if (filterType === 'thisMonth') {
            return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
        }

        return true;
    });

    renderTable(filteredData);
}

// 5. Excel Download Function (with Balance column)
function downloadExcel() {
    if (allTransactions.length === 0) {
        alert("No transactions to download.");
        return;
    }

    // Format data for Excel with Balance column
    const excelData = allTransactions.map(t => ({
        "Date": t.date,
        "Transaction Code": t.code,
        "Amount (Ksh)": t.amount,
        "Transaction Fee (Ksh)": t.fee,
        "Category": t.category,
        "Total Amount (Ksh)": t.totalAmount || (t.amount + t.fee),
        "Balance (Ksh)": t.balance || 0  // Add the balance column
    }));

    // Generate Sheet
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");

    // Save File
    XLSX.writeFile(wb, "Budget_Report.xlsx");
}