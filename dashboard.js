// Global variables
let monthlyIncome = 0;
let transactions = [];
let categoryTotals = {};
let topCategories = [];

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', function() {
    // Load saved transactions from localStorage
    loadTransactions();
    
    // Set up event listeners
    document.getElementById('setIncome').addEventListener('click', setMonthlyIncome);
    
    // Load saved income from localStorage
    loadMonthlyIncome();
    
    // Initialize charts
    initializeCharts();
    
    // Update dashboard with current data
    updateDashboard();
});

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
    
    // Calculate category totals
    calculateCategoryTotals();
}

// Load monthly income from localStorage
function loadMonthlyIncome() {
    const savedIncome = localStorage.getItem('monthlyIncome');
    if (savedIncome) {
        monthlyIncome = parseFloat(savedIncome);
        document.getElementById('monthlyIncome').value = monthlyIncome;
    }
}

// Set monthly income
function setMonthlyIncome() {
    const incomeInput = document.getElementById('monthlyIncome');
    const incomeValue = parseFloat(incomeInput.value);
    
    if (isNaN(incomeValue) || incomeValue < 0) {
        alert('Please enter a valid monthly income');
        return;
    }
    
    monthlyIncome = incomeValue;
    localStorage.setItem('monthlyIncome', monthlyIncome.toString());
    
    // Update dashboard
    updateDashboard();
}

// Calculate category totals
function calculateCategoryTotals() {
    categoryTotals = {};
    
    transactions.forEach(transaction => {
        const category = transaction.category;
        const amount = transaction.totalAmount;
        
        if (!categoryTotals[category]) {
            categoryTotals[category] = 0;
        }
        
        categoryTotals[category] += amount;
    });
    
    // Sort categories by spending amount (descending)
    topCategories = Object.keys(categoryTotals)
        .map(category => ({ category, amount: categoryTotals[category] }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3); // Top 3 categories
}

// Update dashboard with current data
function updateDashboard() {
    // Calculate total spent
    const totalSpent = transactions.reduce((sum, transaction) => sum + transaction.totalAmount, 0);
    
    // Calculate remaining balance
    const remainingBalance = monthlyIncome - totalSpent;
    
    // Calculate savings rate
    const savingsRate = monthlyIncome > 0 ? ((remainingBalance / monthlyIncome) * 100).toFixed(1) : 0;
    
    // Update KPIs
    document.getElementById('totalSpent').textContent = `Ksh ${totalSpent.toFixed(2)}`;
    document.getElementById('remainingBalance').textContent = `Ksh ${remainingBalance.toFixed(2)}`;
    document.getElementById('savingsRate').textContent = `${savingsRate}%`;
    
    // Update top categories list
    updateTopCategoriesList();
    
    // Update charts
    updateCharts();
}

// Update top categories list
function updateTopCategoriesList() {
    const container = document.getElementById('topCategoriesList');
    container.innerHTML = '';
    
    if (topCategories.length === 0) {
        container.innerHTML = '<p>No transactions recorded yet.</p>';
        return;
    }
    
    topCategories.forEach((item, index) => {
        const categoryItem = document.createElement('div');
        categoryItem.className = 'category-item';
        categoryItem.innerHTML = `
            <span class="category-name">${index + 1}. ${item.category}</span>
            <span class="category-amount">Ksh ${item.amount.toFixed(2)}</span>
        `;
        container.appendChild(categoryItem);
    });
}

// Initialize charts
function initializeCharts() {
    // Create pie chart
    const pieCtx = document.getElementById('pieChart').getContext('2d');
    window.pieChart = new Chart(pieCtx, {
        type: 'pie',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
                    '#FF9F40', '#8AC249', '#F06292', '#7986CB', '#E57373'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const percentage = ((value / context.dataset.data.reduce((a, b) => a + b, 0)) * 100).toFixed(1);
                            return `${label}: Ksh ${value.toFixed(2)} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
    
    // Create bar chart
    const barCtx = document.getElementById('barChart').getContext('2d');
    window.barChart = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Spending by Category',
                data: [],
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
                    '#FF9F40', '#8AC249', '#F06292', '#7986CB', '#E57373'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Amount (Ksh)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Category'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            return `${label}: Ksh ${value.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
}

// Update charts with current data
function updateCharts() {
    // Update pie chart
    const categories = Object.keys(categoryTotals);
    const amounts = Object.values(categoryTotals);
    
    window.pieChart.data.labels = categories;
    window.pieChart.data.datasets[0].data = amounts;
    window.pieChart.update();
    
    // Update bar chart
    window.barChart.data.labels = categories;
    window.barChart.data.datasets[0].data = amounts;
    window.barChart.update();
}