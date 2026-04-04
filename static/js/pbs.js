let pbData = null;
let currentPbSport = 'bike';
let includeVirtual = true;
window.pbChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    checkPbSyncStatus();
    fetchPBs();
    
    // Setup Tooltip interactions
    const tooltip = document.getElementById('pb-tooltip');
    if (tooltip) {
        tooltip.addEventListener('mouseleave', hidePbTooltip);
    }
});

async function fetchPBs() {
    try {
        const res = await fetch(`/api/personal_bests?include_virtual=${includeVirtual}`);
        pbData = await res.json();
        renderPBs();
    } catch (e) {
        console.error("PB Load Error:", e);
    }
}

function togglePbVirtual() {
    const toggle = document.getElementById('pb-virtual-toggle');
    includeVirtual = toggle.checked;
    fetchPBs();
}

function setPbSport(sport, btn) {
    currentPbSport = sport;
    const parent = btn.parentElement;
    parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    document.getElementById('pb-bike-view').style.display = sport === 'bike' ? 'grid' : 'none';
    document.getElementById('pb-run-view').style.display = sport === 'run' ? 'grid' : 'none';
    
    renderPBs();
}

function renderPBs() {
    if (!pbData) return;
    
    const lifetime = pbData.lifetime;
    const year = pbData.year;
    const month = pbData.month;
    
    if (currentPbSport === 'bike') {
        // Basic Stats
        const statsHtml = `
            ${createComparisonRow('Longest Ride', lifetime.bike.longest_ride, year.bike.longest_ride, month.bike.longest_ride, 'mi', lifetime.bike.longest_ride_id, year.bike.longest_ride_id, month.bike.longest_ride_id, lifetime.bike.longest_ride_name, year.bike.longest_ride_name, lifetime.bike.longest_ride_date, year.bike.longest_ride_date, month.bike.longest_ride_date, month.bike.longest_ride_name)}
            ${createComparisonRow('Max Speed', lifetime.bike.max_speed, year.bike.max_speed, month.bike.max_speed, 'mph', lifetime.bike.max_speed_id, year.bike.max_speed_id, month.bike.max_speed_id, lifetime.bike.max_speed_name, year.bike.max_speed_name, lifetime.bike.max_speed_date, year.bike.max_speed_date, month.bike.max_speed_date, month.bike.max_speed_name)}
            ${createComparisonRow('Highest Climb', lifetime.bike.highest_climb, year.bike.highest_climb, month.bike.highest_climb, 'ft', lifetime.bike.highest_climb_id, year.bike.highest_climb_id, month.bike.highest_climb_id, lifetime.bike.highest_climb_name, year.bike.highest_climb_name, lifetime.bike.highest_climb_date, year.bike.highest_climb_date, month.bike.highest_climb_date, month.bike.highest_climb_name)}
        `;
        document.getElementById('pb-bike-stats-container').innerHTML = statsHtml;
        
        // Power Comparison
        let powerHtml = '';
        const labels = {'5': '5 Sec', '30': '30 Sec', '60': '1 Min', '120': '2 Min', '300': '5 Min', '600': '10 Min', '1200': '20 Min', '1800': '30 Min', '3600': '60 Min'};
        const keys = ['5', '30', '60', '120', '300', '600', '1200', '1800', '3600'];
        
        powerHtml += `
            <div style="display: grid; grid-template-columns: 80px 1fr 1fr 1fr; gap: 0.5rem; padding: 0.5rem; margin-bottom: 0.25rem;">
                <div style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 800;">Interval</div>
                <div style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 800; text-align: center;">Lifetime</div>
                <div style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 800; text-align: center;">Year</div>
                <div style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 800; text-align: center;">Month</div>
            </div>
        `;

        for (let k of keys) {
            const l = lifetime.bike.power_curve[k];
            const y = year.bike.power_curve[k];
            const m = month.bike.power_curve[k];
            powerHtml += createComparisonRow(labels[k], l.val, y.val, m.val, 'W', l.id, y.id, m.id, l.name, y.name, l.date, y.date, m.date, m.name, true);
        }
        document.getElementById('pb-power-comparison-container').innerHTML = powerHtml;
        renderPbCharts('bike', pbData);
        
    } else {
        // Running Stats
        const statsHtml = createComparisonRow('Longest Run', lifetime.run.longest_run, year.run.longest_run, month.run.longest_run, 'mi', lifetime.run.longest_run_id, year.run.longest_run_id, month.run.longest_run_id, lifetime.run.longest_run_name, year.run.longest_run_name, lifetime.run.longest_run_date, year.run.longest_run_date, month.run.longest_run_date, month.run.longest_run_name);
        document.getElementById('pb-run-stats-container').innerHTML = statsHtml;
        
        let paceHtml = '';
        const map = {'fastest_1mi': '1 Mile', 'fastest_5k': '5K', 'fastest_5mi': '5 Mile'};
        
        paceHtml += `
            <div style="display: grid; grid-template-columns: 80px 1fr 1fr 1fr; gap: 0.5rem; padding: 0.5rem; margin-bottom: 0.25rem;">
                <div style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 800;">Distance</div>
                <div style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 800; text-align: center;">Lifetime</div>
                <div style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 800; text-align: center;">Year</div>
                <div style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 800; text-align: center;">Month</div>
            </div>
        `;
        
        for (let [k, label] of Object.entries(map)) {
            const l_val = lifetime.run[k];
            const y_val = year.run[k];
            const m_val = month.run[k];
            paceHtml += createComparisonRow(label, l_val, y_val, m_val, 'pace', lifetime.run[k+'_id'], year.run[k+'_id'], month.run[k+'_id'], lifetime.run[k+'_name'], year.run[k+'_name'], lifetime.run[k+'_date'], year.run[k+'_date'], month.run[k+'_date'], month.run[k+'_name'], true);
        }
        document.getElementById('pb-pace-comparison-container').innerHTML = paceHtml;
        renderPbCharts('run', pbData);
    }
}

