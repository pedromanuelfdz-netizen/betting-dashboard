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
    createLeagueStats(data.by_league, data.league_market_breakdown); // ← NUEVO PARÁMETRO
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
            label: '📈 Apuestas',
            value: summary.total_picks,
            delta: `Resueltas: ${summary.resolved}`,
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
    
    if (!racha || racha.count === 0) {
        container.style.display = 'none';
        return;
    }

    const icon = racha.type === 'win' ? '🔥' : '❄️';
    const text = racha.type === 'win' ? 'RACHA GANADORA' : 'RACHA PERDEDORA';
    
    container.innerHTML = `
        <div class="card-header">
            <h2>${icon} ${text}</h2>
        </div>
        <div style="text-align: center; padding: 20px 0;">
            <div class="racha-badge ${racha.type}">
                <span style="font-size: 24px;">${icon}</span>
                <span>${racha.count} apuestas consecutivas</span>
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
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">📈</div></div>';
        return;
    }

    // Convertir a formato uniforme si es array simple
    let historyArray;
    if (typeof history[0] === 'number') {
        // Es array simple de números, convertir a objetos
        historyArray = history.map((bankroll, i) => ({
            date: `Apuesta ${i + 1}`,
            bankroll: bankroll
        }));
    } else {
        // Ya es array de objetos
        historyArray = history;
    }

    // Tomar solo cada N elementos para no saturar (max 50 puntos)
    const step = Math.max(1, Math.floor(historyArray.length / 50));
    const sampledHistory = historyArray.filter((_, i) => i % step === 0 || i === historyArray.length - 1);

    const maxBankroll = Math.max(...sampledHistory.map(h => h.bankroll));
    const minBankroll = Math.min(...sampledHistory.map(h => h.bankroll));
    const range = maxBankroll - minBankroll;

    container.innerHTML = `
        <div class="bar-chart">
            ${sampledHistory.map((h, i) => {
                const height = range > 0 ? ((h.bankroll - minBankroll) / range) * 100 : 50;
                const color = h.bankroll >= summary.bankroll_inicial ? '#10b981' : '#f59e0b';
                
                return `
                    <div class="bar-item">
                        <div class="bar-header">
                            <span class="bar-label">${h.date}</span>
                            <span class="bar-value">€${h.bankroll.toFixed(2)}</span>
                        </div>
                        <div class="bar-track">
                            <div class="bar-fill" style="width: ${height}%; background: ${color};"></div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ============================================
// STATS POR MERCADO
// ============================================
function createMarketStats(byMarket) {
    const container = document.getElementById('marketStats');
    
    if (!byMarket || Object.keys(byMarket).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">🎯</div></div>';
        return;
    }

    container.innerHTML = `
        <div class="stats-row">
            ${Object.entries(byMarket).map(([market, data]) => `
                <div class="stat-box">
                    <div class="stat-box-label">${market}</div>
                    <div class="stat-box-value ${data.roi >= 0 ? '' : 'small'}" style="color: ${data.roi >= 0 ? '#10b981' : '#f59e0b'}">
                        ${data.roi >= 0 ? '+' : ''}${data.roi.toFixed(1)}%
                    </div>
                    <div style="font-size: 11px; color: #666; margin-top: 4px;">
                        ${data.picks} picks | WR ${data.win_rate.toFixed(1)}%
                    </div>
                </div>
            `).join('')}
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

    const edges = Object.entries(byEdge).sort((a, b) => {
        const aMin = parseFloat(a[0].split('-')[0].replace('%', ''));
        const bMin = parseFloat(b[0].split('-')[0].replace('%', ''));
        return aMin - bMin;
    });

    container.innerHTML = `
        <div class="bar-chart">
            ${edges.map(([range, data]) => `
                <div class="bar-item">
                    <div class="bar-header">
                        <span class="bar-label">${range}</span>
                        <span class="bar-value">${data.picks} picks | WR: ${data.win_rate.toFixed(1)}% | ROI: ${data.roi >= 0 ? '+' : ''}${data.roi.toFixed(1)}%</span>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill ${data.roi >= 0 ? 'positive' : 'negative'}" style="width: ${Math.min(Math.abs(data.roi) * 2, 100)}%"></div>
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

    const odds = Object.entries(byOdd).sort((a, b) => {
        const aMin = parseFloat(a[0].split('-')[0]);
        const bMin = parseFloat(b[0].split('-')[0]);
        return aMin - bMin;
    });

    container.innerHTML = `
        <div class="bar-chart">
            ${odds.map(([range, data]) => `
                <div class="bar-item">
                    <div class="bar-header">
                        <span class="bar-label">${range}</span>
                        <span class="bar-value">${data.picks} picks | WR: ${data.win_rate.toFixed(1)}% | ROI: ${data.roi >= 0 ? '+' : ''}${data.roi.toFixed(1)}%</span>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill ${data.roi >= 0 ? 'positive' : 'negative'}" style="width: ${Math.min(Math.abs(data.roi) * 2, 100)}%"></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ============================================
// ANÁLISIS TEMPORAL
// ============================================
function createTemporalStats(temporalStats) {
    const container = document.getElementById('temporalStats');
    
    if (!temporalStats || Object.keys(temporalStats).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">📅</div></div>';
        return;
    }

    // Convertir a array si es diccionario
    let statsArray;
    if (Array.isArray(temporalStats)) {
        statsArray = temporalStats;
    } else {
        // Es un diccionario (día de semana)
        statsArray = Object.entries(temporalStats).map(([day, data]) => ({
            date: day,
            picks: data.picks,
            win_rate: data.win_rate,
            roi: data.roi,
            profit: data.profit || 0
        }));
    }

    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>📅 Día</th>
                        <th style="text-align: center">📊 Picks</th>
                        <th style="text-align: center">✅ WR</th>
                        <th style="text-align: center">💰 ROI</th>
                        <th style="text-align: center">📈 P/L</th>
                    </tr>
                </thead>
                <tbody>
                    ${statsArray.map(day => `
                        <tr>
                            <td><strong>${day.date}</strong></td>
                            <td style="text-align: center">${day.picks}</td>
                            <td style="text-align: center">
                                <strong style="color: ${day.win_rate >= 50 ? '#10b981' : '#f59e0b'}">${day.win_rate.toFixed(1)}%</strong>
                            </td>
                            <td style="text-align: center">
                                <strong style="color: ${day.roi >= 0 ? '#10b981' : '#f59e0b'}; font-size: 16px;">
                                    ${day.roi >= 0 ? '+' : ''}${day.roi.toFixed(1)}%
                                </strong>
                            </td>
                            <td style="text-align: center">
                                ${day.profit !== undefined ? `
                                    <strong style="color: ${day.profit >= 0 ? '#10b981' : '#f59e0b'}">
                                        ${day.profit >= 0 ? '+' : ''}€${day.profit.toFixed(2)}
                                    </strong>
                                ` : '-'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================
// MERCADO × EDGE
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
        
        const sortedEdges = Object.entries(edges).sort((a, b) => {
            const aMin = parseFloat(a[0].split('-')[0].replace('%', ''));
            const bMin = parseFloat(b[0].split('-')[0].replace('%', ''));
            return aMin - bMin;
        });
        
        if (sortedEdges.length === 0) continue;
        
        html += `
            <div style="margin-bottom: 24px;">
                <h3 style="color: #0088cc; margin-bottom: 12px;">${emoji} ${market}</h3>
                <div class="bar-chart">
                    ${sortedEdges.map(([range, data]) => `
                        <div class="bar-item">
                            <div class="bar-header">
                                <span class="bar-label">${range}</span>
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
// MERCADO × LIGA - MEJORADO CON BTTS
// ============================================
function createMarketLeagueStats(marketLeagueStats) {
    const container = document.getElementById('marketLeagueStats');
    
    if (!marketLeagueStats || Object.keys(marketLeagueStats).length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">🎯🏆</div></div>';
        return;
    }

    // Orden específico de mercados para mostrar
    const marketOrder = ['Over 2.5', 'Under 2.5', 'BTTS Yes', 'BTTS No'];
    
    let html = '';
    for (const market of marketOrder) {
        if (!marketLeagueStats[market]) continue;
        
        const leagues = marketLeagueStats[market];
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
    
    container.innerHTML = html || '<div class="empty-state"><div class="empty-state-emoji">🎯🏆</div><div class="empty-state-text">No hay datos suficientes</div></div>';
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
// STATS POR LIGA - MEJORADO CON DESGLOSE POR MERCADO
// ============================================
function createLeagueStats(byLeague, leagueMarketBreakdown) {
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
                        <th style="text-align: center">📊 Total Picks</th>
                        <th style="text-align: center">✅ WR Global</th>
                        <th style="text-align: center">💰 ROI Global</th>
                        <th style="text-align: center">🔼 Over</th>
                        <th style="text-align: center">🔽 Under</th>
                        <th style="text-align: center">⚽ BTTS Y</th>
                        <th style="text-align: center">🚫 BTTS N</th>
                    </tr>
                </thead>
                <tbody>
                    ${topLeagues.map(l => {
                        const flag = {
                            'Premier League': '🏴󐁧󐁢󐁥󐁮󐁧󐁿', 'La Liga': '🇪🇸', 'Serie A': '🇮🇹',
                            'Bundesliga': '🇩🇪', 'Ligue 1': '🇫🇷'
                        }[l.name] || '⚽';
                        
                        // Obtener datos por mercado para esta liga
                        const marketData = leagueMarketBreakdown && leagueMarketBreakdown[l.name] || {};
                        
                        const formatMarketCell = (market) => {
                            if (!marketData[market] || marketData[market].picks === 0) {
                                return '<span style="color: #ccc; font-size: 11px;">-</span>';
                            }
                            const data = marketData[market];
                            const color = data.roi >= 0 ? '#10b981' : '#f59e0b';
                            return `
                                <div style="font-size: 11px;">
                                    <strong style="color: ${color}">${data.roi >= 0 ? '+' : ''}${data.roi.toFixed(1)}%</strong>
                                    <br>
                                    <span style="color: #999;">${data.picks}p | ${data.win_rate.toFixed(0)}%</span>
                                </div>
                            `;
                        };
                        
                        return `
                            <tr>
                                <td><span style="font-size: 18px;">${flag}</span> <strong>${l.name}</strong></td>
                                <td style="text-align: center"><strong>${l.picks}</strong></td>
                                <td style="text-align: center">
                                    <strong style="color: ${l.win_rate >= 50 ? '#10b981' : '#f59e0b'}">${l.win_rate.toFixed(1)}%</strong>
                                </td>
                                <td style="text-align: center">
                                    <strong style="color: ${l.roi >= 0 ? '#10b981' : '#f59e0b'}; font-size: 16px;">
                                        ${l.roi >= 0 ? '+' : ''}${l.roi.toFixed(1)}%
                                    </strong>
                                </td>
                                <td style="text-align: center">${formatMarketCell('Over 2.5')}</td>
                                <td style="text-align: center">${formatMarketCell('Under 2.5')}</td>
                                <td style="text-align: center">${formatMarketCell('BTTS Yes')}</td>
                                <td style="text-align: center">${formatMarketCell('BTTS No')}</td>
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
function createCLVAnalysis(clvAnalysis) {
    const container = document.getElementById('clvAnalysis');
    
    if (!clvAnalysis) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-emoji">💎</div></div>';
        return;
    }

    container.innerHTML = `
        <div class="stats-row">
            <div class="stat-box">
                <div class="stat-box-label">CLV Promedio</div>
                <div class="stat-box-value" style="color: ${clvAnalysis.avg_clv >= 0 ? '#10b981' : '#f59e0b'}">
                    ${clvAnalysis.avg_clv >= 0 ? '+' : ''}${clvAnalysis.avg_clv.toFixed(2)}%
                </div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">CLV Positivo</div>
                <div class="stat-box-value" style="color: #10b981">
                    ${clvAnalysis.positive_clv_count}
                </div>
                <div style="font-size: 11px; color: #666; margin-top: 4px;">
                    ${((clvAnalysis.positive_clv_count / clvAnalysis.total_with_clv) * 100).toFixed(1)}% del total
                </div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">CLV Negativo</div>
                <div class="stat-box-value" style="color: #f59e0b">
                    ${clvAnalysis.negative_clv_count}
                </div>
                <div style="font-size: 11px; color: #666; margin-top: 4px;">
                    ${((clvAnalysis.negative_clv_count / clvAnalysis.total_with_clv) * 100).toFixed(1)}% del total
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
                        <th>⚽ Partido</th>
                        <th>🎯 Selección</th>
                        <th style="text-align: center">💵 Cuota</th>
                        <th style="text-align: center">📊 Edge</th>
                        <th style="text-align: center">🏆 Result</th>
                    </tr>
                </thead>
                <tbody>
                    ${recentBets.map(b => `
                        <tr>
                            <td style="font-size: 12px;">${b.date}</td>
                            <td>
                                <strong>${b.home}</strong> vs <strong>${b.away}</strong>
                                <br>
                                <span style="font-size: 11px; color: #999;">${b.league}</span>
                            </td>
                            <td><strong>${b.selection}</strong></td>
                            <td style="text-align: center"><strong>${b.odd}</strong></td>
                            <td style="text-align: center">
                                <strong style="color: ${b.edge >= 10 ? '#10b981' : '#0088cc'}">${b.edge.toFixed(1)}%</strong>
                            </td>
                            <td style="text-align: center">
                                <span class="badge ${b.result.toLowerCase()}">${b.result}</span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================
// CONFIG DEL BOT
// ============================================
function createBotConfig() {
    const container = document.getElementById('botConfig');
    
    container.innerHTML = `
        <div class="stats-row">
            <div class="stat-box">
                <div class="stat-box-label">Min Edge</div>
                <div class="stat-box-value small">Variable</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">Kelly Fraction</div>
                <div class="stat-box-value small">0.25x</div>
            </div>
            <div class="stat-box">
                <div class="stat-box-label">Bankroll Inicial</div>
                <div class="stat-box-value small">€200</div>
            </div>
        </div>
    `;
}

// Inicializar al cargar la página
document.addEventListener('DOMContentLoaded', loadDashboardData);
