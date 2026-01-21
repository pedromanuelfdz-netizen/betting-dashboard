// Dashboard JavaScript - VERSIÓN MEJORADA V2
// Con ROI, Yield, y breakdown de mercados por liga

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

    // Update config
    document.getElementById('config-min-odd').textContent = '1.80';
    document.getElementById('config-max-odd').textContent = '2.10';
    document.getElementById('config-min-edge').textContent = '7-8%';
    document.getElementById('config-kelly').textContent = '0.25';

    // Crear todas las secciones
    createSimpleBankrollChart(data.bankroll_history);
    createOddRangeSection(data.by_odd_range);
    createLeagueSection(data.by_league);
    createMarketSection(data.by_market);
    createRecentBetsSection(data.recent_bets);
}

function createSimpleBankrollChart(history) {
    const container = document.getElementById('bankrollChart').parentElement;
    
    // Calcular estadísticas clave
    const inicial = history[0];
    const actual = history[history.length - 1];
    const max = Math.max(...history);
    const min = Math.min(...history);
    const cambio = actual - inicial;
    const cambioPct = ((cambio / inicial) * 100).toFixed(1);
    
    // Crear visualización simple con ASCII sparkline
    const normalized = history.map(v => {
        return Math.round(((v - min) / (max - min)) * 10);
    });
    
    const bars = '▁▂▃▄▅▆▇█';
    const sparkline = normalized.map(v => bars[v] || bars[0]).join('');
    
    container.innerHTML = `
        <div style="padding: 20px; background: rgba(16, 185, 129, 0.05); border-radius: 8px; border-left: 4px solid #10b981;">
            <h3 style="margin: 0 0 15px 0; color: #10b981; font-size: 14px;">📈 EVOLUCIÓN BANKROLL</h3>
            
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 15px;">
                <div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 4px;">Inicial</div>
                    <div style="font-size: 16px; font-weight: bold; color: #fff;">€${inicial.toFixed(2)}</div>
                </div>
                <div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 4px;">Actual</div>
                    <div style="font-size: 16px; font-weight: bold; color: ${actual >= inicial ? '#10b981' : '#ef4444'};">€${actual.toFixed(2)}</div>
                </div>
                <div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 4px;">Máximo</div>
                    <div style="font-size: 16px; font-weight: bold; color: #fff;">€${max.toFixed(2)}</div>
                </div>
                <div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 4px;">Mínimo</div>
                    <div style="font-size: 16px; font-weight: bold; color: #fff;">€${min.toFixed(2)}</div>
                </div>
            </div>
            
            <div style="font-family: monospace; font-size: 8px; line-height: 1; color: #10b981; letter-spacing: 1px; overflow-x: auto; white-space: nowrap;">
                ${sparkline}
            </div>
            
            <div style="margin-top: 10px; font-size: 13px;">
                <span style="color: #94a3b8;">Cambio total:</span>
                <span style="color: ${cambio >= 0 ? '#10b981' : '#ef4444'}; font-weight: bold; margin-left: 8px;">
                    ${cambio >= 0 ? '+' : ''}€${cambio.toFixed(2)} (${cambioPct >= 0 ? '+' : ''}${cambioPct}%)
                </span>
            </div>
        </div>
    `;
}

