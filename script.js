// Global variable to hold the data after parsing
let currentParsedData = null; 

document.addEventListener('DOMContentLoaded', function() {
    // Set up event listeners
    document.getElementById('parseButton').addEventListener('click', parseTransaction);
    document.getElementById('addTransaction').addEventListener('click', addTransactionToList);
});

function parseTransaction() {
    const message = document.getElementById('transactionInput').value.trim();
    const resultsDiv = document.getElementById('parsedResults');
    
    if (!message) {
        alert('Please enter a transaction message');
        return;
    }

    // Regex for: UB6676349H Confirmed. Ksh50.00 sent to...
    const regex = /^([A-Z0-9]+)\s+Confirmed\.\s+Ksh([\d,.]+)\s+sent\s+to\s+.*?\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s*[APM]+)\.\s+New\s+M-PESA\s+balance\s+is\s+Ksh([\d,.]+)\.\s+Transaction\s+cost,\s+Ksh([\d,.]+)/i;

    const match = message.match(regex);

    if (match) {
        const [ , code, amount, date, time, balance, fee] = match;

        // Clean numbers (remove commas) and convert to Float
        const cleanAmount = parseFloat(amount.replace(/,/g, ''));
        const cleanFee = parseFloat(fee.replace(/,/g, ''));
        const cleanBalance = parseFloat(balance.replace(/,/g, ''));

        // 1. STORE DATA GLOBALLY (This fixes your error)
        currentParsedData = {
            code: code,
            date: date + ' ' + time, // Combine date and time
            amount: cleanAmount,
            fee: cleanFee,
            balance: cleanBalance,
            rawDate: date, // Keep original if needed
            rawTime: time
        };

        // 2. Display Results
        resultsDiv.innerHTML = `
            <div style="background: #e6fffa; padding: 15px; border-left: 4px solid #00b894; border-radius: 4px;">
                <p><strong>Code:</strong> ${code}</p>
                <p><strong>Date:</strong> ${date} ${time}</p>
                <p><strong>Amount:</strong> Ksh ${cleanAmount.toFixed(2)}</p>
                <p><strong>Fee:</strong> Ksh ${cleanFee.toFixed(2)}</p>
                <p><strong>Balance:</strong> Ksh ${cleanBalance.toFixed(2)}</p>
            </div>
        `;
    } else {
        // Reset global data if parse fails
        currentParsedData = null;
        resultsDiv.innerHTML = '<p style="color: #d63031;">Could not parse transaction. Please check the format.</p>';
    }
}

function addTransactionToList() {
    // 1. CHECK IF WE HAVE PARSED DATA
    if (!currentParsedData) {
        alert('Please click "Parse Transaction" first to verify the details.');
        return;
    }
    
    // 2. CHECK CATEGORY
    const category = document.getElementById('categorySelect').value;
    if (!category) {
        alert('Please select a category from the dropdown.');
        return;
    }
    
    // 3. CREATE FINAL TRANSACTION OBJECT
    const transaction = {
        date: currentParsedData.date,
        code: currentParsedData.code,
        amount: currentParsedData.amount,
        fee: currentParsedData.fee,
        category: category,
        totalAmount: currentParsedData.amount + currentParsedData.fee,
        timestamp: new Date().getTime() // Used for sorting
    };
    
    // 4. SAVE TO LOCAL STORAGE
    let transactions = JSON.parse(localStorage.getItem('budgetTrackerTransactions') || '[]');
    transactions.push(transaction);
    localStorage.setItem('budgetTrackerTransactions', JSON.stringify(transactions));
    
    // 5. SUCCESS FEEDBACK
    alert('Transaction added successfully!');
    
    // 6. CLEAR FORM
    document.getElementById('transactionInput').value = '';
    document.getElementById('categorySelect').value = '';
    document.getElementById('parsedResults').innerHTML = '';
    currentParsedData = null; // Reset the global variable
}