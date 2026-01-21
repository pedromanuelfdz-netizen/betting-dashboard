// Dashboard JavaScript V3 - Métricas Avanzadas
// Optimizado para carga rápida con lazy rendering

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

    // Render secciones básicas
    createSimpleBankrollChart(data.bankroll_history);
    createOddRangeSection(data.by_odd_range);
    createLeagueSection(data.by_league);
    createMarketSection(data.by_market);
    createRecentBetsSection(data.recent_bets);
    
    // NUEVAS SECCIONES AVANZADAS
    createTemporalAnalysis(data.temporal_analysis);
    createCLVAnalysis(data.clv_analysis);
    createKellyBankrollSection(data.kelly_bankroll);
    createTeamAnalysis(data.team_analysis);
    createConfidenceAnalysis(data.confidence_analysis);
    createHeatmapSection(data.heatmap);
}

// ============================================
// SECCIONES BÁSICAS (mantener)
// ============================================

function createSimpleBankrollChart(history) {
    const container = document.getElementById('bankrollChart').parentElement;
    
    const inicial = history[0];
    const actual = history[history.length - 1];
    const max = Math.max(...history);
    const min = Math.min(...history);
    const cambio = actual - inicial;
    const cambioPct = ((cambio / inicial) * 100).toFixed(1);
    
    const normalized = history.map(v => Math.round(((v - min) / (max - min)) * 10));
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
    
    const dataArray = Array.isArray(oddRangeData) ? oddRangeData : 
        Object.entries(oddRangeData).map(([range, data]) => ({ range, ...data }));
    
    dataArray.sort((a, b) => b.picks - a.picks);
    
    container.innerHTML = `
        <div style="padding: 20px; background: rgba(59, 130, 246, 0.05); border-radius: 8px; border-left: 4px solid #3b82f6;">
            <h3 style="margin: 0 0 15px 0; color: #3b82f6; font-size: 14px;">📊 PERFORMANCE POR ODD RANGE</h3>
            
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <th style="text-align: left; padding: 8px; color: #94a3b8; font-weight: 600;">Range</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">n</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">WR%</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">ROI%</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Yield%</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${dataArray.map(item => {
                            const roi = item.roi || 0;
                            const roiColor = roi > 0 ? '#10b981' : '#ef4444';
                            return `
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                    <td style="padding: 10px 8px; color: #fff; font-weight: 500;">${item.range}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #e2e8f0;">${item.picks}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #fff;">${item.win_rate.toFixed(1)}%</td>
                                    <td style="padding: 10px 8px; text-align: center; color: ${roiColor}; font-weight: 600;">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</td>
                                    <td style="padding: 10px 8px; text-align: center; color: ${roiColor};">${item.yield >= 0 ? '+' : ''}${item.yield.toFixed(1)}%</td>
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
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">No hay datos</td></tr>';
        return;
    }
    
    const sorted = [...leagueData].sort((a, b) => (b.roi || 0) - (a.roi || 0));
    
    tbody.innerHTML = sorted.map(league => {
        const roi = league.roi || 0;
        const statusClass = roi > 10 ? 'status-good' : roi > 0 ? 'status-warning' : 'status-bad';
        const statusText = roi > 10 ? '🔥 Excel' : roi > 0 ? '✅ Pos' : '⚠️ Neg';
        
        let marketsHTML = '';
        if (league.markets && league.markets.length > 0) {
            marketsHTML = `<div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">
                ${league.markets.slice(0, 2).map(m => {
                    const mRoi = m.roi || 0;
                    return `<span style="margin-right: 8px;">${m.market}: <span style="color: ${mRoi > 0 ? '#10b981' : '#ef4444'};">${mRoi >= 0 ? '+' : ''}${mRoi.toFixed(1)}%</span></span>`;
                }).join('')}
            </div>`;
        }
        
        return `
            <tr>
                <td><div style="font-weight: 600;">${league.league}</div>${marketsHTML}</td>
                <td style="text-align: center;">${league.picks}</td>
                <td style="text-align: center;">${league.win_rate.toFixed(1)}%</td>
                <td style="text-align: center; color: ${roi > 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                    ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
                </td>
                <td style="text-align: center;"><span class="${statusClass}">${statusText}</span></td>
            </tr>
        `;
    }).join('');
}

