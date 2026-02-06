// Global variables to store transactions
let transactions = [];
let filteredTransactions = [];

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Load saved transactions from localStorage
    loadTransactions();
    
    // Set up event listeners
    document.getElementById('parseButton').addEventListener('click', parseTransaction);
    document.getElementById('addTransaction').addEventListener('click', addTransactionToList);
    document.getElementById('downloadExcel').addEventListener('click', downloadExcel);
    document.getElementById('filterSelect').addEventListener('change', filterTransactions);
    
    // Display existing transactions
    renderTransactions();
});

// Parse M-Pesa transaction message
function parseTransaction() {
    const message = document.getElementById('transactionInput').value.trim();
    const resultsDiv = document.getElementById('parsedResults');
    
    if (!message) {
        alert('Please enter a transaction message');
        return;
    }

    try {
        // Updated Regex to match the message in your screenshot:
        // Group 1: Transaction Code (e.g., UB6676349H)
        // Group 2: Amount (e.g., 50.00)
        // Group 3: Date (e.g., 6/2/26)
        // Group 4: Time (e.g., 7:17 AM)
        // Group 5: Balance (e.g., 371.32)
        // Group 6: Transaction Cost/Fee (e.g., 0.00)
        
        const regex = /^([A-Z0-9]+)\s+Confirmed\.\s+Ksh([\d,.]+)\s+sent\s+to\s+.*?\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s*[APM]+)\.\s+New\s+M-PESA\s+balance\s+is\s+Ksh([\d,.]+)\.\s+Transaction\s+cost,\s+Ksh([\d,.]+)/i;

        const match = message.match(regex);

        if (match) {
            const [ , code, amount, date, time, balance, fee] = match;

            // Clean numbers (remove commas)
            const cleanAmount = parseFloat(amount.replace(/,/g, ''));
            const cleanFee = parseFloat(fee.replace(/,/g, ''));
            const cleanBalance = parseFloat(balance.replace(/,/g, ''));

            // Display Results
            resultsDiv.innerHTML = `
                <div class="success-parse">
                    <p><strong>Code:</strong> ${code}</p>
                    <p><strong>Date/Time:</strong> ${date} at ${time}</p>
                    <p><strong>Amount:</strong> Ksh ${cleanAmount.toFixed(2)}</p>
                    <p><strong>Fee:</strong> Ksh ${cleanFee.toFixed(2)}</p>
                    <p><strong>New Balance:</strong> Ksh ${cleanBalance.toFixed(2)}</p>
                    <p><strong>Total Deducted:</strong> Ksh ${(cleanAmount + cleanFee).toFixed(2)}</p>
                </div>
            `;
            
            // Store globally for the "Add to List" button
            window.lastParsedData = {
                code, 
                amount: cleanAmount, 
                date, 
                time, 
                fee: cleanFee, 
                balance: cleanBalance
            };

        } else {
            resultsDiv.innerHTML = '<p style="color: red;">Could not parse transaction. Please check the format.</p>';
            window.lastParsedData = null;
        }
    } catch (error) {
        console.error("Parsing error:", error);
        resultsDiv.innerHTML = '<p style="color: red;">An error occurred during parsing.</p>';
    }
}

// Updated "Add to List" function to use the parsed data
function addTransactionToList() {
    const category = document.getElementById('categorySelect').value;
    
    if (!window.lastParsedData) {
        alert('Please parse a valid transaction first.');
        return;
    }
    if (!category) {
        alert('Please select a category.');
        return;
    }

    const transaction = {
        ...window.lastParsedData,
        category: category,
        totalAmount: window.lastParsedData.amount + window.lastParsedData.fee,
        timestamp: new Date().getTime() // For sorting
    };

    // Save to LocalStorage
    let transactions = JSON.parse(localStorage.getItem('budgetTrackerTransactions') || '[]');
    transactions.push(transaction);
    localStorage.setItem('budgetTrackerTransactions', JSON.stringify(transactions));

    // Feedback and Clear
    alert('Transaction saved successfully!');
    document.getElementById('transactionInput').value = '';
    document.getElementById('parsedResults').innerHTML = '';
    document.getElementById('categorySelect').value = '';
}

// Display parsed results
function displayParsedResults(date, time, code, amount, fee, balance) {
    // Format amounts (remove commas)
    const formattedAmount = parseFloat(amount.replace(/,/g, '')) || 0;
    const formattedFee = parseFloat(fee.replace(/,/g, '')) || 0;
    
    const totalAmount = formattedAmount + formattedFee;
    
    const resultsHTML = `
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Time:</strong> ${time}</p>
        <p><strong>Transaction Code:</strong> ${code}</p>
        <p><strong>Amount:</strong> Ksh ${formattedAmount.toFixed(2)}</p>
        <p><strong>Fee:</strong> Ksh ${formattedFee.toFixed(2)}</p>
        <p><strong>Balance:</strong> Ksh ${balance}</p>
        <p><strong>Total Amount:</strong> Ksh ${totalAmount.toFixed(2)}</p>
    `;
    
    document.getElementById('parsedResults').innerHTML = resultsHTML;
}

