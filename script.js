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

        // Clean numbers and convert to Float
        const cleanAmount = parseFloat(amount.replace(/,/g, ''));
        const cleanFee = parseFloat(fee.replace(/,/g, ''));
        const cleanBalance = parseFloat(balance.replace(/,/g, ''));

        // Store data globally
        currentParsedData = {
            code,
            date,
            time,
            amount: cleanAmount,
            fee: cleanFee,
            balance: cleanBalance // Stored as a number
        };

        // Display Results
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
        currentParsedData = null;
        resultsDiv.innerHTML = '<p style="color: #d63031;">Could not parse transaction. Please check the format.</p>';
    }
}

function addTransactionToList() {
    if (!currentParsedData) {
        alert('Please parse a valid transaction first.');
        return;
    }
    
    const category = document.getElementById('categorySelect').value;
    if (!category) {
        alert('Please select a category.');
        return;
    }
    
    // Create final transaction object
    const transaction = {
        date: `${currentParsedData.date} ${currentParsedData.time}`,
        code: currentParsedData.code,
        amount: currentParsedData.amount,
        fee: currentParsedData.fee,
        balance: currentParsedData.balance, // This is now guaranteed to be a number
        category: category,
        totalAmount: currentParsedData.amount + currentParsedData.fee,
        timestamp: Date.now()
    };
    
    // Save to Local Storage
    let transactions = JSON.parse(localStorage.getItem('budgetTrackerTransactions') || '[]');
    transactions.push(transaction);
    localStorage.setItem('budgetTrackerTransactions', JSON.stringify(transactions));
    
    alert('Transaction added successfully!');
    
    // Clear form
    document.getElementById('transactionInput').value = '';
    document.getElementById('categorySelect').value = '';
    document.getElementById('parsedResults').innerHTML = '';
    currentParsedData = null;
}