// Dashboard JavaScript - SUPER COMPLETO con todas las estadísticas

async function loadDashboardData() {
    console.log('🔄 Iniciando carga de datos...');
    
    try {
        console.log('📡 Fetching data.json...');
        const response = await fetch('data.json');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        console.log('✅ Respuesta recibida, parseando JSON...');
        const data = await response.json();
        console.log('✅ JSON parseado correctamente');
        
        updateDashboard(data);
        console.log('✅ Dashboard actualizado');
        
    } catch (error) {
        console.error('❌ Error loading dashboard data:', error);
        document.getElementById('lastUpdate').textContent = '❌ Error: ' + error.message;
        showError(error.message);
    }
}

function showError(message) {
    const errorHTML = `
        <div style="padding: 40px; text-align: center; background: rgba(239, 68, 68, 0.1); border-radius: 12px; border: 2px solid #ef4444;">
            <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
            <div style="font-size: 18px; font-weight: 600; color: #ef4444; margin-bottom: 8px;">Error al cargar datos</div>
            <div style="font-size: 14px; color: #666;">${message}</div>
            <div style="margin-top: 16px; font-size: 13px; color: #666;">
                <strong>Soluciones posibles:</strong><br>
                • Genera data.json con: python3 generate_dashboard_data.py tu_csv.csv<br>
                • Abre con servidor local: python3 -m http.server 8000<br>
                • Revisa la consola del navegador (F12)
            </div>
        </div>
    `;
    
    document.getElementById('mainMetrics').innerHTML = errorHTML;
}

function updateDashboard(data) {
    console.log('📊 Actualizando dashboard...');
    
    // Update last update time
    const lastUpdate = new Date(data.timestamp);
    document.getElementById('lastUpdate').textContent = 
        `Última actualización: ${lastUpdate.toLocaleString('es-ES', { 
            dateStyle: 'medium', 
            timeStyle: 'short' 
        })}`;

    // Render all sections
    createMainMetrics(data.summary);
    createRachaCard(data.racha);
    createBankrollChart(data.bankroll_history, data.summary);
    createMarketStats(data.by_market);
    createEdgeStats(data.by_edge);
    createOddStats(data.by_odd);
    createTemporalStats(data.temporal_stats);
    createMarketEdgeStats(data.market_edge_stats);
    createMarketLeagueStats(data.market_league_stats);
    createTopTeams(data.top_teams);
    createWorstTeams(data.worst_teams);
    createLeagueStats(data.by_league);
    createCLVAnalysis(data.clv_analysis);
    createRecentBets(data.recent_bets);
    createBotConfig();
    
    console.log('✅ Todo renderizado');
}

// ============================================
// MÉTRICAS PRINCIPALES
// ============================================
function createMainMetrics(summary) {
    const container = document.getElementById('mainMetrics');
    
    const metrics = [
        {
            label: '💰 Bankroll',
            value: `€${summary.bankroll_final.toFixed(2)}`,
            delta: `${summary.profit_loss >= 0 ? '+' : ''}€${summary.profit_loss.toFixed(2)}`,
            isPositive: summary.profit_loss >= 0
        },
        {
            label: '📊 ROI',
            value: `${summary.roi >= 0 ? '+' : ''}${summary.roi.toFixed(1)}%`,
            delta: `Yield: ${summary.yield >= 0 ? '+' : ''}${summary.yield.toFixed(1)}%`,
            isPositive: summary.roi >= 0
        },
        {
            label: '🎯 Win Rate',
            value: `${summary.win_rate.toFixed(1)}%`,
            delta: `${summary.ganadas}W - ${summary.perdidas}L`,
            isPositive: summary.win_rate >= 50
        },
        {
            label: '📈 Total Picks',
            value: summary.total_picks,
            delta: summary.pendientes > 0 ? `${summary.pendientes} pendientes` : '✅ Todo resuelto',
            isPositive: true
        }
    ];

    container.innerHTML = metrics.map(m => `
        <div class="metric-box">
            <div class="metric-label">${m.label}</div>
            <div class="metric-value">${m.value}</div>
            <div class="metric-delta ${m.isPositive ? 'positive' : 'negative'}">${m.delta}</div>
        </div>
    `).join('');
}

