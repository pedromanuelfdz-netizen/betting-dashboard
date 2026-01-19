// Dashboard JavaScript - VERSIÓN COMPLETA OPTIMIZADA
// Con estadísticas por liga, odds, mercado - carga rápida

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
    document.getElementById('config-min-edge').textContent = '8.0%';
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
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Wins</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">WR%</th>
                            <th style="text-align: right; padding: 8px; color: #94a3b8; font-weight: 600;">Barra</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${dataArray.map(item => {
                            const wr = item.win_rate || 0;
                            const barWidth = Math.max(0, Math.min(100, wr));
                            const barColor = wr > 52 ? '#10b981' : wr > 48 ? '#f59e0b' : '#ef4444';
                            
                            return `
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                    <td style="padding: 10px 8px; color: #fff; font-weight: 500;">${item.range}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #e2e8f0;">${item.picks}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #10b981;">${item.wins}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #fff; font-weight: 600;">${wr.toFixed(1)}%</td>
                                    <td style="padding: 10px 8px;">
                                        <div style="background: rgba(255,255,255,0.1); height: 6px; border-radius: 3px; overflow: hidden;">
                                            <div style="width: ${barWidth}%; height: 100%; background: ${barColor}; transition: width 0.3s;"></div>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #94a3b8;">
                💡 <strong style="color: #10b981;">Verde</strong> = WR > 52% | 
                <strong style="color: #f59e0b;">Amarillo</strong> = WR 48-52% | 
                <strong style="color: #ef4444;">Rojo</strong> = WR < 48%
            </div>
        </div>
    `;
}

function createLeagueSection(leagueData) {
    // Buscar contenedor después de odd range
    const oddContainer = document.getElementById('oddRangeChart').parentElement;
    const parent = oddContainer.parentElement;
    
    // Crear nuevo contenedor para ligas
    let container = document.getElementById('leagueSection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'leagueSection';
        container.className = 'chart-container';
        parent.appendChild(container);
    }
    
    // Convertir a array si es necesario
    const dataArray = Array.isArray(leagueData) ? leagueData : 
        Object.entries(leagueData).map(([league, data]) => ({
            league,
            ...data
        }));
    
    // Ordenar por picks descendente
    dataArray.sort((a, b) => b.picks - a.picks);
    
    // Tomar top 10
    const top10 = dataArray.slice(0, 10);
    
    container.innerHTML = `
        <div style="padding: 20px; background: rgba(168, 85, 247, 0.05); border-radius: 8px; border-left: 4px solid #a855f7;">
            <h3 style="margin: 0 0 15px 0; color: #a855f7; font-size: 14px;">🏆 TOP 10 LIGAS POR ACTIVIDAD</h3>
            
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <th style="text-align: left; padding: 8px; color: #94a3b8; font-weight: 600;">Liga</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Picks</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Wins</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">WR%</th>
                            <th style="text-align: right; padding: 8px; color: #94a3b8; font-weight: 600;">Performance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${top10.map((item, index) => {
                            const wr = item.win_rate || 0;
                            const barWidth = Math.max(0, Math.min(100, wr));
                            const barColor = wr > 52 ? '#10b981' : wr > 48 ? '#f59e0b' : '#ef4444';
                            const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                            
                            return `
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                    <td style="padding: 10px 8px; color: #fff;">
                                        <span style="margin-right: 8px;">${emoji}</span>
                                        <span style="font-weight: 500;">${item.league}</span>
                                    </td>
                                    <td style="padding: 10px 8px; text-align: center; color: #e2e8f0;">${item.picks}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #10b981;">${item.wins}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #fff; font-weight: 600;">${wr.toFixed(1)}%</td>
                                    <td style="padding: 10px 8px;">
                                        <div style="background: rgba(255,255,255,0.1); height: 6px; border-radius: 3px; overflow: hidden;">
                                            <div style="width: ${barWidth}%; height: 100%; background: ${barColor}; transition: width 0.3s;"></div>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #94a3b8;">
                📊 Total de ligas analizadas: ${dataArray.length}
            </div>
        </div>
    `;
}

function createMarketSection(marketData) {
    // Buscar contenedor
    const parent = document.getElementById('leagueSection')?.parentElement || 
                   document.getElementById('oddRangeChart').parentElement.parentElement;
    
    // Crear nuevo contenedor
    let container = document.getElementById('marketSection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'marketSection';
        container.className = 'chart-container';
        parent.appendChild(container);
    }
    
    if (!marketData || marketData.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    // Ordenar por picks descendente
    const sorted = [...marketData].sort((a, b) => b.picks - a.picks);
    
    container.innerHTML = `
        <div style="padding: 20px; background: rgba(236, 72, 153, 0.05); border-radius: 8px; border-left: 4px solid #ec4899;">
            <h3 style="margin: 0 0 15px 0; color: #ec4899; font-size: 14px;">🎯 PERFORMANCE POR MERCADO</h3>
            
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <th style="text-align: left; padding: 8px; color: #94a3b8; font-weight: 600;">Mercado</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Picks</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Wins</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">WR%</th>
                            <th style="text-align: right; padding: 8px; color: #94a3b8; font-weight: 600;">Performance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sorted.map(item => {
                            const wr = item.win_rate || 0;
                            const barWidth = Math.max(0, Math.min(100, wr));
                            const barColor = wr > 52 ? '#10b981' : wr > 48 ? '#f59e0b' : '#ef4444';
                            
                            return `
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                    <td style="padding: 10px 8px; color: #fff; font-weight: 500;">${item.market}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #e2e8f0;">${item.picks}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #10b981;">${item.wins}</td>
                                    <td style="padding: 10px 8px; text-align: center; color: #fff; font-weight: 600;">${wr.toFixed(1)}%</td>
                                    <td style="padding: 10px 8px;">
                                        <div style="background: rgba(255,255,255,0.1); height: 6px; border-radius: 3px; overflow: hidden;">
                                            <div style="width: ${barWidth}%; height: 100%; background: ${barColor}; transition: width 0.3s;"></div>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #94a3b8;">
                📊 Total de mercados analizados: ${sorted.length}
            </div>
        </div>
    `;
}

function createRecentBetsSection(recentBets) {
    // Buscar contenedor
    const parent = document.getElementById('leagueSection')?.parentElement || 
                   document.getElementById('oddRangeChart').parentElement.parentElement;
    
    // Crear nuevo contenedor
    let container = document.getElementById('recentBetsSection');
    if (!container) {
        container = document.createElement('div');
        container.id = 'recentBetsSection';
        container.className = 'chart-container';
        parent.appendChild(container);
    }
    
    if (!recentBets || recentBets.length === 0) {
        container.innerHTML = `
            <div style="padding: 20px; background: rgba(239, 68, 68, 0.05); border-radius: 8px; border-left: 4px solid #ef4444;">
                <h3 style="margin: 0; color: #ef4444; font-size: 14px;">⚠️ No hay apuestas recientes disponibles</h3>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <div style="padding: 20px; background: rgba(234, 179, 8, 0.05); border-radius: 8px; border-left: 4px solid #eab308;">
            <h3 style="margin: 0 0 15px 0; color: #eab308; font-size: 14px;">🎯 ÚLTIMAS 10 APUESTAS</h3>
            
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <th style="text-align: left; padding: 8px; color: #94a3b8; font-weight: 600;">Fecha</th>
                            <th style="text-align: left; padding: 8px; color: #94a3b8; font-weight: 600;">Partido</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Selección</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Odd</th>
                            <th style="text-align: center; padding: 8px; color: #94a3b8; font-weight: 600;">Resultado</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recentBets.slice(-10).reverse().map(bet => {
                            const resultColor = bet.result === 'Ganada' ? '#10b981' : 
                                              bet.result === 'Perdida' ? '#ef4444' : '#f59e0b';
                            const resultEmoji = bet.result === 'Ganada' ? '✅' : 
                                              bet.result === 'Perdida' ? '❌' : '⏳';
                            
                            return `
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                    <td style="padding: 8px; color: #94a3b8; font-size: 11px;">${bet.date}</td>
                                    <td style="padding: 8px; color: #fff; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${bet.match}</td>
                                    <td style="padding: 8px; text-align: center; color: #e2e8f0; font-size: 11px;">${bet.selection}</td>
                                    <td style="padding: 8px; text-align: center; color: #fff; font-weight: 600;">${bet.odd.toFixed(2)}</td>
                                    <td style="padding: 8px; text-align: center;">
                                        <span style="color: ${resultColor}; font-weight: 600;">
                                            ${resultEmoji} ${bet.result}
                                        </span>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// Load on page ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDashboardData);
} else {
    loadDashboardData();
}