function createMarketSection(marketData) {
    const parent = document.getElementById('leagueTable').closest('.table-container').parentElement;
    
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
                </tr>
            </thead>
            <tbody>
                ${sorted.map(market => {
                    const roi = market.roi || 0;
                    return `
                        <tr>
                            <td style="font-weight: 600; max-width: 250px;">${market.market}</td>
                            <td style="text-align: center;">${market.picks}</td>
                            <td style="text-align: center;">${market.win_rate.toFixed(1)}%</td>
                            <td style="text-align: center; color: ${roi > 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                                ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
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
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">No hay datos</td></tr>';
        return;
    }
    
    tbody.innerHTML = recentBets.map(bet => {
        const resultClass = bet.result === 'Ganada' ? 'result-won' : bet.result === 'Perdida' ? 'result-lost' : 'result-pending';
        
        return `
            <tr>
                <td style="font-size: 11px; color: #94a3b8;">
                    ${bet.date}
                    ${bet.league ? `<div style="font-size: 9px; color: #64748b;">${bet.league}</div>` : ''}
                </td>
                <td>
                    <div style="font-weight: 500; font-size: 13px;">${bet.match}</div>
                </td>
                <td style="text-align: center; font-size: 12px;">${bet.selection}</td>
                <td style="text-align: center; font-weight: 600;">${bet.odd.toFixed(2)}</td>
                <td style="text-align: center;"><span class="${resultClass}">${bet.result}</span></td>
            </tr>
        `;
    }).join('');
}

// ============================================
// NUEVAS SECCIONES AVANZADAS
// ============================================

function createTemporalAnalysis(temporal) {
    if (!temporal) return;
    
    const parent = document.querySelector('.charts-row');
    
    // Crear contenedor si no existe
    let container = document.getElementById('temporalSection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'temporalSection';
        container.className = 'chart-container';
        parent.appendChild(container);
    }
    
    const { by_weekday = [], by_hour = [], trends = {}, streaks = {} } = temporal;
    
    // Por día de semana
    const weekdayHTML = by_weekday.length > 0 ? `
        <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #94a3b8;">📅 Por Día de Semana</h4>
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px;">
                ${by_weekday.map(day => {
                    const roi = day.roi || 0;
                    const color = roi > 0 ? '#10b981' : '#ef4444';
                    return `
                        <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">${day.day.substring(0,3)}</div>
                            <div style="font-size: 14px; font-weight: bold; color: ${color};">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</div>
                            <div style="font-size: 9px; color: #64748b;">${day.picks}p</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    ` : '';
    
    // Tendencias
    const trendsHTML = trends.last_7_days ? `
        <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #94a3b8;">📈 Tendencias Recientes</h4>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                ${[
                    { label: 'Últ 7d', data: trends.last_7_days },
                    { label: 'Últ 14d', data: trends.last_14_days },
                    { label: 'Últ 30d', data: trends.last_30_days }
                ].filter(t => t.data).map(t => {
                    const roi = t.data.roi || 0;
                    const color = roi > 0 ? '#10b981' : '#ef4444';
                    return `
                        <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">${t.label}</div>
                            <div style="font-size: 16px; font-weight: bold; color: ${color};">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</div>
                            <div style="font-size: 10px; color: #64748b;">${t.data.picks} picks • WR ${t.data.win_rate.toFixed(1)}%</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    ` : '';
    
    // Rachas
    const streaksHTML = streaks.current_streak ? `
        <div>
            <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #94a3b8;">🔥 Rachas</h4>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8;">Racha Actual</div>
                    <div style="font-size: 16px; font-weight: bold; color: ${streaks.current_streak_type === 'Ganada' ? '#10b981' : '#ef4444'};">
                        ${streaks.current_streak} ${streaks.current_streak_type === 'Ganada' ? 'W' : 'L'}
                    </div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8;">Max Ganadas</div>
                    <div style="font-size: 16px; font-weight: bold; color: #10b981;">${streaks.max_winning_streak}</div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8;">Max Perdidas</div>
                    <div style="font-size: 16px; font-weight: bold; color: #ef4444;">${streaks.max_losing_streak}</div>
                </div>
            </div>
        </div>
    ` : '';
    
    container.innerHTML = `
        <div style="padding: 20px; background: rgba(168, 85, 247, 0.05); border-radius: 8px; border-left: 4px solid #a855f7;">
            <h3 style="margin: 0 0 15px 0; color: #a855f7; font-size: 14px;">⏰ ANÁLISIS TEMPORAL</h3>
            ${weekdayHTML}
            ${trendsHTML}
            ${streaksHTML}
        </div>
    `;
}

function createCLVAnalysis(clv) {
    if (!clv || !clv.avg_clv) return;
    
    const parent = document.querySelector('.charts-row');
    
    let container = document.getElementById('clvSection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'clvSection';
        container.className = 'chart-container';
        parent.appendChild(container);
    }
    
    const avgColor = clv.avg_clv > 0 ? '#10b981' : '#ef4444';
    const posColor = clv.clv_positive_pct > 50 ? '#10b981' : '#ef4444';
    
    container.innerHTML = `
        <div style="padding: 20px; background: rgba(34, 211, 238, 0.05); border-radius: 8px; border-left: 4px solid #22d3ee;">
            <h3 style="margin: 0 0 15px 0; color: #22d3ee; font-size: 14px;">💎 CLOSING LINE VALUE (CLV)</h3>
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 15px;">
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">CLV Promedio</div>
                    <div style="font-size: 18px; font-weight: bold; color: ${avgColor};">${clv.avg_clv >= 0 ? '+' : ''}${clv.avg_clv.toFixed(2)}%</div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">% CLV Positivo</div>
                    <div style="font-size: 18px; font-weight: bold; color: ${posColor};">${clv.clv_positive_pct.toFixed(1)}%</div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">Apuestas con CLV</div>
                    <div style="font-size: 18px; font-weight: bold; color: #fff;">${clv.total_with_clv}</div>
                </div>
            </div>
            
            <div style="font-size: 11px; color: #94a3b8;">
                CLV Ganadas: <span style="color: #10b981; font-weight: 600;">${clv.avg_clv_won >= 0 ? '+' : ''}${clv.avg_clv_won.toFixed(2)}%</span> • 
                CLV Perdidas: <span style="color: #ef4444; font-weight: 600;">${clv.avg_clv_lost >= 0 ? '+' : ''}${clv.avg_clv_lost.toFixed(2)}%</span>
            </div>
        </div>
    `;
}

function createKellyBankrollSection(kelly) {
    if (!kelly) return;
    
    const parent = document.querySelector('.charts-row');
    
    let container = document.getElementById('kellySection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'kellySection';
        container.className = 'chart-container';
        parent.appendChild(container);
    }
    
    const ddColor = kelly.max_drawdown_pct < 20 ? '#10b981' : kelly.max_drawdown_pct < 30 ? '#f59e0b' : '#ef4444';
    const sharpeColor = kelly.sharpe_ratio > 1 ? '#10b981' : kelly.sharpe_ratio > 0 ? '#f59e0b' : '#ef4444';
    
    container.innerHTML = `
        <div style="padding: 20px; background: rgba(245, 158, 11, 0.05); border-radius: 8px; border-left: 4px solid #f59e0b;">
            <h3 style="margin: 0 0 15px 0; color: #f59e0b; font-size: 14px;">💰 KELLY & BANKROLL MANAGEMENT</h3>
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px;">
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8;">Kelly Promedio</div>
                    <div style="font-size: 16px; font-weight: bold; color: #fff;">${kelly.avg_kelly.toFixed(2)}%</div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8;">Stake Promedio</div>
                    <div style="font-size: 16px; font-weight: bold; color: #fff;">€${kelly.avg_stake.toFixed(2)}</div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8;">Sharpe Ratio</div>
                    <div style="font-size: 16px; font-weight: bold; color: ${sharpeColor};">${kelly.sharpe_ratio.toFixed(2)}</div>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8;">Max Drawdown</div>
                    <div style="font-size: 16px; font-weight: bold; color: ${ddColor};">€${kelly.max_drawdown.toFixed(2)} (${kelly.max_drawdown_pct.toFixed(1)}%)</div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #94a3b8;">Recovery Factor</div>
                    <div style="font-size: 16px; font-weight: bold; color: #fff;">${kelly.recovery_factor.toFixed(2)}</div>
                </div>
            </div>
        </div>
    `;
}

function createTeamAnalysis(teams) {
    if (!teams || (!teams.over_friendly && !teams.under_friendly)) return;
    
    const parent = document.querySelector('.tables-row');
    
    let container = document.getElementById('teamsSection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'teamsSection';
        container.className = 'table-container';
        parent.appendChild(container);
    }
    
    const overHTML = teams.over_friendly && teams.over_friendly.length > 0 ? `
        <div style="margin-bottom: 15px;">
            <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #10b981;">⬆️ Top Over Friendly</h4>
            <table style="width: 100%; font-size: 11px;">
                ${teams.over_friendly.slice(0, 5).map((team, i) => `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="padding: 6px; color: #94a3b8;">${i+1}.</td>
                        <td style="padding: 6px; color: #fff;">${team.team}</td>
                        <td style="padding: 6px; text-align: center; color: #64748b;">${team.picks}p</td>
                        <td style="padding: 6px; text-align: right; color: #10b981; font-weight: 600;">${team.win_rate.toFixed(1)}%</td>
                    </tr>
                `).join('')}
            </table>
        </div>
    ` : '';
    
    const underHTML = teams.under_friendly && teams.under_friendly.length > 0 ? `
        <div>
            <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #3b82f6;">⬇️ Top Under Friendly</h4>
            <table style="width: 100%; font-size: 11px;">
                ${teams.under_friendly.slice(0, 5).map((team, i) => `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="padding: 6px; color: #94a3b8;">${i+1}.</td>
                        <td style="padding: 6px; color: #fff;">${team.team}</td>
                        <td style="padding: 6px; text-align: center; color: #64748b;">${team.picks}p</td>
                        <td style="padding: 6px; text-align: right; color: #3b82f6; font-weight: 600;">${team.win_rate.toFixed(1)}%</td>
                    </tr>
                `).join('')}
            </table>
        </div>
    ` : '';
    
    container.innerHTML = `
        <h2>⚽ Análisis de Equipos</h2>
        <div style="padding: 15px; background: rgba(255,255,255,0.03); border-radius: 8px;">
            ${overHTML}
            ${underHTML}
        </div>
    `;
}

function createConfidenceAnalysis(confidence) {
    if (!confidence || !confidence.by_range || confidence.by_range.length === 0) return;
    
    const parent = document.querySelector('.tables-row');
    
    let container = document.getElementById('confidenceSection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'confidenceSection';
        container.className = 'table-container';
        parent.appendChild(container);
    }
    
    container.innerHTML = `
        <h2>🎯 Análisis Confidence Score</h2>
        <table>
            <thead>
                <tr>
                    <th>Rango</th>
                    <th style="text-align: center;">Picks</th>
                    <th style="text-align: center;">WR%</th>
                    <th style="text-align: center;">ROI%</th>
                </tr>
            </thead>
            <tbody>
                ${confidence.by_range.map(range => {
                    const roi = range.roi || 0;
                    return `
                        <tr>
                            <td style="font-weight: 600;">${range.range}</td>
                            <td style="text-align: center;">${range.picks}</td>
                            <td style="text-align: center;">${range.win_rate.toFixed(1)}%</td>
                            <td style="text-align: center; color: ${roi > 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                                ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

function createHeatmapSection(heatmap) {
    if (!heatmap || heatmap.length === 0) return;
    
    const parent = document.querySelector('.tables-row');
    
    let container = document.getElementById('heatmapSection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'heatmapSection';
        container.className = 'table-container';
        parent.appendChild(container);
    }
    
    // Agrupar por liga
    const byLeague = {};
    heatmap.forEach(cell => {
        if (!byLeague[cell.league]) byLeague[cell.league] = [];
        byLeague[cell.league].push(cell);
    });
    
    // Tomar top 5 ligas por picks
    const topLeagues = Object.entries(byLeague)
        .map(([league, cells]) => ({
            league,
            totalPicks: cells.reduce((sum, c) => sum + c.picks, 0),
            cells
        }))
        .sort((a, b) => b.totalPicks - a.totalPicks)
        .slice(0, 5);
    
    container.innerHTML = `
        <h2>🗺️ Heatmap: Liga × Mercado</h2>
        <div style="overflow-x: auto;">
            ${topLeagues.map(({ league, cells }) => `
                <div style="margin-bottom: 15px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 6px;">
                    <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #fff;">${league}</h4>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        ${cells.map(cell => {
                            const roi = cell.roi || 0;
                            const bgColor = roi > 10 ? 'rgba(16, 185, 129, 0.2)' : 
                                          roi > 0 ? 'rgba(245, 158, 11, 0.2)' : 
                                          'rgba(239, 68, 68, 0.2)';
                            return `
                                <div style="background: ${bgColor}; padding: 8px; border-radius: 4px; min-width: 120px;">
                                    <div style="font-size: 10px; color: #94a3b8;">${cell.market}</div>
                                    <div style="font-size: 14px; font-weight: bold; color: ${roi > 0 ? '#10b981' : '#ef4444'};">
                                        ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
                                    </div>
                                    <div style="font-size: 9px; color: #64748b;">${cell.picks}p • WR ${cell.win_rate.toFixed(1)}%</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Load on page ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDashboardData);
} else {
    loadDashboardData();
}