// ============================================
// RACHA ACTUAL
// ============================================
function createRachaCard(racha) {
    const container = document.getElementById('rachaCard');
    
    if (!racha || racha.actual === 0) {
        container.style.display = 'none';
        return;
    }
    
    const isWinStreak = racha.tipo === 'win';
    const emoji = isWinStreak ? '🔥' : '❄️';
    const text = isWinStreak ? 'RACHA GANADORA' : 'RACHA PERDEDORA';
    const className = isWinStreak ? 'win' : 'loss';
    
    container.innerHTML = `
        <div style="text-align: center;">
            <div class="racha-badge ${className}">
                <span style="font-size: 32px;">${emoji}</span>
                <div>
                    <div style="font-size: 12px; opacity: 0.9;">${text}</div>
                    <div style="font-size: 24px;">${racha.actual} ${racha.actual === 1 ? 'apuesta' : 'apuestas'}</div>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// GRÁFICO DE BANKROLL
// ============================================
function createBankrollChart(history, summary) {
    const container = document.getElementById('bankrollChart');
    
    if (!history || history.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">📈</div><div class="empty-state-text">No hay historial</div></div>';
        return;
    }
    
    const inicial = history[0];
    const actual = history[history.length - 1];
    const max = Math.max(...history);
    const min = Math.min(...history);
    
    container.innerHTML = `
        <div class="stats-row">
            <div class="stat-box">
                <div class="stat-box-label">💵 Inicial</div>
                <div class="stat-box-value">€${inicial.toFixed(2)}</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">💰 Actual</div>
                <div class="stat-box-value" style="color: ${actual >= inicial ? '#10b981' : '#f59e0b'}">€${actual.toFixed(2)}</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">📈 Máximo</div>
                <div class="stat-box-value">€${max.toFixed(2)}</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">📉 Mínimo</div>
                <div class="stat-box-value">€${min.toFixed(2)}</div>
            </div>
        </div>
    `;
}

// ============================================
// STATS POR MERCADO
// ============================================
function createMarketStats(byMarket) {
    const container = document.getElementById('marketStats');
    
    if (!byMarket || Object.keys(byMarket).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">📊</div></div>';
        return;
    }

    const markets = Object.entries(byMarket).map(([name, data]) => ({ name, ...data }));
    markets.sort((a, b) => b.roi - a.roi);

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>🎯 Mercado</th>
                        <th style="text-align: center">📊 Picks</th>
                        <th style="text-align: center">✅ WR</th>
                        <th style="text-align: center">💰 ROI</th>
                        <th style="text-align: center">📈 P/L</th>
                    </tr>
                </thead>
                <tbody>
                    ${markets.map(m => {
                        const emoji = {'Over 2.5': '🔼', 'Under 2.5': '🔽', 'BTTS Yes': '⚽⚽', 'BTTS No': '🚫⚽'}[m.name] || '🎯';
                        return `
                            <tr>
                                <td><strong>${emoji} ${m.name}</strong></td>
                                <td style="text-align: center">${m.picks}</td>
                                <td style="text-align: center">
                                    <strong style="color: ${m.win_rate >= 50 ? '#10b981' : '#f59e0b'}">${m.win_rate.toFixed(1)}%</strong>
                                    <div style="font-size: 11px; color: #666;">${m.ganadas}W-${m.perdidas}L</div>
                                </td>
                                <td style="text-align: center">
                                    <strong style="color: ${m.roi >= 0 ? '#10b981' : '#f59e0b'}; font-size: 16px;">
                                        ${m.roi >= 0 ? '+' : ''}${m.roi.toFixed(1)}%
                                    </strong>
                                </td>
                                <td style="text-align: center">
                                    <strong style="color: ${m.profit >= 0 ? '#10b981' : '#f59e0b'}">
                                        ${m.profit >= 0 ? '+' : ''}€${m.profit.toFixed(2)}
                                    </strong>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================
// STATS POR EDGE
// ============================================
function createEdgeStats(byEdge) {
    const container = document.getElementById('edgeStats');
    
    if (!byEdge || Object.keys(byEdge).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">📊</div></div>';
        return;
    }

    const edges = Object.entries(byEdge).map(([name, data]) => ({ name, ...data }));

    container.innerHTML = `
        <div class="bar-chart">
            ${edges.map(e => `
                <div class="bar-item">
                    <div class="bar-header">
                        <span class="bar-label">${e.name}</span>
                        <span class="bar-value">${e.picks} picks | WR: ${e.win_rate.toFixed(1)}% | ROI: ${e.roi >= 0 ? '+' : ''}${e.roi.toFixed(1)}%</span>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill ${e.roi >= 0 ? 'positive' : 'negative'}" style="width: ${Math.abs(e.roi) * 2}%"></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ============================================
// STATS POR ODD
// ============================================
function createOddStats(byOdd) {
    const container = document.getElementById('oddStats');
    
    if (!byOdd || Object.keys(byOdd).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">💵</div></div>';
        return;
    }

    const odds = Object.entries(byOdd).map(([name, data]) => ({ name, ...data }));

    container.innerHTML = `
        <div class="bar-chart">
            ${odds.map(o => `
                <div class="bar-item">
                    <div class="bar-header">
                        <span class="bar-label">${o.name}</span>
                        <span class="bar-value">${o.picks} picks | WR: ${o.win_rate.toFixed(1)}% | ROI: ${o.roi >= 0 ? '+' : ''}${o.roi.toFixed(1)}%</span>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill ${o.roi >= 0 ? 'positive' : 'negative'}" style="width: ${Math.abs(o.roi) * 2}%"></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ============================================
// ANÁLISIS TEMPORAL
// ============================================
function createTemporalStats(temporal) {
    const container = document.getElementById('temporalStats');
    
    if (!temporal || Object.keys(temporal).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">📅</div></div>';
        return;
    }

    const weekdayOrder = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const days = weekdayOrder.filter(day => temporal[day]).map(day => ({ name: day, ...temporal[day] }));

    container.innerHTML = `
        <div class="heatmap">
            ${days.map(d => {
                const color = d.roi >= 0 ? '#10b981' : '#f59e0b';
                return `
                    <div class="heatmap-cell" style="background: ${color}15; border: 2px solid ${color}50;">
                        <div class="heatmap-label">${d.name}</div>
                        <div class="heatmap-value" style="color: ${color};">${d.roi >= 0 ? '+' : ''}${d.roi.toFixed(1)}%</div>
                        <div style="font-size: 11px; color: #666; margin-top: 4px;">${d.picks} picks | ${d.win_rate.toFixed(0)}% WR</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ============================================
// ANÁLISIS CRUZADO: MERCADO × EDGE
// ============================================
function createMarketEdgeStats(marketEdgeStats) {
    const container = document.getElementById('marketEdgeStats');
    
    if (!marketEdgeStats || Object.keys(marketEdgeStats).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">🎯📊</div></div>';
        return;
    }

    let html = '';
    for (const [market, edges] of Object.entries(marketEdgeStats)) {
        const emoji = {'Over 2.5': '🔼', 'Under 2.5': '🔽', 'BTTS Yes': '⚽⚽', 'BTTS No': '🚫⚽'}[market] || '🎯';
        
        html += `
            <div style="margin-bottom: 24px;">
                <h3 style="color: #0088cc; margin-bottom: 12px;">${emoji} ${market}</h3>
                <div class="stats-row">
                    ${Object.entries(edges).map(([edge, data]) => {
                        const color = data.roi >= 0 ? '#10b981' : '#f59e0b';
                        return `
                            <div class="stat-box" style="border: 2px solid ${color}50;">
                                <div class="stat-box-label">${edge}</div>
                                <div class="stat-box-value small" style="color: ${color};">${data.roi >= 0 ? '+' : ''}${data.roi.toFixed(1)}%</div>
                                <div style="font-size: 11px; color: #666; margin-top: 4px;">${data.picks} picks | ${data.win_rate.toFixed(0)}% WR</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

// ============================================
// ANÁLISIS CRUZADO: MERCADO × LIGA
// ============================================
function createMarketLeagueStats(marketLeagueStats) {
    const container = document.getElementById('marketLeagueStats');
    
    if (!marketLeagueStats || Object.keys(marketLeagueStats).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">🎯🏆</div></div>';
        return;
    }

    let html = '';
    for (const [market, leagues] of Object.entries(marketLeagueStats)) {
        const emoji = {'Over 2.5': '🔼', 'Under 2.5': '🔽', 'BTTS Yes': '⚽⚽', 'BTTS No': '🚫⚽'}[market] || '🎯';
        
        // Ordenar por ROI y tomar top 5
        const topLeagues = Object.entries(leagues)
            .sort((a, b) => b[1].roi - a[1].roi)
            .slice(0, 5);
        
        if (topLeagues.length === 0) continue;
        
        html += `
            <div style="margin-bottom: 24px;">
                <h3 style="color: #0088cc; margin-bottom: 12px;">${emoji} ${market}</h3>
                <div class="bar-chart">
                    ${topLeagues.map(([league, data]) => `
                        <div class="bar-item">
                            <div class="bar-header">
                                <span class="bar-label">${league}</span>
                                <span class="bar-value">${data.picks} picks | WR: ${data.win_rate.toFixed(1)}% | ROI: ${data.roi >= 0 ? '+' : ''}${data.roi.toFixed(1)}%</span>
                            </div>
                            <div class="bar-track">
                                <div class="bar-fill ${data.roi >= 0 ? 'positive' : 'negative'}" style="width: ${Math.min(Math.abs(data.roi) * 2, 100)}%"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

// ============================================
// TOP EQUIPOS
// ============================================
function createTopTeams(topTeams) {
    const container = document.getElementById('topTeams');
    
    if (!topTeams || Object.keys(topTeams).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">⭐</div></div>';
        return;
    }

    const teams = Object.entries(topTeams).map(([name, data]) => ({ name, ...data }));

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>⚽ Equipo</th>
                        <th style="text-align: center">📊 Picks</th>
                        <th style="text-align: center">✅ WR</th>
                    </tr>
                </thead>
                <tbody>
                    ${teams.map((t, index) => `
                        <tr>
                            <td><strong>${index + 1}. ${t.name}</strong></td>
                            <td style="text-align: center">${t.picks}</td>
                            <td style="text-align: center">
                                <strong style="color: #10b981; font-size: 16px;">${t.win_rate.toFixed(1)}%</strong>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================
// PEORES EQUIPOS
// ============================================
function createWorstTeams(worstTeams) {
    const container = document.getElementById('worstTeams');
    
    if (!worstTeams || Object.keys(worstTeams).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">⚠️</div></div>';
        return;
    }

    const teams = Object.entries(worstTeams).map(([name, data]) => ({ name, ...data }));

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>⚽ Equipo</th>
                        <th style="text-align: center">📊 Picks</th>
                        <th style="text-align: center">❌ WR</th>
                    </tr>
                </thead>
                <tbody>
                    ${teams.map((t, index) => `
                        <tr>
                            <td><strong>${index + 1}. ${t.name}</strong></td>
                            <td style="text-align: center">${t.picks}</td>
                            <td style="text-align: center">
                                <strong style="color: #f59e0b; font-size: 16px;">${t.win_rate.toFixed(1)}%</strong>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================
// STATS POR LIGA
// ============================================
function createLeagueStats(byLeague) {
    const container = document.getElementById('leagueStats');
    
    if (!byLeague || Object.keys(byLeague).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">🏆</div></div>';
        return;
    }

    const leagues = Object.entries(byLeague).map(([name, data]) => ({ name, ...data }));
    leagues.sort((a, b) => b.picks - a.picks);
    const topLeagues = leagues.slice(0, 15);

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>🏆 Liga</th>
                        <th style="text-align: center">📊 Picks</th>
                        <th style="text-align: center">✅ WR</th>
                        <th style="text-align: center">💰 ROI</th>
                        <th style="text-align: center">📈 P/L</th>
                    </tr>
                </thead>
                <tbody>
                    ${topLeagues.map(l => {
                        const flag = {
                            'Premier League': '🏴󐁧󐁢󐁥󐁮󐁧󐁿', 'La Liga': '🇪🇸', 'Serie A': '🇮🇹',
                            'Bundesliga': '🇩🇪', 'Ligue 1': '🇫🇷'
                        }[l.name] || '⚽';
                        
                        return `
                            <tr>
                                <td><span style="font-size: 18px;">${flag}</span> <strong>${l.name}</strong></td>
                                <td style="text-align: center">${l.picks}</td>
                                <td style="text-align: center">
                                    <strong style="color: ${l.win_rate >= 50 ? '#10b981' : '#f59e0b'}">${l.win_rate.toFixed(1)}%</strong>
                                </td>
                                <td style="text-align: center">
                                    <strong style="color: ${l.roi >= 0 ? '#10b981' : '#f59e0b'}; font-size: 16px;">
                                        ${l.roi >= 0 ? '+' : ''}${l.roi.toFixed(1)}%
                                    </strong>
                                </td>
                                <td style="text-align: center">
                                    <strong style="color: ${l.profit >= 0 ? '#10b981' : '#f59e0b'}">
                                        ${l.profit >= 0 ? '+' : ''}€${l.profit.toFixed(2)}
                                    </strong>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================
// CLV ANALYSIS
// ============================================
function createCLVAnalysis(clvData) {
    const container = document.getElementById('clvAnalysis');
    
    if (!clvData) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">💎</div></div>';
        return;
    }

    const avgCLV = clvData.avg_clv || 0;
    const positiveCLV = clvData.positive_clv || 0;
    const negativeCLV = clvData.negative_clv || 0;
    const totalBets = positiveCLV + negativeCLV;
    const positivePct = totalBets > 0 ? (positiveCLV / totalBets) * 100 : 0;

    container.innerHTML = `
        <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%); padding: 24px; border-radius: 12px; border: 2px solid ${avgCLV >= 0 ? '#10b981' : '#f59e0b'};">
            <div class="stats-row" style="margin-bottom: 20px;">
                <div class="stat-box">
                    <div class="stat-box-label">💎 CLV Promedio</div>
                    <div class="stat-box-value" style="color: ${avgCLV >= 0 ? '#10b981' : '#f59e0b'};">${avgCLV >= 0 ? '+' : ''}${avgCLV.toFixed(2)}%</div>
                </div>
                <div class="stat-box">
                    <div class="stat-box-label">✅ CLV Positivo</div>
                    <div class="stat-box-value" style="color: #10b981;">${positiveCLV}</div>
                    <div style="font-size: 11px; color: #666; margin-top: 4px;">${positivePct.toFixed(1)}%</div>
                </div>
                <div class="stat-box">
                    <div class="stat-box-label">❌ CLV Negativo</div>
                    <div class="stat-box-value" style="color: #f59e0b;">${negativeCLV}</div>
                    <div style="font-size: 11px; color: #666; margin-top: 4px;">${(100 - positivePct).toFixed(1)}%</div>
                </div>
            </div>
            
            <div style="background: white; padding: 16px; border-radius: 8px;">
                <div style="height: 12px; background: #e5e7eb; border-radius: 6px; overflow: hidden;">
                    <div style="height: 100%; width: ${positivePct}%; background: linear-gradient(90deg, #10b981 0%, #34d399 100%); transition: width 1s;"></div>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// ÚLTIMAS APUESTAS
// ============================================
function createRecentBets(recentBets) {
    const container = document.getElementById('recentBets');
    
    if (!recentBets || recentBets.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">📋</div></div>';
        return;
    }

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>📅 Fecha</th>
                        <th>🏆 Liga</th>
                        <th>⚽ Partido</th>
                        <th>🎯 Mercado</th>
                        <th style="text-align: center">💵 Odd</th>
                        <th style="text-align: center">📊 Edge</th>
                        <th style="text-align: center">✅ Estado</th>
                    </tr>
                </thead>
                <tbody>
                    ${recentBets.map(bet => {
                        const date = new Date(bet.match_date);
                        const dateStr = date.toLocaleDateString('es-ES', { 
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                        });
                        
                        let statusBadge = '';
                        if (bet.bet_result === 'Ganada') {
                            statusBadge = '<span class="badge win">✅ Ganada</span>';
                        } else if (bet.bet_result === 'Perdida') {
                            statusBadge = '<span class="badge loss">❌ Perdida</span>';
                        } else {
                            statusBadge = '<span class="badge pending">⏳ Pendiente</span>';
                        }
                        
                        return `
                            <tr>
                                <td style="white-space: nowrap; font-size: 12px;">${dateStr}</td>
                                <td style="font-size: 12px;">${bet.league || 'N/A'}</td>
                                <td>
                                    <div style="font-size: 13px; font-weight: 600;">${bet.home_team || 'N/A'} vs ${bet.away_team || 'N/A'}</div>
                                </td>
                                <td><strong style="color: #0088cc;">${bet.selection || 'N/A'}</strong></td>
                                <td style="text-align: center"><strong>${bet.betfair_odd ? bet.betfair_odd.toFixed(2) : 'N/A'}</strong></td>
                                <td style="text-align: center">
                                    <strong style="color: ${(bet.edge || 0) >= 8 ? '#10b981' : '#f59e0b'}">
                                        +${(bet.edge || 0).toFixed(1)}%
                                    </strong>
                                </td>
                                <td style="text-align: center">${statusBadge}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================
// BOT CONFIG
// ============================================
function createBotConfig() {
    const container = document.getElementById('botConfig');
    
    container.innerHTML = `
        <div class="stats-row">
            <div class="stat-box">
                <div class="stat-box-label">⬇️ MIN ODD</div>
                <div class="stat-box-value">1.70</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">⬆️ MAX ODD</div>
                <div class="stat-box-value">2.50</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">📊 MIN EDGE Over</div>
                <div class="stat-box-value">10.0%</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">📊 MIN EDGE Under</div>
                <div class="stat-box-value">7.5%</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">💰 KELLY</div>
                <div class="stat-box-value">0.15</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">💵 BANKROLL</div>
                <div class="stat-box-value">€200</div>
            </div>
        </div>
        
        <div style="margin-top: 20px; padding: 16px; background: #f7f7f7; border-radius: 8px; border-left: 4px solid #0088cc;">
            <strong style="color: #0088cc;">🎯 Fase 1 Activa</strong>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #666; line-height: 1.6;">
                • Calibración diferenciada por mercado (Over: α=0.88, Under: α=0.92)<br>
                • MIN_EDGE optimizado por mercado<br>
                • Kelly conservador (0.15) para reducir varianza
            </p>
        </div>
    `;
}

// ============================================
// INICIALIZACIÓN
// ============================================
console.log('🚀 Inicializando dashboard completo...');

document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ DOM cargado');
    loadDashboardData();
    
    // Auto-refresh cada 5 minutos
    setInterval(loadDashboardData, 5 * 60 * 1000);
});
