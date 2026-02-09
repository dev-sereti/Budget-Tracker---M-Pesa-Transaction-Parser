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

/**
 * Convert transaction date string to timestamp
 * Format: "6/2/26 7:17 AM" -> milliseconds since epoch
 */
function parseTransactionDateTime(dateStr, timeStr) {
    // Combine date and time
    const fullDateStr = `${dateStr} ${timeStr}`;
    
    // Parse "6/2/26 7:17 AM"
    const m = fullDateStr.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i
    );
    
    if (m) {
        const dd = Number(m[1]);
        const mm = Number(m[2]) - 1; // Month is 0-indexed
        let yy = Number(m[3]);
        
        // Convert 2-digit year to 4-digit (assumes 2000s)
        if (yy < 100) yy += 2000;

        let hh = Number(m[4]);
        const min = Number(m[5]);
        const ap = m[6].toUpperCase();
        
        // Convert 12-hour to 24-hour format
        if (ap === "PM" && hh !== 12) hh += 12;
        if (ap === "AM" && hh === 12) hh = 0;

        return new Date(yy, mm, dd, hh, min, 0, 0).getTime();
    }

    // Fallback to current time if parsing fails
    return Date.now();
}

async function addTransactionToList() {
    if (!currentParsedData) {
        alert('Please parse a valid transaction first.');
        return;
    }
    
    const category = document.getElementById('categorySelect').value;
    if (!category) {
        alert('Please select a category.');
        return;
    }
    
    // Parse the transaction date and time to get the actual timestamp
    const txDateMs = parseTransactionDateTime(currentParsedData.date, currentParsedData.time);
    
    // Create final transaction object
    const transaction = {
        date: `${currentParsedData.date} ${currentParsedData.time}`,
        code: currentParsedData.code,
        amount: currentParsedData.amount,
        fee: currentParsedData.fee,
        balance: currentParsedData.balance, // This is now guaranteed to be a number
        category: category,
        totalAmount: currentParsedData.amount + currentParsedData.fee,
        txDateMs: txDateMs, // Use transaction date, NOT input date
        timestamp: Date.now() // Keep this for "when was it added to the system"
    };
    
    // Save to backend instead of Local Storage
    try {
        const response = await fetch('/api/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`  // Assume token from login
            },
            body: JSON.stringify(transaction)
        });

        if (!response.ok) {
            throw new Error('Failed to add transaction');
        }

        alert('Transaction added successfully!');
        
        // Clear form
        document.getElementById('transactionInput').value = '';
        document.getElementById('categorySelect').value = '';
        document.getElementById('parsedResults').innerHTML = '';
        currentParsedData = null;
    } catch (err) {
        alert('Error adding transaction: ' + err.message);
    }
}