function createOddRangeSection(oddRangeData) {
    const container = document.getElementById('oddRangeChart').parentElement;
    
    // Convertir objeto a array si es necesario
    const dataArray = Array.isArray(oddRangeData) ? oddRangeData : 
        Object.entries(oddRangeData).map(([range, data]) => ({
            range,
            ...data
        }));
    
    // Ordenar por picks descendente
    dataArray.sort((a, b) => b.picks - a.picks);
    
    container.innerHTML = `
        <div style="padding: 20px; background: rgba(59, 130, 246, 0.05); border-radius: 8px; border-left: 4px solid #3b82f6;">
            <h3 style="margin: 0 0 15px 0; color: #3b82f6; font-size: 14px;">📊 PERFORMANCE POR ODD RANGE</h3>
            
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <th style="text-align: left; padding: 8px; color: #94a3b8; font-weight: 600;">Range</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Picks</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">WR%</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">ROI%</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Yield%</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${dataArray.map(item => {
                            const wr = item.win_rate || 0;
                            const roi = item.roi || 0;
                            const yieldPct = item.yield || 0;
                            const roiColor = roi > 0 ? '#10b981' : roi < 0 ? '#ef4444' : '#f59e0b';
                            
                            return `
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                    <td style="padding: 10px 8px; color: #fff; font-weight: 500;">${item.range}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #e2e8f0;">${item.picks}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #fff; font-weight: 600;">${wr.toFixed(1)}%</td>
                                    <td style="padding: 10px 8px; text-align: center; color: ${roiColor}; font-weight: 600;">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</td>
                                    <td style="padding: 10px 8px; text-align: center; color: ${roiColor}; font-weight: 500;">${yieldPct >= 0 ? '+' : ''}${yieldPct.toFixed(1)}%</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function createLeagueSection(leagueData) {
    const tbody = document.querySelector('#leagueTable tbody');
    
    if (!leagueData || leagueData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">No hay datos disponibles</td></tr>';
        return;
    }
    
    // Ordenar por ROI descendente
    const sorted = [...leagueData].sort((a, b) => (b.roi || 0) - (a.roi || 0));
    
    tbody.innerHTML = sorted.map(league => {
        const roi = league.roi || 0;
        const yieldPct = league.yield || 0;
        const wr = league.win_rate || 0;
        
        // Determinar estado basado en ROI
        let statusClass, statusText;
        if (roi > 10) {
            statusClass = 'status-good';
            statusText = '🔥 Excelente';
        } else if (roi > 0) {
            statusClass = 'status-warning';
            statusText = '✅ Positivo';
        } else {
            statusClass = 'status-bad';
            statusText = '⚠️ Negativo';
        }
        
        // Crear HTML para mercados (si existen)
        let marketsHTML = '';
        if (league.markets && league.markets.length > 0) {
            const topMarkets = league.markets.slice(0, 3);
            marketsHTML = `
                <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
                    ${topMarkets.map(m => {
                        const mRoi = m.roi || 0;
                        const mColor = mRoi > 0 ? '#10b981' : '#ef4444';
                        return `<span style="display: inline-block; margin-right: 8px;">
                            ${m.market}: <span style="color: ${mColor}; font-weight: 600;">${mRoi >= 0 ? '+' : ''}${mRoi.toFixed(1)}%</span>
                        </span>`;
                    }).join('')}
                </div>
            `;
        }
        
        return `
            <tr>
                <td>
                    <div style="font-weight: 600;">${league.league}</div>
                    ${marketsHTML}
                </td>
                <td style="text-align: center;">${league.picks}</td>
                <td style="text-align: center;">${wr.toFixed(1)}%</td>
                <td style="text-align: center; color: ${roi > 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                    ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
                    <div style="font-size: 10px; color: #94a3b8; font-weight: normal;">Yield: ${yieldPct >= 0 ? '+' : ''}${yieldPct.toFixed(1)}%</div>
                </td>
                <td style="text-align: center;">
                    <span class="${statusClass}">${statusText}</span>
                </td>
            </tr>
        `;
    }).join('');
}

function createMarketSection(marketData) {
    // Buscar contenedor
    const parent = document.getElementById('leagueTable').closest('.table-container').parentElement;
    
    // Crear nuevo contenedor si no existe
    let container = document.getElementById('marketSection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'marketSection';
        container.className = 'table-container';
        parent.appendChild(container);
    }
    
    if (!marketData || marketData.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    // Ordenar por ROI descendente
    const sorted = [...marketData].sort((a, b) => (b.roi || 0) - (a.roi || 0));
    
    container.innerHTML = `
        <h2>🎯 Performance por Mercado</h2>
        <table>
            <thead>
                <tr>
                    <th>Mercado</th>
                    <th style="text-align: center;">n</th>
                    <th style="text-align: center;">WR%</th>
                    <th style="text-align: center;">ROI%</th>
                    <th style="text-align: center;">Top Liga</th>
                </tr>
            </thead>
            <tbody>
                ${sorted.map(market => {
                    const roi = market.roi || 0;
                    const yieldPct = market.yield || 0;
                    const wr = market.win_rate || 0;
                    
                    // Top liga para este mercado
                    let topLeague = '';
                    if (market.leagues && market.leagues.length > 0) {
                        const best = market.leagues.sort((a, b) => (b.roi || 0) - (a.roi || 0))[0];
                        const bestRoi = best.roi || 0;
                        const bestColor = bestRoi > 0 ? '#10b981' : '#ef4444';
                        topLeague = `<span style="color: ${bestColor}; font-weight: 600;">${best.league} (${bestRoi >= 0 ? '+' : ''}${bestRoi.toFixed(1)}%)</span>`;
                    }
                    
                    return `
                        <tr>
                            <td style="max-width: 250px;">
                                <div style="font-weight: 600;">${market.market}</div>
                            </td>
                            <td style="text-align: center;">${market.picks}</td>
                            <td style="text-align: center;">${wr.toFixed(1)}%</td>
                            <td style="text-align: center; color: ${roi > 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                                ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
                                <div style="font-size: 10px; color: #94a3b8; font-weight: normal;">Yield: ${yieldPct >= 0 ? '+' : ''}${yieldPct.toFixed(1)}%</div>
                            </td>
                            <td style="text-align: center; font-size: 12px;">
                                ${topLeague}
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

function createRecentBetsSection(recentBets) {
    const tbody = document.querySelector('#latestBetsTable tbody');
    
    if (!recentBets || recentBets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">No hay apuestas recientes</td></tr>';
        return;
    }
    
    tbody.innerHTML = recentBets.map(bet => {
        const resultClass = bet.result === 'Ganada' ? 'result-won' : 
                          bet.result === 'Perdida' ? 'result-lost' : 'result-pending';
        
        // Mostrar edge si está disponible
        let edgeInfo = '';
        if (bet.edge_inicial !== undefined && bet.edge_actual !== undefined) {
            const edgeChange = bet.edge_actual - bet.edge_inicial;
            const edgeColor = edgeChange >= 0 ? '#10b981' : '#ef4444';
            edgeInfo = `
                <div style="font-size: 10px; color: #94a3b8;">
                    Edge: ${bet.edge_inicial.toFixed(1)}% → 
                    <span style="color: ${edgeColor};">${bet.edge_actual.toFixed(1)}%</span>
                </div>
            `;
        }
        
        return `
            <tr>
                <td style="font-size: 11px; color: #94a3b8;">
                    ${bet.date}
                    ${bet.league ? `<div style="font-size: 10px; color: #64748b;">${bet.league}</div>` : ''}
                </td>
                <td>
                    <div style="font-weight: 500;">${bet.match}</div>
                    ${bet.market ? `<div style="font-size: 11px; color: #94a3b8;">${bet.market}</div>` : ''}
                </td>
                <td style="text-align: center; font-size: 12px;">
                    ${bet.selection}
                    ${edgeInfo}
                </td>
                <td style="text-align: center; font-weight: 600;">${bet.odd.toFixed(2)}</td>
                <td style="text-align: center;">
                    <span class="${resultClass}">${bet.result}</span>
                </td>
            </tr>
        `;
    }).join('');
}

// Load on page ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDashboardData);
} else {
    loadDashboardData();
}
