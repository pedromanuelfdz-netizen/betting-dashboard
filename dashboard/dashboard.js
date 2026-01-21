// Dashboard JavaScript V3 - Métricas Avanzadas
// Con paleta de colores mejorada para mejor visibilidad

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
        <div style="padding: 20px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%); border-radius: 12px; border: 2px solid #10b981;">
            <h3 style="margin: 0 0 15px 0; color: #10b981; font-size: 16px; font-weight: 700;">📈 EVOLUCIÓN BANKROLL</h3>
            
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 15px;">
                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                    <div style="font-size: 11px; color: #86efac; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Inicial</div>
                    <div style="font-size: 18px; font-weight: bold; color: #fff;">€${inicial.toFixed(2)}</div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                    <div style="font-size: 11px; color: #86efac; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Actual</div>
                    <div style="font-size: 18px; font-weight: bold; color: ${actual >= inicial ? '#10b981' : '#f59e0b'};">€${actual.toFixed(2)}</div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                    <div style="font-size: 11px; color: #86efac; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Máximo</div>
                    <div style="font-size: 18px; font-weight: bold; color: #fff;">€${max.toFixed(2)}</div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                    <div style="font-size: 11px; color: #86efac; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Mínimo</div>
                    <div style="font-size: 18px; font-weight: bold; color: #fff;">€${min.toFixed(2)}</div>
                </div>
            </div>
            
            <div style="font-family: monospace; font-size: 10px; line-height: 1.2; color: #10b981; letter-spacing: 2px; overflow-x: auto; white-space: nowrap; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px;">
                ${sparkline}
            </div>
            
            <div style="margin-top: 12px; font-size: 14px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px;">
                <span style="color: #86efac; font-weight: 600;">Cambio total:</span>
                <span style="color: ${cambio >= 0 ? '#10b981' : '#f59e0b'}; font-weight: bold; margin-left: 8px; font-size: 16px;">
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
        <div style="padding: 20px; background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.05) 100%); border-radius: 12px; border: 2px solid #3b82f6;">
            <h3 style="margin: 0 0 15px 0; color: #60a5fa; font-size: 16px; font-weight: 700;">📊 PERFORMANCE POR ODD RANGE</h3>
            
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="border-bottom: 2px solid rgba(96, 165, 250, 0.3);">
                            <th style="text-align: left; padding: 12px; color: #93c5fd; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Range</th>
                            <th style="text-align: center; padding: 12px; color: #93c5fd; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">n</th>
                            <th style="text-align: center; padding: 12px; color: #93c5fd; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">WR%</th>
                            <th style="text-align: center; padding: 12px; color: #93c5fd; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">ROI%</th>
                            <th style="text-align: center; padding: 12px; color: #93c5fd; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Yield%</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${dataArray.map(item => {
                            const roi = item.roi || 0;
                            const roiColor = roi > 5 ? '#10b981' : roi > 0 ? '#fbbf24' : '#f87171';
                            return `
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.08); transition: background 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.1)'" onmouseout="this.style.background='transparent'">
                                    <td style="padding: 14px 12px; color: #fff; font-weight: 600; font-size: 14px;">${item.range}</td>
                                    <td style="padding: 14px 12px; text-align: center; color: #e0e7ff; font-size: 14px;">${item.picks}</td>
                                    <td style="padding: 14px 12px; text-align: center; color: #ddd6fe; font-size: 14px; font-weight: 500;">${item.win_rate.toFixed(1)}%</td>
                                    <td style="padding: 14px 12px; text-align: center; color: ${roiColor}; font-weight: 700; font-size: 15px;">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</td>
                                    <td style="padding: 14px 12px; text-align: center; color: ${roiColor}; font-weight: 500; font-size: 14px;">${item.yield >= 0 ? '+' : ''}${item.yield.toFixed(1)}%</td>
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
            marketsHTML = `<div style="font-size: 11px; color: #cbd5e1; margin-top: 6px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px;">
                ${league.markets.slice(0, 2).map(m => {
                    const mRoi = m.roi || 0;
                    const mColor = mRoi > 5 ? '#10b981' : mRoi > 0 ? '#fbbf24' : '#f87171';
                    return `<span style="margin-right: 10px; display: inline-block;">${m.market}: <span style="color: ${mColor}; font-weight: 700;">${mRoi >= 0 ? '+' : ''}${mRoi.toFixed(1)}%</span></span>`;
                }).join('')}
            </div>`;
        }
        
        return `
            <tr style="transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                <td><div style="font-weight: 700; font-size: 14px; color: #fff;">${league.league}</div>${marketsHTML}</td>
                <td style="text-align: center; font-size: 14px; color: #e0e7ff;">${league.picks}</td>
                <td style="text-align: center; font-size: 14px; color: #ddd6fe; font-weight: 500;">${league.win_rate.toFixed(1)}%</td>
                <td style="text-align: center; color: ${roi > 5 ? '#10b981' : roi > 0 ? '#fbbf24' : '#f87171'}; font-weight: 700; font-size: 15px;">
                    ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
                </td>
                <td style="text-align: center;"><span class="${statusClass}" style="font-size: 12px;">${statusText}</span></td>
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
        <h2 style="color: #fbbf24; font-size: 18px;">🎯 Performance por Mercado</h2>
        <table>
            <thead>
                <tr>
                    <th style="color: #fde68a;">Mercado</th>
                    <th style="text-align: center; color: #fde68a;">n</th>
                    <th style="text-align: center; color: #fde68a;">WR%</th>
                    <th style="text-align: center; color: #fde68a;">ROI%</th>
                </tr>
            </thead>
            <tbody>
                ${sorted.map(market => {
                    const roi = market.roi || 0;
                    const roiColor = roi > 5 ? '#10b981' : roi > 0 ? '#fbbf24' : '#f87171';
                    return `
                        <tr style="transition: background 0.2s;" onmouseover="this.style.background='rgba(251, 191, 36, 0.1)'" onmouseout="this.style.background='transparent'">
                            <td style="font-weight: 600; max-width: 250px; font-size: 14px; color: #fff;">${market.market}</td>
                            <td style="text-align: center; font-size: 14px; color: #fef3c7;">${market.picks}</td>
                            <td style="text-align: center; font-size: 14px; color: #fde68a; font-weight: 500;">${market.win_rate.toFixed(1)}%</td>
                            <td style="text-align: center; color: ${roiColor}; font-weight: 700; font-size: 15px;">
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
            <tr style="transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                <td style="font-size: 12px; color: #cbd5e1;">
                    ${bet.date}
                    ${bet.league ? `<div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">${bet.league}</div>` : ''}
                </td>
                <td>
                    <div style="font-weight: 600; font-size: 13px; color: #fff;">${bet.match}</div>
                </td>
                <td style="text-align: center; font-size: 12px; color: #e0e7ff;">${bet.selection}</td>
                <td style="text-align: center; font-weight: 700; font-size: 14px; color: #fde68a;">${bet.odd.toFixed(2)}</td>
                <td style="text-align: center;"><span class="${resultClass}" style="font-weight: 700; font-size: 13px;">${bet.result}</span></td>
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
            <h4 style="margin: 0 0 12px 0; font-size: 13px; color: #c4b5fd; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">📅 Por Día de Semana</h4>
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">
                ${by_weekday.map(day => {
                    const roi = day.roi || 0;
                    const color = roi > 5 ? '#10b981' : roi > 0 ? '#fbbf24' : '#f87171';
                    const bgColor = roi > 5 ? 'rgba(16, 185, 129, 0.15)' : roi > 0 ? 'rgba(251, 191, 36, 0.15)' : 'rgba(248, 113, 113, 0.15)';
                    return `
                        <div style="background: ${bgColor}; padding: 12px; border-radius: 8px; text-align: center; border: 1px solid ${color};">
                            <div style="font-size: 11px; color: #e9d5ff; margin-bottom: 6px; font-weight: 600; text-transform: uppercase;">${day.day.substring(0,3)}</div>
                            <div style="font-size: 16px; font-weight: bold; color: ${color};">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</div>
                            <div style="font-size: 10px; color: #c4b5fd; margin-top: 4px;">${day.picks} picks</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    ` : '';
    
    // Tendencias
    const trendsHTML = trends.last_7_days ? `
        <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 12px 0; font-size: 13px; color: #c4b5fd; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">📈 Tendencias Recientes</h4>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                ${[
                    { label: 'Últimos 7 días', data: trends.last_7_days },
                    { label: 'Últimos 14 días', data: trends.last_14_days },
                    { label: 'Últimos 30 días', data: trends.last_30_days }
                ].filter(t => t.data).map(t => {
                    const roi = t.data.roi || 0;
                    const color = roi > 5 ? '#10b981' : roi > 0 ? '#fbbf24' : '#f87171';
                    const bgColor = roi > 5 ? 'rgba(16, 185, 129, 0.15)' : roi > 0 ? 'rgba(251, 191, 36, 0.15)' : 'rgba(248, 113, 113, 0.15)';
                    return `
                        <div style="background: ${bgColor}; padding: 14px; border-radius: 8px; border: 1px solid ${color};">
                            <div style="font-size: 11px; color: #e9d5ff; margin-bottom: 6px; font-weight: 600; text-transform: uppercase;">${t.label}</div>
                            <div style="font-size: 20px; font-weight: bold; color: ${color};">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</div>
                            <div style="font-size: 11px; color: #c4b5fd; margin-top: 6px;">${t.data.picks} picks • WR ${t.data.win_rate.toFixed(1)}%</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    ` : '';
    
    // Rachas
    const streaksHTML = streaks.current_streak ? `
        <div>
            <h4 style="margin: 0 0 12px 0; font-size: 13px; color: #c4b5fd; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">🔥 Rachas</h4>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                <div style="background: ${streaks.current_streak_type === 'Ganada' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(248, 113, 113, 0.15)'}; padding: 14px; border-radius: 8px; border: 2px solid ${streaks.current_streak_type === 'Ganada' ? '#10b981' : '#f87171'};">
                    <div style="font-size: 11px; color: #e9d5ff; font-weight: 600; text-transform: uppercase;">Racha Actual</div>
                    <div style="font-size: 22px; font-weight: bold; color: ${streaks.current_streak_type === 'Ganada' ? '#10b981' : '#f87171'}; margin-top: 6px;">
                        ${streaks.current_streak} ${streaks.current_streak_type === 'Ganada' ? 'W' : 'L'}
                    </div>
                </div>
                <div style="background: rgba(16, 185, 129, 0.15); padding: 14px; border-radius: 8px; border: 1px solid #10b981;">
                    <div style="font-size: 11px; color: #86efac; font-weight: 600; text-transform: uppercase;">Max Ganadas</div>
                    <div style="font-size: 22px; font-weight: bold; color: #10b981; margin-top: 6px;">${streaks.max_winning_streak}</div>
                </div>
                <div style="background: rgba(248, 113, 113, 0.15); padding: 14px; border-radius: 8px; border: 1px solid #f87171;">
                    <div style="font-size: 11px; color: #fca5a5; font-weight: 600; text-transform: uppercase;">Max Perdidas</div>
                    <div style="font-size: 22px; font-weight: bold; color: #f87171; margin-top: 6px;">${streaks.max_losing_streak}</div>
                </div>
            </div>
        </div>
    ` : '';
    
    container.innerHTML = `
        <div style="padding: 20px; background: linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(126, 34, 206, 0.05) 100%); border-radius: 12px; border: 2px solid #a855f7;">
            <h3 style="margin: 0 0 18px 0; color: #e9d5ff; font-size: 16px; font-weight: 700;">⏰ ANÁLISIS TEMPORAL</h3>
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
    
    const avgColor = clv.avg_clv > 0 ? '#10b981' : '#f87171';
    const avgBg = clv.avg_clv > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(248, 113, 113, 0.15)';
    const posColor = clv.clv_positive_pct > 50 ? '#10b981' : '#f87171';
    const posBg = clv.clv_positive_pct > 50 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(248, 113, 113, 0.15)';
    
    container.innerHTML = `
        <div style="padding: 20px; background: linear-gradient(135deg, rgba(34, 211, 238, 0.15) 0%, rgba(6, 182, 212, 0.05) 100%); border-radius: 12px; border: 2px solid #22d3ee;">
            <h3 style="margin: 0 0 18px 0; color: #a5f3fc; font-size: 16px; font-weight: 700;">💎 CLOSING LINE VALUE (CLV)</h3>
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 15px;">
                <div style="background: ${avgBg}; padding: 16px; border-radius: 8px; border: 2px solid ${avgColor};">
                    <div style="font-size: 11px; color: #cffafe; margin-bottom: 6px; font-weight: 600; text-transform: uppercase;">CLV Promedio</div>
                    <div style="font-size: 22px; font-weight: bold; color: ${avgColor};">${clv.avg_clv >= 0 ? '+' : ''}${clv.avg_clv.toFixed(2)}%</div>
                </div>
                <div style="background: ${posBg}; padding: 16px; border-radius: 8px; border: 2px solid ${posColor};">
                    <div style="font-size: 11px; color: #cffafe; margin-bottom: 6px; font-weight: 600; text-transform: uppercase;">% CLV Positivo</div>
                    <div style="font-size: 22px; font-weight: bold; color: ${posColor};">${clv.clv_positive_pct.toFixed(1)}%</div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; border: 1px solid #22d3ee;">
                    <div style="font-size: 11px; color: #cffafe; margin-bottom: 6px; font-weight: 600; text-transform: uppercase;">Apuestas con CLV</div>
                    <div style="font-size: 22px; font-weight: bold; color: #fff;">${clv.total_with_clv}</div>
                </div>
            </div>
            
            <div style="font-size: 13px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 6px;">
                <span style="color: #a5f3fc; font-weight: 600;">CLV Ganadas:</span>
                <span style="color: #10b981; font-weight: 700; margin-left: 6px;">${clv.avg_clv_won >= 0 ? '+' : ''}${clv.avg_clv_won.toFixed(2)}%</span>
                <span style="color: #a5f3fc; font-weight: 600; margin-left: 16px;">CLV Perdidas:</span>
                <span style="color: #f87171; font-weight: 700; margin-left: 6px;">${clv.avg_clv_lost >= 0 ? '+' : ''}${clv.avg_clv_lost.toFixed(2)}%</span>
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
    
    const ddColor = kelly.max_drawdown_pct < 20 ? '#10b981' : kelly.max_drawdown_pct < 30 ? '#fbbf24' : '#f87171';
    const ddBg = kelly.max_drawdown_pct < 20 ? 'rgba(16, 185, 129, 0.15)' : kelly.max_drawdown_pct < 30 ? 'rgba(251, 191, 36, 0.15)' : 'rgba(248, 113, 113, 0.15)';
    const sharpeColor = kelly.sharpe_ratio > 1 ? '#10b981' : kelly.sharpe_ratio > 0 ? '#fbbf24' : '#f87171';
    const sharpeBg = kelly.sharpe_ratio > 1 ? 'rgba(16, 185, 129, 0.15)' : kelly.sharpe_ratio > 0 ? 'rgba(251, 191, 36, 0.15)' : 'rgba(248, 113, 113, 0.15)';
    
    container.innerHTML = `
        <div style="padding: 20px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.05) 100%); border-radius: 12px; border: 2px solid #f59e0b;">
            <h3 style="margin: 0 0 18px 0; color: #fde68a; font-size: 16px; font-weight: 700;">💰 KELLY & BANKROLL MANAGEMENT</h3>
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px;">
                <div style="background: rgba(0,0,0,0.2); padding: 14px; border-radius: 8px; border: 1px solid #fbbf24;">
                    <div style="font-size: 11px; color: #fef3c7; font-weight: 600; text-transform: uppercase;">Kelly Promedio</div>
                    <div style="font-size: 18px; font-weight: bold; color: #fff; margin-top: 4px;">${kelly.avg_kelly.toFixed(2)}%</div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 14px; border-radius: 8px; border: 1px solid #fbbf24;">
                    <div style="font-size: 11px; color: #fef3c7; font-weight: 600; text-transform: uppercase;">Stake Promedio</div>
                    <div style="font-size: 18px; font-weight: bold; color: #fff; margin-top: 4px;">€${kelly.avg_stake.toFixed(2)}</div>
                </div>
                <div style="background: ${sharpeBg}; padding: 14px; border-radius: 8px; border: 2px solid ${sharpeColor};">
                    <div style="font-size: 11px; color: #fef3c7; font-weight: 600; text-transform: uppercase;">Sharpe Ratio</div>
                    <div style="font-size: 18px; font-weight: bold; color: ${sharpeColor}; margin-top: 4px;">${kelly.sharpe_ratio.toFixed(2)}</div>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                <div style="background: ${ddBg}; padding: 14px; border-radius: 8px; border: 2px solid ${ddColor};">
                    <div style="font-size: 11px; color: #fef3c7; font-weight: 600; text-transform: uppercase;">Max Drawdown</div>
                    <div style="font-size: 18px; font-weight: bold; color: ${ddColor}; margin-top: 4px;">€${kelly.max_drawdown.toFixed(2)}</div>
                    <div style="font-size: 13px; color: #fde68a; margin-top: 2px;">(${kelly.max_drawdown_pct.toFixed(1)}%)</div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 14px; border-radius: 8px; border: 1px solid #fbbf24;">
                    <div style="font-size: 11px; color: #fef3c7; font-weight: 600; text-transform: uppercase;">Recovery Factor</div>
                    <div style="font-size: 18px; font-weight: bold; color: #fff; margin-top: 4px;">${kelly.recovery_factor.toFixed(2)}</div>
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
        <div style="margin-bottom: 18px;">
            <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #86efac; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">⬆️ Top Over Friendly</h4>
            <table style="width: 100%; font-size: 12px;">
                ${teams.over_friendly.slice(0, 5).map((team, i) => {
                    const bgColor = i === 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.05)';
                    return `
                    <tr style="border-bottom: 1px solid rgba(16, 185, 129, 0.2); background: ${bgColor};">
                        <td style="padding: 10px; color: #86efac; font-weight: 700; font-size: 14px;">${i+1}.</td>
                        <td style="padding: 10px; color: #fff; font-weight: 600;">${team.team}</td>
                        <td style="padding: 10px; text-align: center; color: #d1fae5;">${team.picks}p</td>
                        <td style="padding: 10px; text-align: right; color: #10b981; font-weight: 700; font-size: 14px;">${team.win_rate.toFixed(1)}%</td>
                    </tr>
                `;
                }).join('')}
            </table>
        </div>
    ` : '';
    
    const underHTML = teams.under_friendly && teams.under_friendly.length > 0 ? `
        <div>
            <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #93c5fd; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">⬇️ Top Under Friendly</h4>
            <table style="width: 100%; font-size: 12px;">
                ${teams.under_friendly.slice(0, 5).map((team, i) => {
                    const bgColor = i === 0 ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.05)';
                    return `
                    <tr style="border-bottom: 1px solid rgba(59, 130, 246, 0.2); background: ${bgColor};">
                        <td style="padding: 10px; color: #93c5fd; font-weight: 700; font-size: 14px;">${i+1}.</td>
                        <td style="padding: 10px; color: #fff; font-weight: 600;">${team.team}</td>
                        <td style="padding: 10px; text-align: center; color: #dbeafe;">${team.picks}p</td>
                        <td style="padding: 10px; text-align: right; color: #3b82f6; font-weight: 700; font-size: 14px;">${team.win_rate.toFixed(1)}%</td>
                    </tr>
                `;
                }).join('')}
            </table>
        </div>
    ` : '';
    
    container.innerHTML = `
        <h2 style="color: #22d3ee; font-size: 18px;">⚽ Análisis de Equipos</h2>
        <div style="padding: 18px; background: rgba(0,0,0,0.2); border-radius: 10px; border: 1px solid rgba(34, 211, 238, 0.3);">
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
        <h2 style="color: #c084fc; font-size: 18px;">🎯 Análisis Confidence Score</h2>
        <table>
            <thead>
                <tr>
                    <th style="color: #e9d5ff;">Rango</th>
                    <th style="text-align: center; color: #e9d5ff;">Picks</th>
                    <th style="text-align: center; color: #e9d5ff;">WR%</th>
                    <th style="text-align: center; color: #e9d5ff;">ROI%</th>
                </tr>
            </thead>
            <tbody>
                ${confidence.by_range.map(range => {
                    const roi = range.roi || 0;
                    const roiColor = roi > 5 ? '#10b981' : roi > 0 ? '#fbbf24' : '#f87171';
                    return `
                        <tr style="transition: background 0.2s;" onmouseover="this.style.background='rgba(192, 132, 252, 0.1)'" onmouseout="this.style.background='transparent'">
                            <td style="font-weight: 700; font-size: 14px; color: #fff;">${range.range}</td>
                            <td style="text-align: center; font-size: 14px; color: #f3e8ff;">${range.picks}</td>
                            <td style="text-align: center; font-size: 14px; color: #e9d5ff; font-weight: 500;">${range.win_rate.toFixed(1)}%</td>
                            <td style="text-align: center; color: ${roiColor}; font-weight: 700; font-size: 15px;">
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
    
    const byLeague = {};
    heatmap.forEach(cell => {
        if (!byLeague[cell.league]) byLeague[cell.league] = [];
        byLeague[cell.league].push(cell);
    });
    
    const topLeagues = Object.entries(byLeague)
        .map(([league, cells]) => ({
            league,
            totalPicks: cells.reduce((sum, c) => sum + c.picks, 0),
            cells
        }))
        .sort((a, b) => b.totalPicks - a.totalPicks)
        .slice(0, 5);
    
    container.innerHTML = `
        <h2 style="color: #fb923c; font-size: 18px;">🗺️ Heatmap: Liga × Mercado</h2>
        <div style="overflow-x: auto;">
            ${topLeagues.map(({ league, cells }) => `
                <div style="margin-bottom: 18px; padding: 16px; background: rgba(251, 146, 60, 0.1); border-radius: 10px; border: 1px solid rgba(251, 146, 60, 0.3);">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #fed7aa; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${league}</h4>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        ${cells.map(cell => {
                            const roi = cell.roi || 0;
                            let bgColor, borderColor;
                            if (roi > 10) {
                                bgColor = 'rgba(16, 185, 129, 0.25)';
                                borderColor = '#10b981';
                            } else if (roi > 0) {
                                bgColor = 'rgba(251, 191, 36, 0.25)';
                                borderColor = '#fbbf24';
                            } else {
                                bgColor = 'rgba(248, 113, 113, 0.25)';
                                borderColor = '#f87171';
                            }
                            const textColor = roi > 5 ? '#10b981' : roi > 0 ? '#fbbf24' : '#f87171';
                            
                            return `
                                <div style="background: ${bgColor}; padding: 12px; border-radius: 8px; min-width: 130px; border: 2px solid ${borderColor};">
                                    <div style="font-size: 11px; color: #fed7aa; font-weight: 600; margin-bottom: 4px;">${cell.market}</div>
                                    <div style="font-size: 18px; font-weight: bold; color: ${textColor};">
                                        ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
                                    </div>
                                    <div style="font-size: 10px; color: #fdba74; margin-top: 4px;">${cell.picks}p • WR ${cell.win_rate.toFixed(1)}%</div>
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