function renderPbCharts(sport, data) {
    const canvasId = sport === 'bike' ? 'pb-power-chart' : 'pb-run-chart';
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    if (window.pbChartInstance) {
        window.pbChartInstance.destroy();
    }

    const lifetime = data.lifetime[sport];
    const year = data.year[sport];
    const month = data.month[sport];

    let labels, datasets;

    if (sport === 'bike') {
        const keys = ['5', '30', '60', '120', '300', '600', '1200', '1800', '3600'];
        labels = ['5s', '30s', '1m', '2m', '5m', '10m', '20m', '30m', '60m'];
        
        const getVals = (src) => keys.map(k => src.power_curve[k]?.val || 0);

        datasets = [
            { label: 'Lifetime', data: getVals(lifetime), borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', borderWidth: 3, tension: 0.3, fill: true },
            { label: 'This Year', data: getVals(year), borderColor: '#4ade80', backgroundColor: 'transparent', borderWidth: 2, tension: 0.3 },
            { label: 'This Month', data: getVals(month), borderColor: '#f472b6', backgroundColor: 'transparent', borderWidth: 2, tension: 0.3 }
        ];
    } else {
        const keys = ['fastest_1mi', 'fastest_5k', 'fastest_5mi'];
        labels = ['1 Mile', '5K', '5 Mile'];

        const getVals = (src) => keys.map(k => {
            const v = src[k];
            return v > 0 ? v / 60 : 0;
        });

        datasets = [
            { label: 'Lifetime', data: getVals(lifetime), borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', borderWidth: 3, tension: 0.3, fill: true },
            { label: 'This Year', data: getVals(year), borderColor: '#4ade80', backgroundColor: 'transparent', borderWidth: 2, tension: 0.3 },
            { label: 'This Month', data: getVals(month), borderColor: '#f472b6', backgroundColor: 'transparent', borderWidth: 2, tension: 0.3 }
        ];
    }

    window.pbChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10 } },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    callbacks: {
                        label: (ctx) => {
                            if (sport === 'bike') return `${ctx.dataset.label}: ${ctx.parsed.y}W`;
                            const totalSecs = ctx.parsed.y * 60;
                            const mins = Math.floor(totalSecs / 60);
                            const secs = Math.round(totalSecs % 60);
                            return `${ctx.dataset.label}: ${mins}:${secs.toString().padStart(2, '0')}/mi`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v) => sport === 'bike' ? v + 'W' : v + ':00' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                }
            }
        }
    });
}

