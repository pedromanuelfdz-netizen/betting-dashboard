// Dashboard JavaScript - Estilo Telegram
// Carga y visualiza datos del bot de apuestas

async function loadDashboardData() {
    try {
        const response = await fetch('data.json');
        const data = await response.json();
        updateDashboard(data);
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        document.getElementById('lastUpdate').textContent = '❌ Error: No se pudo cargar los datos';
    }
}

function updateDashboard(data) {
    // Update last update time
    const lastUpdate = new Date(data.timestamp);
    document.getElementById('lastUpdate').textContent = 
        `Última actualización: ${lastUpdate.toLocaleString('es-ES', { 
            dateStyle: 'medium', 
            timeStyle: 'short' 
        })}`;

    // Render all sections
    createMainMetrics(data.summary);
    createBankrollChart(data.bankroll_history, data.summary);
    createMarketStats(data.by_market);
    createLeagueStats(data.by_league);
    createRecentBets(data.recent_bets);
    createCLVAnalysis(data.clv_analysis);
    createBotConfig();
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
// GRÁFICO DE BANKROLL
// ============================================
function createBankrollChart(history, summary) {
    const container = document.getElementById('bankrollChart');
    
    const inicial = history[0];
    const actual = history[history.length - 1];
    const max = Math.max(...history);
    const min = Math.min(...history);
    
    // Normalizar valores para sparkline
    const normalized = history.map(v => {
        const range = max - min;
        return range > 0 ? ((v - min) / range) * 100 : 50;
    });

    // Crear stats
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
            <div class="stat-box">
                <div class="stat-box-label">💸 Profit/Loss</div>
                <div class="stat-box-value" style="color: ${actual >= inicial ? '#10b981' : '#f59e0b'}">${actual >= inicial ? '+' : ''}€${(actual - inicial).toFixed(2)}</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">🎲 Apuestas</div>
                <div class="stat-box-value">${history.length}</div>
            </div>
        </div>
        
        <div class="sparkline">
            ${normalized.map(height => `
                <div class="sparkline-bar" style="height: ${height}%"></div>
            `).join('')}
        </div>
    `;
}

// ============================================
// STATS POR MERCADO
// ============================================
function createMarketStats(byMarket) {
    const container = document.getElementById('marketStats');
    
    if (!byMarket || Object.keys(byMarket).length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-emoji">📊</div>
                <div class="empty-state-text">No hay datos por mercado disponibles</div>
            </div>
        `;
        return;
    }

    const markets = Object.entries(byMarket).map(([name, data]) => ({
        name,
        ...data
    }));

    // Ordenar por ROI
    markets.sort((a, b) => b.roi - a.roi);

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>🎯 Mercado</th>
                        <th style="text-align: center">📊 Apuestas</th>
                        <th style="text-align: center">✅ Win Rate</th>
                        <th style="text-align: center">💰 ROI</th>
                        <th style="text-align: center">📈 Profit/Loss</th>
                    </tr>
                </thead>
                <tbody>
                    ${markets.map(m => {
                        const emoji = {
                            'Over 2.5': '🔼',
                            'Under 2.5': '🔽',
                            'BTTS Yes': '⚽⚽',
                            'BTTS No': '🚫⚽'
                        }[m.name] || '🎯';
                        
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
// STATS POR LIGA
// ============================================
function createLeagueStats(byLeague) {
    const container = document.getElementById('leagueStats');
    
    if (!byLeague || Object.keys(byLeague).length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-emoji">🏆</div>
                <div class="empty-state-text">No hay datos por liga disponibles</div>
            </div>
        `;
        return;
    }

    const leagues = Object.entries(byLeague).map(([name, data]) => ({
        name,
        ...data
    }));

    // Ordenar por número de picks (más activas primero)
    leagues.sort((a, b) => b.picks - a.picks);

    // Tomar top 10
    const topLeagues = leagues.slice(0, 10);

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
                    ${topLeagues.map((l, index) => {
                        const flag = {
                            'Premier League': '🏴󐁧󐁢󐁥󐁮󐁧󐁿',
                            'La Liga': '🇪🇸',
                            'Serie A': '🇮🇹',
                            'Bundesliga': '🇩🇪',
                            'Ligue 1': '🇫🇷',
                            'Eredivisie': '🇳🇱',
                            'Liga Portugal': '🇵🇹',
                            'Championship': '🏴󐁧󐁢󐁥󐁮󐁧󐁿',
                            'Serie B': '🇮🇹'
                        }[l.name] || '⚽';
                        
                        return `
                            <tr>
                                <td>
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="font-size: 18px;">${flag}</span>
                                        <strong>${l.name}</strong>
                                    </div>
                                </td>
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
        
        ${leagues.length > 10 ? `
            <div style="margin-top: 16px; padding: 12px; background: #f7f7f7; border-radius: 8px; text-align: center; font-size: 13px; color: #666;">
                Mostrando top 10 de ${leagues.length} ligas
            </div>
        ` : ''}
    `;
}

// ============================================
// ÚLTIMAS APUESTAS
// ============================================
function createRecentBets(recentBets) {
    const container = document.getElementById('recentBets');
    
    if (!recentBets || recentBets.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-emoji">📋</div>
                <div class="empty-state-text">No hay apuestas recientes</div>
            </div>
        `;
        return;
    }

    // Tomar últimas 20
    const bets = recentBets.slice(0, 20);

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
                        <th style="text-align: center">💰 Stake</th>
                        <th style="text-align: center">✅ Estado</th>
                    </tr>
                </thead>
                <tbody>
                    ${bets.map(bet => {
                        const date = new Date(bet.match_date);
                        const dateStr = date.toLocaleDateString('es-ES', { 
                            day: '2-digit', 
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
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
                                <td style="font-size: 12px;">${bet.league}</td>
                                <td>
                                    <div style="font-size: 13px; font-weight: 600;">${bet.home_team} vs ${bet.away_team}</div>
                                </td>
                                <td>
                                    <strong style="color: #0088cc;">${bet.selection}</strong>
                                </td>
                                <td style="text-align: center">
                                    <strong>${bet.betfair_odd}</strong>
                                </td>
                                <td style="text-align: center">
                                    <strong style="color: ${bet.edge >= 8 ? '#10b981' : '#f59e0b'}">
                                        +${bet.edge.toFixed(1)}%
                                    </strong>
                                </td>
                                <td style="text-align: center">
                                    <strong>${bet.kelly}%</strong>
                                </td>
                                <td style="text-align: center">
                                    ${statusBadge}
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
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-emoji">💎</div>
                <div class="empty-state-text">No hay datos CLV disponibles</div>
            </div>
        `;
        return;
    }

    const avgCLV = clvData.avg_clv || 0;
    const positiveCLV = clvData.positive_clv || 0;
    const negativeCLV = clvData.negative_clv || 0;
    const totalBets = positiveCLV + negativeCLV;
    const positivePct = totalBets > 0 ? (positiveCLV / totalBets) * 100 : 0;

    container.innerHTML = `
        <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%); padding: 24px; border-radius: 12px; border: 2px solid ${avgCLV >= 0 ? '#10b981' : '#f59e0b'};">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px;">
                <div>
                    <div style="font-size: 13px; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">💎 CLV Promedio</div>
                    <div style="font-size: 36px; font-weight: 800; color: ${avgCLV >= 0 ? '#10b981' : '#f59e0b'};">
                        ${avgCLV >= 0 ? '+' : ''}${avgCLV.toFixed(2)}%
                    </div>
                </div>
                <div>
                    <div style="font-size: 13px; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">✅ CLV Positivo</div>
                    <div style="font-size: 36px; font-weight: 800; color: #10b981;">
                        ${positiveCLV}
                    </div>
                    <div style="font-size: 13px; color: #666; margin-top: 4px;">${positivePct.toFixed(1)}% del total</div>
                </div>
                <div>
                    <div style="font-size: 13px; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">❌ CLV Negativo</div>
                    <div style="font-size: 36px; font-weight: 800; color: #f59e0b;">
                        ${negativeCLV}
                    </div>
                    <div style="font-size: 13px; color: #666; margin-top: 4px;">${(100 - positivePct).toFixed(1)}% del total</div>
                </div>
            </div>
            
            <div style="background: white; padding: 16px; border-radius: 8px;">
                <div style="font-size: 13px; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Distribución CLV</div>
                <div class="progress-bar" style="height: 12px;">
                    <div class="progress-fill" style="width: ${positivePct}%; background: linear-gradient(90deg, #10b981 0%, #34d399 100%);"></div>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; color: #666;">
                    <span>✅ ${positivePct.toFixed(0)}% positivo</span>
                    <span>❌ ${(100 - positivePct).toFixed(0)}% negativo</span>
                </div>
            </div>
            
            <div style="margin-top: 16px; padding: 16px; background: rgba(0, 136, 204, 0.1); border-radius: 8px; border-left: 4px solid #0088cc;">
                <strong style="color: #0088cc;">💡 ¿Qué significa CLV?</strong>
                <p style="margin: 8px 0 0 0; font-size: 13px; color: #666; line-height: 1.6;">
                    El Closing Line Value (CLV) mide si tus odds fueron mejores que las odds finales del mercado. 
                    CLV positivo indica que encontraste valor real antes del cierre. Un CLV promedio positivo es señal de un modelo exitoso a largo plazo.
                </p>
            </div>
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
                <div class="stat-box-label">📊 MIN EDGE BTTS</div>
                <div class="stat-box-value">8.5%</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">💰 KELLY</div>
                <div class="stat-box-value">0.15</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">💵 BANKROLL</div>
                <div class="stat-box-value">€200</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">🤖 MODELO</div>
                <div class="stat-box-value" style="font-size: 14px;">Dixon-Coles</div>
            </div>
        </div>
        
        <div style="margin-top: 20px; padding: 16px; background: #f7f7f7; border-radius: 8px; border-left: 4px solid #0088cc;">
            <strong style="color: #0088cc;">🎯 Fase 1 Activa</strong>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #666; line-height: 1.6;">
                • Calibración diferenciada por mercado (Over: α=0.88, Under: α=0.92)<br>
                • MIN_EDGE optimizado por mercado<br>
                • Kelly conservador (0.15) para reducir varianza<br>
                • Tracking de total_lambda, dc_weight, h2h_available, form_diff
            </p>
        </div>
    `;
}

// ============================================
// INICIALIZACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    loadDashboardData();
    
    // Auto-refresh cada 5 minutos
    setInterval(loadDashboardData, 5 * 60 * 1000);
});
