// Dashboard JavaScript
// Lee data.json y actualiza el dashboard

async function loadDashboardData() {
    try {
        const response = await fetch('data.json');
        const data = await response.json();
        updateDashboard(data);
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        document.getElementById('lastUpdate').textContent = 'Error: No se pudo cargar los datos';
    }
}

function updateDashboard(data) {
    // Update last update time
    const lastUpdate = new Date(data.timestamp);
    document.getElementById('lastUpdate').textContent = 
        `Última actualización: ${lastUpdate.toLocaleString('es-ES')}`;

    // Update summary cards
    const summary = data.summary;
    
    document.getElementById('bankroll').textContent = `€${summary.bankroll_final.toFixed(2)}`;
    document.getElementById('bankroll-delta').textContent = 
        `${summary.profit_loss >= 0 ? '+' : ''}€${summary.profit_loss.toFixed(2)}`;
    document.getElementById('bankroll-delta').className = 
        `card-delta ${summary.profit_loss >= 0 ? 'positive' : 'negative'}`;

    document.getElementById('roi').textContent = `${summary.roi >= 0 ? '+' : ''}${summary.roi.toFixed(1)}%`;
    document.getElementById('roi-7d').textContent = `Yield: ${summary.yield >= 0 ? '+' : ''}${summary.yield.toFixed(1)}%`;
    document.getElementById('roi-7d').className = 
        `card-delta ${summary.yield >= 0 ? 'positive' : 'negative'}`;

    document.getElementById('winrate').textContent = `${summary.win_rate.toFixed(1)}%`;
    document.getElementById('wr-7d').textContent = `${summary.ganadas}W-${summary.perdidas}L`;

    document.getElementById('totalpicks').textContent = summary.total_picks;
    document.getElementById('picks-7d').textContent = summary.pendientes > 0 ? `${summary.pendientes} pendientes` : 'Sin pendientes';

    // Update config (valores fijos del bot)
    document.getElementById('config-min-odd').textContent = '1.80';
    document.getElementById('config-max-odd').textContent = '2.10';
    document.getElementById('config-min-edge').textContent = '8.0%';
    document.getElementById('config-kelly').textContent = '0.25';

    // Create charts
    createBankrollChart(data.bankroll_history);
    createOddRangeChart(data.by_odd_range);

    // Fill tables
    fillLeagueTable(data.performance.by_league);
    fillLatestBetsTable(data.latest_bets);
}

function createBankrollChart(history) {
    const ctx = document.getElementById('bankrollChart');
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.map((_, i) => `Pick ${i}`),
            datasets: [{
                label: 'Bankroll (€)',
                data: history,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#fff'
                    }
                }
            },
            scales: {
                y: {
                    ticks: {
                        color: '#fff',
                        callback: value => `€${value}`
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#fff'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

function createOddRangeChart(oddRangeData) {
    const ctx = document.getElementById('oddRangeChart');
    
    const labels = oddRangeData.map(d => d.range);
    const rois = oddRangeData.map(d => d.roi);
    const colors = rois.map(roi => 
        roi > 5 ? '#10b981' : (roi > 0 ? '#f59e0b' : '#ef4444')
    );
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'ROI (%)',
                data: rois,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#fff'
                    }
                }
            },
            scales: {
                y: {
                    ticks: {
                        color: '#fff',
                        callback: value => `${value}%`
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#fff'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

function fillLeagueTable(leagues) {
    const tbody = document.querySelector('#leagueTable tbody');
    tbody.innerHTML = '';

    leagues.slice(0, 10).forEach(league => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${league.league}</td>
            <td>${league.n}</td>
            <td>${league.wr}%</td>
            <td style="color: ${league.roi > 0 ? '#10b981' : '#ef4444'}; font-weight: bold;">
                ${league.roi >= 0 ? '+' : ''}${league.roi}%
            </td>
            <td><span class="status-badge status-${league.status}">
                ${league.status === 'good' ? '✅' : (league.status === 'warning' ? '⚠️' : '❌')}
            </span></td>
        `;
    });
}

function fillLatestBetsTable(bets) {
    const tbody = document.querySelector('#latestBetsTable tbody');
    tbody.innerHTML = '';

    bets.forEach(bet => {
        const row = tbody.insertRow();
        const resultClass = bet.result === 'Ganada' ? 'result-won' : 
                          (bet.result === 'Perdida' ? 'result-lost' : 'result-pending');
        const resultIcon = bet.result === 'Ganada' ? '✅' : 
                         (bet.result === 'Perdida' ? '❌' : '⏳');
        
        row.innerHTML = `
            <td>${bet.date}</td>
            <td style="font-size: 0.85rem;">${bet.match}</td>
            <td>${bet.selection}</td>
            <td>${bet.odd.toFixed(2)}</td>
            <td class="${resultClass}">${resultIcon} ${bet.result}</td>
        `;
    });
}

// Load dashboard when page loads
document.addEventListener('DOMContentLoaded', loadDashboardData);

// Auto-refresh every 5 minutes
setInterval(loadDashboardData, 5 * 60 * 1000);