// Reusable chart renderer for individual activity power/pace curves
window.renderActivityBestsChart = function(canvasId, bests, isBike) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return null;

    const powerKeys = ['5', '30', '60', '120', '300', '600', '1200', '1800', '3600'];
    const powerLabels = ['5s', '30s', '1m', '2m', '5m', '10m', '20m', '30m', '60m'];
    const paceKeys = ['1mi', '5k', '5mi'];
    const paceLabels = ['1 Mile', '5K', '5 Mile'];

    let labels, datasets;

    if (isBike && bests.power) {
        labels = powerLabels;
        const activityData = powerKeys.map(k => {
            const rec = bests.power[k];
            return (rec && typeof rec === 'object' ? rec.value : rec) || 0;
        });

        datasets = [
            {
                label: 'This Activity',
                data: activityData,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                borderWidth: 3,
                tension: 0.3,
                fill: true,
                pointBackgroundColor: '#f59e0b',
                pointRadius: 4,
                pointHoverRadius: 6
            }
        ];

        // Add lifetime PB ghost line if available
        if (pbData && pbData.lifetime && pbData.lifetime.bike) {
            const lifetimeData = powerKeys.map(k => pbData.lifetime.bike.power_curve[k]?.val || 0);
            datasets.push({
                label: 'Lifetime Best',
                data: lifetimeData,
                borderColor: 'rgba(56, 189, 248, 0.4)',
                backgroundColor: 'transparent',
                borderWidth: 2,
                borderDash: [6, 4],
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 3
            });
        }
    } else if (!isBike && bests.pace) {
        labels = paceLabels;
        const activityData = paceKeys.map(k => {
            const rec = bests.pace[k];
            const v = (rec && typeof rec === 'object' ? rec.value : rec);
            return v && v > 0 ? v / 60 : 0;
        });

        datasets = [
            {
                label: 'This Activity',
                data: activityData,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                borderWidth: 3,
                tension: 0.3,
                fill: true,
                pointBackgroundColor: '#f59e0b',
                pointRadius: 4,
                pointHoverRadius: 6
            }
        ];

        // Add lifetime PB ghost line if available
        if (pbData && pbData.lifetime && pbData.lifetime.run) {
            const lifetimeData = paceKeys.map(k => {
                const v = pbData.lifetime.run['fastest_' + k];
                return v && v > 0 ? v / 60 : 0;
            });
            datasets.push({
                label: 'Lifetime Best',
                data: lifetimeData,
                borderColor: 'rgba(56, 189, 248, 0.4)',
                backgroundColor: 'transparent',
                borderWidth: 2,
                borderDash: [6, 4],
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 3
            });
        }
    } else {
        return null;
    }

    // Filter out datasets where all values are 0
    datasets = datasets.filter(ds => ds.data.some(v => v > 0));
    if (datasets.length === 0) return null;

    return new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10, padding: 12 } },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleFont: { size: 11 },
                    bodyFont: { size: 11 },
                    padding: 10,
                    callbacks: {
                        label: (tipCtx) => {
                            if (isBike) return `${tipCtx.dataset.label}: ${tipCtx.parsed.y}W`;
                            const totalSecs = tipCtx.parsed.y * 60;
                            const mins = Math.floor(totalSecs / 60);
                            const secs = Math.round(totalSecs % 60);
                            return `${tipCtx.dataset.label}: ${mins}:${secs.toString().padStart(2, '0')}/mi`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v) => isBike ? v + 'W' : Math.floor(v) + ':' + String(Math.round((v % 1) * 60)).padStart(2, '0') }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                }
            }
        }
    });
};

function createComparisonRow(label, l, y, m, unit, lId, yId, mId, lName, yName, lDate, yDate, mDate, mName, isSmall = false) {
    const format = (val) => {
        if (!val || val === 0) return '--';
        if (unit === 'W') return val;
        if (unit === 'ft') return val.toFixed(0);
        if (unit === 'mi') return val.toFixed(1);
        if (unit === 'mph') return val.toFixed(1);
        if (unit === 'pace') {
            const mins = Math.floor(val / 60);
            const secs = Math.floor(val % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }
        return val;
    };

    const unitLabel = (unit === 'pace') ? '/mi' : unit;
    
    // Create the HTML for one cell
    const cell = (val, id, name, date) => {
        const formatted = format(val);
        const hasValue = val && val > 0;
        
        return `
            <div class="pb-compare-cell pb-compare-cell-compact" 
                 ${hasValue ? `
                    onmouseenter="showPbTooltip(event, '${label}', '${formatted}${unitLabel}', '${(name || 'Activity').replace(/'/g, "\\'")}', '${date}', '${id}')"
                    onclick="window.openActivityDetail('${id}', {activityId: '${id}', activityName: '${(name || 'Activity').replace(/'/g, "\\'")}', startTimeLocal: '${date}'})"
                 ` : ''}
                 style="cursor: ${hasValue ? 'pointer' : 'default'};"
            >
                <div style="font-size: ${isSmall ? '0.75rem' : '1rem'}; font-weight: 800; color: ${hasValue ? 'white' : 'rgba(255,255,255,0.1)'};">${formatted}</div>
            </div>
        `;
    };

    return `
        <div style="display: grid; grid-template-columns: 80px 1fr 1fr 1fr; gap: 0.4rem; align-items: center;">
            <div class="pb-row-label">${label}</div>
            ${cell(l, lId, lName, lDate)}
            ${cell(y, yId, yName, yDate)}
            ${cell(m, mId, mName, mDate)}
        </div>
    `;
}