// Add transaction to list
function addTransactionToList() {
    const message = document.getElementById('transactionInput').value.trim();
    if (!message) {
        alert('Please enter a transaction message');
        return;
    }
    
    const category = document.getElementById('categorySelect').value;
    if (!category) {
        alert('Please select a category');
        return;
    }
    
    // Parse the transaction again to get data
    const regex = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+.*?(\w{10,15})\s+Ksh\s*([\d,]+(?:\.\d+)?)\s+.*?Ksh\s*([\d,]+(?:\.\d+)?)\s+.*?Ksh\s*([\d,]+(?:\.\d+)?)/i;
    const match = message.match(regex);
    
    if (!match) {
        // Try alternative pattern
        const altRegex = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+.*?(\w{10,15})\s+Ksh\s*([\d,]+(?:\.\d+)?)\s+.*?Ksh\s*([\d,]+(?:\.\d+)?)\s+.*?balance\s+Ksh\s*([\d,]+(?:\.\d+)?)/i;
        const altMatch = message.match(altRegex);
        
        if (!altMatch) {
            alert('Could not parse transaction. Please check the format.');
            return;
        }
        
        // Use alternate match
        const [, date, time, code, amountStr, feeStr, balance] = altMatch;
        addTransactionToStorage(date, time, code, amountStr, feeStr, balance, category);
    } else {
        // Use primary match
        const [, date, time, code, amountStr, feeStr, balance] = match;
        addTransactionToStorage(date, time, code, amountStr, feeStr, balance, category);
    }
}

// Add transaction to storage
function addTransactionToStorage(date, time, code, amountStr, feeStr, balance, category) {
    // Format amounts (remove commas)
    const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
    const fee = parseFloat(feeStr.replace(/,/g, '')) || 0;
    const totalAmount = amount + fee;
    
    // Create transaction object
    const transaction = {
        date: date,
        time: time,
        code: code,
        amount: amount,
        fee: fee,
        balance: balance,
        category: category,
        totalAmount: totalAmount,
        timestamp: new Date(`${date} ${time}`).getTime()
    };
    
    // Add to transactions array
    transactions.push(transaction);
    
    // Save to localStorage
    saveTransactions();
    
    // Clear input fields
    document.getElementById('transactionInput').value = '';
    document.getElementById('categorySelect').value = '';
    document.getElementById('parsedResults').innerHTML = '';
    
    // Update the display
    renderTransactions();
}

// Render transactions in table
function renderTransactions() {
    const tableBody = document.getElementById('transactionsBody');
    tableBody.innerHTML = '';
    
    // Get latest 10 transactions or filtered transactions
    const displayTransactions = filteredTransactions.length > 0 ? filteredTransactions : 
        transactions.slice().reverse().slice(0, 10);
    
    displayTransactions.forEach(transaction => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${transaction.date} ${transaction.time}</td>
            <td>${transaction.code}</td>
            <td>Ksh ${transaction.amount.toFixed(2)}</td>
            <td>Ksh ${transaction.fee.toFixed(2)}</td>
            <td>${transaction.category}</td>
            <td>Ksh ${transaction.totalAmount.toFixed(2)}</td>
        `;
        tableBody.appendChild(row);
    });
}

// Filter transactions
function filterTransactions() {
    const filterValue = document.getElementById('filterSelect').value;
    const now = new Date();
    
    switch(filterValue) {
        case 'today':
            filteredTransactions = transactions.filter(t => {
                const transactionDate = new Date(`${t.date} ${t.time}`);
                return transactionDate.toDateString() === now.toDateString();
            });
            break;
        case 'thisWeek':
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            startOfWeek.setHours(0, 0, 0, 0);
            
            filteredTransactions = transactions.filter(t => {
                const transactionDate = new Date(`${t.date} ${t.time}`);
                return transactionDate >= startOfWeek;
            });
            break;
        case 'thisMonth':
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            filteredTransactions = transactions.filter(t => {
                const transactionDate = new Date(`${t.date} ${t.time}`);
                return transactionDate >= startOfMonth;
            });
            break;
        default:
            filteredTransactions = [];
    }
    
    renderTransactions();
}

// Download Excel file
function downloadExcel() {
    if (transactions.length === 0) {
        alert('No transactions to download');
        return;
    }
    
    // Prepare data for Excel
    const excelData = transactions.map(t => ({
        'Date': `${t.date} ${t.time}`,
        'Transaction Code': t.code,
        'Amount': t.amount,
        'Transaction Fee': t.fee,
        'Category': t.category,
        'Total Amount': t.totalAmount
    }));
    
    // Create worksheet
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    
    // Generate Excel file
    XLSX.writeFile(wb, 'budget_transactions.xlsx');
}

// Save transactions to localStorage
function saveTransactions() {
    localStorage.setItem('budgetTrackerTransactions', JSON.stringify(transactions));
}

// Load transactions from localStorage
function loadTransactions() {
    const saved = localStorage.getItem('budgetTrackerTransactions');
    if (saved) {
        try {
            transactions = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading transactions:', e);
            transactions = [];
        }
    }
}