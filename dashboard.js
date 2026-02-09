let monthlyIncome = 0;
let transactions = [];
let categoryTotals = {};

// Global Chart instances
let doughnutChart, barChart;

// Config
const TOP_N_CATEGORIES = 5;

// Consistent Color Palette (Add more if you expect more categories)
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

document.addEventListener('DOMContentLoaded', function() {
    loadData();
    document.getElementById('setIncome').addEventListener('click', setMonthlyIncome);
    initCharts();
    updateDashboard();
});

function loadData() {
    monthlyIncome = parseFloat(localStorage.getItem('monthlyIncome') || '0');
    if (monthlyIncome > 0) {
        document.getElementById('monthlyIncome').value = monthlyIncome;
    }

    const saved = localStorage.getItem('budgetTrackerTransactions');
    transactions = saved ? JSON.parse(saved) : [];

    calculateCategoryTotals();
}

function setMonthlyIncome() {
    const input = document.getElementById('monthlyIncome');
    const value = parseFloat(input.value);

    if (isNaN(value) || value < 0) {
        alert("Please enter a valid non-negative number.");
        return;
    }

    monthlyIncome = value;
    localStorage.setItem('monthlyIncome', monthlyIncome.toString());
    updateDashboard();
}

function calculateCategoryTotals() {
    categoryTotals = {};
    transactions.forEach(transaction => {
        const category = transaction.category || 'Others';
        const amount = transaction.totalAmount || 0;
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

    if (othersSum > 0) {
        top.push({ category: 'Others', amount: othersSum });
    }

    return top;
}

function formatCurrency(amount) {
    return `Ksh ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function initCharts() {
    // DOUGHNUT CHART
    const donutCtx = document.getElementById('doughnutChart').getContext('2d');
    doughnutChart = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [], // Will be filled dynamically
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    display: true,        // SHOW LEGEND
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 15,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            return `${label}: ${formatCurrency(value)}`;
                        }
                    }
                }
            }
        }
    });

    // BAR CHART
    const barCtx = document.getElementById('barChart').getContext('2d');
    barChart = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Spending', // Dataset label
                data: [],
                backgroundColor: [], // Will be filled dynamically
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false } // We use a custom HTML legend
            },
            scales: {
                y: { beginAtZero: true },
                x: { ticks: { maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

function updateDashboard() {
    // Calculate KPIs
    const totalSpent = transactions.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
    const remainingBalance = monthlyIncome - totalSpent;
    const savingsRate = monthlyIncome > 0 ? (remainingBalance / monthlyIncome) * 100 : 0;

    // Update KPIs
    document.getElementById('totalSpent').textContent = formatCurrency(totalSpent);
    document.getElementById('remainingBalance').textContent = formatCurrency(remainingBalance);
    document.getElementById('savingsRate').textContent = `${savingsRate.toFixed(1)}%`;

    // Update Donut Center Value
    document.getElementById('donutCenterValue').textContent = formatCurrency(totalSpent);

    // Get Top N + Others
    const topData = getTopCategoriesWithOthers(categoryTotals, TOP_N_CATEGORIES);

    // Generate colors array matching the data
    const colors = topData.map((_, index) => CATEGORY_COLORS[index % CATEGORY_COLORS.length]);

    // Update Doughnut Chart
    doughnutChart.data.labels = topData.map(item => item.category);
    doughnutChart.data.datasets[0].data = topData.map(item => item.amount);
    doughnutChart.data.datasets[0].backgroundColor = colors;
    doughnutChart.update();

    // Update Bar Chart
    barChart.data.labels = topData.map(item => item.category);
    barChart.data.datasets[0].data = topData.map(item => item.amount);
    barChart.data.datasets[0].backgroundColor = colors; // Same colors as donut
    barChart.update();

    // Update Custom Legend for Bar Chart
    const legendContainer = document.getElementById('barChartLegend');
    legendContainer.innerHTML = '';
    topData.forEach((item, index) => {
        const color = colors[index];
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        legendItem.innerHTML = `
            <div class="legend-color" style="background-color: ${color}"></div>
            <span>${item.category}</span>
        `;
        legendContainer.appendChild(legendItem);
    });
}