function showPbTooltip(e, label, val, name, date, id) {
    const tooltip = document.getElementById('pb-tooltip');
    if (!tooltip) return;
    
    document.getElementById('pb-tooltip-label').innerText = label;
    document.getElementById('pb-tooltip-val').innerText = val;
    document.getElementById('pb-tooltip-name').innerText = name;
    document.getElementById('pb-tooltip-date').innerText = new Date(date).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
    
    const btn = document.getElementById('pb-tooltip-btn');
    btn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof window.openActivityDetail === 'function') {
            window.openActivityDetail(id, {
                activityId: id,
                activityName: name,
                startTimeLocal: date
            });
            hidePbTooltip();
        }
    };
    
    const ignoreBtn = document.getElementById('pb-tooltip-ignore');
    if (ignoreBtn) {
        ignoreBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (confirm("Are you sure you want to permanently ignore this activity from your Personal Bests?")) {
                excludeActivity(id);
            }
        };
    }
    
    tooltip.style.display = 'block';
    
    // Position tooltip CLOSER to cursor to ensure the "bridge" overlap works
    const x = e.clientX + 5;
    const y = e.clientY + 5;
    
    // Boundary check
    const rect = tooltip.getBoundingClientRect();
    let finalX = x;
    let finalY = y;
    
    if (x + rect.width > window.innerWidth) finalX = x - rect.width - 25;
    if (y + rect.height > window.innerHeight) finalY = y - rect.height - 25;
    
    tooltip.style.left = finalX + 'px';
    tooltip.style.top = finalY + 'px';
}

function hidePbTooltip() {
    const tooltip = document.getElementById('pb-tooltip');
    if (tooltip) tooltip.style.display = 'none';
}

async function excludeActivity(id) {
    try {
        const res = await fetch('/api/exclude_activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activityId: id })
        });
        const result = await res.json();
        if (result.status === 'success') {
            hidePbTooltip();
            fetchPBs(); // Refresh data immediately
        }
    } catch (e) {
        console.error("Exclusion error:", e);
    }
}

// Global hide listener
document.addEventListener('mousemove', (e) => {
    const tooltip = document.getElementById('pb-tooltip');
    if (!tooltip || tooltip.style.display === 'none') return;
    
    // If not hovering over a pb-compare-cell or the tooltip itself, hide it
    // Using a more robust check for the tooltip area
    const isOverCell = e.target.closest('.pb-compare-cell');
    const isOverTooltip = e.target.closest('#pb-tooltip');
    
    if (!isOverCell && !isOverTooltip) {
        hidePbTooltip();
    }
});

async function checkPbSyncStatus() {
    try {
        const res = await fetch('/api/pb_sync_status');
        const data = await res.json();
        const btn = document.getElementById('pb-sync-btn');
        if (data.active) {
            btn.innerHTML = 'Syncing...';
            btn.style.opacity = '0.5';
            btn.disabled = true;
            setTimeout(checkPbSyncStatus, 5000);
        } else {
            btn.innerHTML = 'Sync Past Bests (2025+)';
            btn.style.opacity = '1';
            btn.disabled = false;
        }
    } catch(e) {}
}

async function triggerPBSync() {
    try {
        const btn = document.getElementById('pb-sync-btn');
        btn.innerHTML = 'Starting...';
        btn.disabled = true;
        await fetch('/api/trigger_pb_sync', { method: 'POST' });
        checkPbSyncStatus();
    } catch(e) {
        console.error(e);
    }
}
