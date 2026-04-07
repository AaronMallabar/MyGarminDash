/**
 * Chart Rendering Functions
 * All Chart.js visualization logic
 */

// Global chart instances
window.chartInstances = window.chartInstances || {};
const chartInstances = window.chartInstances;

// Client-side cache for chart data
const chartDataCache = {
    steps: {},
    hr: {},
    stress: {},
    sleep: {},
    weight: {},
    hydration: {},
    hrv: {},
    calorie: {}
};

function getCacheKey(range, endDate) {
    return `${range}_${getLocalDateStr(endDate)}`;
}

function getCachedData(metric, range, endDate) {
    const key = getCacheKey(range, endDate);
    return chartDataCache[metric][key];
}

function setCachedData(metric, range, endDate, data) {
    const key = getCacheKey(range, endDate);
    chartDataCache[metric][key] = data;
}

// Disable animations for performance on large datasets (1yr history)
Chart.defaults.animation = false;
Chart.defaults.font.family = "'Inter', sans-serif";

window.renderYTDChart = function (canvasId, labels, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: '2024', data: data.years['2024'], borderColor: '#818cf8', backgroundColor: 'rgba(129, 140, 248, 0.1)', borderWidth: 2, tension: 0.1, pointRadius: 0 },
                { label: '2025', data: data.years['2025'], borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', borderWidth: 2, tension: 0.1, pointRadius: 0 },
                { label: '2026 (Current)', data: data.years['2026'], borderColor: '#4ade80', backgroundColor: 'rgba(74, 222, 128, 0.1)', borderWidth: 3, tension: 0.1, pointRadius: 0 },
                { label: `Goal (${data.yearly_goal} mi)`, data: data.goal_line, borderColor: '#f87171', backgroundColor: 'rgba(248, 113, 113, 0.1)', borderWidth: 2, borderDash: [5, 5], tension: 0, pointRadius: 0 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } },
                legend: { position: 'top', labels: { color: '#f1f5f9', boxWidth: 12, boxHeight: 2, padding: 10, font: { size: 11 } } },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} mi / ${(ctx.parsed.y * 1.60934).toFixed(1)} km` } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 12 }, callback: val => val + ' mi' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } },
                x: { ticks: { color: '#94a3b8', font: { size: 12 }, maxTicksLimit: 15 }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }
            }
        }
    });
}

window.updateWeightRange = async function (range, btn) {
    if (range) window.currentWeightRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    try {
        const cached = getCachedData('weight', window.currentWeightRange, window.currentWeightEndDate);
        if (cached) {
            renderWeightChart(cached, window.currentWeightRange);
            return;
        }

        if (window.currentWeightRange === '1y' && isDateToday(window.currentWeightEndDate) && window.preloadedData['weight']) {
            setCachedData('weight', window.currentWeightRange, window.currentWeightEndDate, window.preloadedData['weight']);
            renderWeightChart(window.preloadedData['weight'], window.currentWeightRange);
            return;
        }

        const res = await fetch(`/api/weight_history?range=${window.currentWeightRange}&end_date=${getLocalDateStr(window.currentWeightEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                setCachedData('weight', window.currentWeightRange, window.currentWeightEndDate, data);
                renderWeightChart(data, window.currentWeightRange);
            }
        }
    } catch (err) { console.error('Weight history error:', err); }
}

window.renderWeightChart = function (data, range) {
    const canvasId = 'weightHistoryChart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const weightData = (data.history || data) || [];
    const summary = data.summary || {};

    if (summary.latest_lbs) {
        safeSetText('weight', summary.latest_lbs.toFixed(1));
    }

    if (summary.avg_val) {
        const trendBox = document.getElementById('weight-trend-box');
        if (trendBox) trendBox.style.display = 'block';

        const labelEl = document.getElementById('weight-trend-label');
        if (labelEl) {
            const count = summary.avg_count || 0;
            labelEl.textContent = count >= 7 ? '7d Avg' : `Avg (Last ${count})`;
        }
        safeSetText('weight-7d-avg', summary.avg_val.toFixed(1) + ' lbs');
    }

    if (summary.range_change !== undefined) {
        const changeBox = document.getElementById('weight-change-box');
        if (changeBox) changeBox.style.display = 'block';
        const sign = summary.range_change > 0 ? '+' : '';
        const color = summary.range_change > 0 ? '#f87171' : '#4ade80';
        const changeEl = document.getElementById('weight-range-change');
        if (changeEl) {
            changeEl.textContent = `${sign}${summary.range_change.toFixed(1)} lbs`;
            changeEl.style.color = color;
        }
    }

    if (weightData.length === 0) return;

    const weights = weightData.map(d => d.weight_lbs);
    const min = Math.floor(Math.min(...weights) - 3);
    const max = Math.ceil(Math.max(...weights) + 3);

    const isLongRange = weightData.length > 90;
    const pointRadius = isLongRange ? 0 : 4;
    const borderWidth = isLongRange ? 2 : 3;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: weightData.map(d => d.date),
            datasets: [{
                label: 'Weight (lbs)',
                data: weightData.map(d => d.weight_lbs),
                borderColor: '#818cf8',
                backgroundColor: 'rgba(129, 140, 248, 0.1)',
                borderWidth: borderWidth,
                pointRadius: pointRadius,
                pointBackgroundColor: '#818cf8',
                pointBorderColor: '#fff',
                pointBorderWidth: 1,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#94a3b8',
                    bodyColor: '#fff',
                    padding: 10,
                    callbacks: {
                        title: (items) => {
                            const d = parseLocalDate(items[0].label);
                            return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                        },
                        label: (ctx) => `Weight: ${ctx.parsed.y.toFixed(1)} lbs`
                    }
                },
                zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
            },
            scales: {
                x: {
                    type: 'category',
                    grid: { display: false },
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: isLongRange ? 8 : 7,
                        callback: function (val, index) {
                            const label = this.getLabelForValue(val);
                            const p = label.split('-');
                            if (!p[1]) return label;
                            return p[1] + '/' + p[2];
                        }
                    }
                },
                y: {
                    min,
                    max,
                    ticks: {
                        color: '#94a3b8',
                        stepSize: 2,
                        callback: v => v + ' lbs'
                    },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                }
            }
        }
    });
}

// --- Calorie History Chart ---
const CALORIE_METRIC_CONFIG = {
    active_calories: { label: 'Active', color: '#f59e0b', axis: 'y', unit: 'kcal' },
    resting_calories: { label: 'Passive', color: '#6366f1', axis: 'y', unit: 'kcal' },
    total_calories: { label: 'Total Burned', color: '#38bdf8', axis: 'y', unit: 'kcal' },
    consumed: { label: 'Consumed', color: '#10b981', axis: 'y', unit: 'kcal' },
    net_energy: { label: 'Net Energy', color: '#a78bfa', axis: 'y', unit: 'kcal' },
    weight_lbs: { label: 'Weight', color: '#818cf8', axis: 'y1', unit: 'lbs' },
    cholesterol_mg: { label: 'Cholesterol', color: '#fb923c', axis: 'y1', unit: 'mg' },
    protein_g: { label: 'Protein', color: '#f472b6', axis: 'y1', unit: 'g' },
    carbs_g: { label: 'Carbs', color: '#eab308', axis: 'y1', unit: 'g' },
    fat_g: { label: 'Fat', color: '#f97316', axis: 'y1', unit: 'g' },
    sugar_g: { label: 'Sugar', color: '#60a5fa', axis: 'y1', unit: 'g' },
    caffeine_mg: { label: 'Caffeine', color: '#a78bfa', axis: 'y1', unit: 'mg' }
};

window.updateCalorieRange = async function (range, btn) {
    if (range) window.currentCalorieRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    try {
        const cached = getCachedData('calorie', window.currentCalorieRange, window.currentCalorieEndDate);
        if (cached) {
            renderCalorieChart(cached);
            updateCalorieRangeLabel();
            return;
        }
        const res = await fetch(`/api/calorie_history?range=${window.currentCalorieRange}&end_date=${getLocalDateStr(window.currentCalorieEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                setCachedData('calorie', window.currentCalorieRange, window.currentCalorieEndDate, data);
                renderCalorieChart(data);
                updateCalorieRangeLabel();
            }
        }
    } catch (err) { console.error('Calorie history error:', err); }
};

window.onCalorieFilterChange = function () {
    const cached = getCachedData('calorie', window.currentCalorieRange, window.currentCalorieEndDate);
    if (cached) renderCalorieChart(cached);
};

window.updateCalorieRangeLabel = function () {
    const el = document.getElementById('calorie-range-label');
    if (!el) return;
    const end = window.currentCalorieEndDate;
    const range = window.currentCalorieRange;
    const start = new Date(end);
    if (range === '1d') start.setDate(start.getDate());
    else if (range === '1w') start.setDate(start.getDate() - 6);
    else if (range === '1m') start.setDate(start.getDate() - 29);
    else if (range === '1y') start.setDate(start.getDate() - 364);
    el.textContent = start.toLocaleDateString(undefined, { month: 'short' }) + ' ' + start.getDate() + ' – ' + end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function getCalorieFilters() {
    const checked = [];
    document.querySelectorAll('.calorie-filter input[data-metric]:checked').forEach(cb => checked.push(cb.getAttribute('data-metric')));
    return checked;
}

function renderCalorie1DayView(day) {
    const consumed = day.consumed || 0;
    const burned = day.total_calories || 1;
    const net = consumed - burned;
    const chol = day.cholesterol_mg ?? '--';
    const weight = day.weight_lbs != null ? day.weight_lbs : '--';

    const netEl = document.getElementById('calorie-net-value');
    const netLabel = document.getElementById('calorie-net-label');
    if (netEl) {
        netEl.textContent = (net >= 0 ? '+' : '') + net.toLocaleString();
        netEl.style.color = net <= 0 ? '#10b981' : '#f87171';
    }
    if (netLabel) netLabel.textContent = net <= 0 ? 'Deficit' : 'Surplus';

    const donutEl = document.getElementById('calorie-energy-donut');
    if (donutEl) {
        const total = Math.max(consumed + burned, 1);
        const pctConsumed = Math.round((consumed / total) * 100);
        donutEl.style.background = `conic-gradient(#10b981 0% ${pctConsumed}%, #38bdf8 ${pctConsumed}% 100%)`;
    }

    const pro = day.protein_g || 0;
    const carb = day.carbs_g || 0;
    const fat = day.fat_g || 0;
    const calFromPro = pro * 4;
    const calFromCarb = carb * 4;
    const calFromFat = fat * 9;
    const totalMacroCal = calFromPro + calFromCarb + calFromFat;

    const macrosCenter = document.getElementById('calorie-macros-total');
    if (macrosCenter) macrosCenter.textContent = consumed > 0 ? consumed.toLocaleString() : '--';

    const macrosCanvas = document.getElementById('calorie-macros-donut');
    if (macrosCanvas && chartInstances['calorieMacrosDonut']) {
        chartInstances['calorieMacrosDonut'].destroy();
        chartInstances['calorieMacrosDonut'] = null;
    }
    if (macrosCanvas && totalMacroCal > 0) {
        const pPct = (calFromPro / totalMacroCal) * 100;
        const cPct = (calFromCarb / totalMacroCal) * 100;
        const fPct = (calFromFat / totalMacroCal) * 100;
        chartInstances['calorieMacrosDonut'] = new Chart(macrosCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Protein', 'Carbs', 'Fat'],
                datasets: [{
                    data: [pPct, cPct, fPct],
                    backgroundColor: ['#f472b6', '#eab308', '#f97316'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                cutout: '65%',
                plugins: { legend: { display: false } }
            }
        });
    } else if (macrosCanvas) {
        const ctx = macrosCanvas.getContext('2d');
        chartInstances['calorieMacrosDonut'] = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: [], datasets: [{ data: [1], backgroundColor: ['rgba(255,255,255,0.05)'], borderWidth: 0 }] },
            options: { responsive: true, cutout: '65%', plugins: { legend: { display: false } } }
        });
    }

    safeSetText('calorie-day-chol', (chol !== '--' && chol != null && chol !== '' ? chol : '--') + ' mg');
    safeSetText('calorie-day-weight', (weight !== '--' && weight != null && weight !== '' ? weight : '--') + ' lbs');
    safeSetText('calorie-day-sugar', (day.sugar_g != null ? day.sugar_g : '--') + ' g');
    safeSetText('calorie-day-caffeine', (day.caffeine_mg != null ? day.caffeine_mg : '--') + ' mg');
}

window.renderCalorieChart = function (data) {
    const canvasId = 'calorieHistoryChart';
    const canvas = document.getElementById(canvasId);
    const oneDayContainer = document.getElementById('calorie-1d-container');
    const range = data.range || window.currentCalorieRange;
    const history = data.history || [];

    if (range === '1d' && history.length > 0) {
        if (chartInstances[canvasId]) { chartInstances[canvasId].destroy(); chartInstances[canvasId] = null; }
        if (chartInstances['calorieMacrosDonut']) { chartInstances['calorieMacrosDonut'].destroy(); chartInstances['calorieMacrosDonut'] = null; }
        renderCalorie1DayView(history[0]);
        if (canvas) canvas.style.display = 'none';
        if (oneDayContainer) oneDayContainer.style.display = 'block';
        const filterBar = document.getElementById('calorie-filters-bar');
        if (filterBar) filterBar.style.display = 'none';
        return;
    }

    if (canvas) canvas.style.display = 'block';
    if (oneDayContainer) oneDayContainer.style.display = 'none';
    const filterBar = document.getElementById('calorie-filters-bar');
    if (filterBar) filterBar.style.display = 'flex';
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const filters = getCalorieFilters();
    if (history.length === 0 || filters.length === 0) {
        chartInstances[canvasId] = new Chart(ctx, { type: 'line', data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false } });
        return;
    }

    const labels = history.map(h => h.date);
    const datasets = [];
    const y1Metrics = filters.filter(f => (CALORIE_METRIC_CONFIG[f] || {}).axis === 'y1');
    const y1RawVals = [];

    filters.forEach(key => {
        const cfg = CALORIE_METRIC_CONFIG[key];
        if (!cfg) return;
        const vals = history.map(h => {
            let v = h[key];
            if (v == null || v === '') return null;
            const num = Number(v);
            if (cfg.axis === 'y1') y1RawVals.push(num);
            return num;
        });
        datasets.push({
            label: cfg.label + (cfg.unit ? ` (${cfg.unit})` : ''),
            data: vals,
            borderColor: cfg.color,
            backgroundColor: key === 'net_energy' ? cfg.color + '10' : cfg.color + '20',
            borderWidth: key === 'net_energy' ? 4 : 2,
            tension: 0.3,
            pointRadius: history.length <= 31 ? 3 : 0,
            yAxisID: cfg.axis,
            fill: key === 'net_energy' ? 'origin' : false
        });
    });

    const y1Max = y1RawVals.length ? Math.max(...y1RawVals) * 1.1 : 100;
    const y1Min = y1RawVals.length ? Math.min(...y1RawVals) : 0;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 10 } } },
                tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', callbacks: { title: (items) => parseLocalDate(items[0].label).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) } }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', maxTicksLimit: 10, callback: (_, i) => { const p = labels[i].split('-'); return p[1] + '/' + p[2]; } } },
                y: { position: 'left', title: { display: true, text: 'kcal', color: '#94a3b8' }, grid: { color: (ctx) => (ctx.tick && ctx.tick.value === 0) ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.05)', lineWidth: (ctx) => (ctx.tick && ctx.tick.value === 0) ? 2 : 1 }, ticks: { color: '#94a3b8' } },
                y1: { position: 'right', display: y1Metrics.length > 0, min: Math.max(0, y1Min - (y1Max - y1Min) * 0.1), max: y1Max, title: { display: y1Metrics.length > 0, text: 'Secondary Unit', color: '#818cf8' }, grid: { drawOnChartArea: false }, ticks: { color: '#818cf8' } }
            }
        }
    });
};

window.updateStepsRange = async function (range, btn) {
    if (range) window.currentStepsRange = range;
    if (btn) { btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    try {
        const cached = getCachedData('steps', window.currentStepsRange, window.currentStepsEndDate);
        if (cached) { renderStepsVisual(cached); return; }
        if (window.currentStepsRange === '1y' && isDateToday(window.currentStepsEndDate) && window.preloadedData['steps']) {
            setCachedData('steps', window.currentStepsRange, window.currentStepsEndDate, window.preloadedData['steps']);
            renderStepsVisual(window.preloadedData['steps']);
            return;
        }
        const res = await fetch(`/api/steps_history?range=${window.currentStepsRange}&end_date=${getLocalDateStr(window.currentStepsEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) { setCachedData('steps', window.currentStepsRange, window.currentStepsEndDate, data); renderStepsVisual(data); }
        }
    } catch (err) { console.error('Steps history error:', err); }
}

window.renderStepsVisual = function (data) {
    const canvasId = 'stepsHistoryChart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const donutContainer = document.getElementById('steps-donut-container');
    const streakEl = document.getElementById('steps-streak');
    if (streakEl) streakEl.textContent = data.streak || 0;

    if (window.currentStepsRange === '1d') {
        if (canvas) canvas.style.display = 'none';
        if (donutContainer) donutContainer.style.display = 'flex';
        const day = data.history[data.history.length - 1] || { totalSteps: 0, stepGoal: 10000 };
        const percent = Math.min(100, Math.round((day.totalSteps / day.stepGoal) * 100));
        safeSetText('steps', day.totalSteps.toLocaleString());
        safeSetText('steps-goal-text', '/ ' + (day.stepGoal >= 1000 ? (day.stepGoal / 1000) + 'k' : day.stepGoal));
        safeSetText('steps-day-percent', percent + '%');
        const chart = document.getElementById('steps-day-chart');
        if (chart) chart.style.background = `conic-gradient(${percent >= 100 ? 'var(--success-color)' : 'var(--accent-color)'} 0% ${percent}%, rgba(255,255,255,0.1) ${percent}% 100%)`;
    } else {
        if (canvas) canvas.style.display = 'block';
        if (donutContainer) donutContainer.style.display = 'none';
        const validDays = data.history.filter(d => d.totalSteps > 0);
        const avg = validDays.length > 0 ? Math.round(validDays.reduce((sum, d) => sum + d.totalSteps, 0) / validDays.length) : 0;
        safeSetText('steps', avg.toLocaleString());
        safeSetText('steps-goal-text', 'Avg/Day');
        if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.history.map(d => { const p = d.calendarDate.split('-'); return `${p[1]}/${p[2]}`; }),
                datasets: [{ label: 'Steps', data: data.history.map(d => d.totalSteps), backgroundColor: data.history.map(d => d.totalSteps >= d.stepGoal ? '#4ade80' : '#38bdf8'), borderRadius: data.history.length > 100 ? 0 : 4, barPercentage: data.history.length > 100 ? 0.7 : 0.5 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, mode: 'x' } } }, scales: { x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 7 } }, y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } } } }
        });
    }
}

window.updateHRRange = async function (range, btn) {
    if (range) window.currentHRRange = range;
    if (btn) { btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    try {
        const cached = getCachedData('hr', window.currentHRRange, window.currentHREndDate);
        if (cached) { renderHRVisual(cached); return; }
        const res = await fetch(`/api/hr_history?range=${window.currentHRRange}&end_date=${getLocalDateStr(window.currentHREndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) { setCachedData('hr', window.currentHRRange, window.currentHREndDate, data); renderHRVisual(data); }
        }
    } catch (err) { console.error('HR history error:', err); }
}

window.renderHRVisual = function (data) {
    const canvasId = 'hrHistoryChart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    if (window.currentHRRange === '1d') {
        const dailyMax = parseInt(data.summary.max) || 0;
        const zones = data.zones || [95, 114, 133, 152, 171];
        safeSetText('hr-max-val', dailyMax || '--');
        const points = data.samples.map(s => ({ x: s[0], y: s[1] }));
        const getZoneColor = (hr) => {
            if (hr >= zones[4]) return '#a855f7'; if (hr >= zones[3]) return '#ef4444'; if (hr >= zones[2]) return '#f97316';
            if (hr >= zones[1]) return '#22c55e'; if (hr >= zones[0]) return '#3b82f6'; return '#94a3b8';
        };
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { datasets: [{ label: 'HR', data: points, borderWidth: 2, pointRadius: 0, segment: { borderColor: ctx => getZoneColor(ctx.p1.parsed.y) }, tension: 0.4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { type: 'time', time: { displayFormats: { hour: 'HH:mm' } }, grid: { display: false }, ticks: { color: '#94a3b8' } }, y: { min: 40, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } } } }
        });
    } else {
        const labels = data.history.map(d => { const p = d.date.split('-'); return p[1] + '/' + p[2]; });
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Resting', data: data.history.map(d => d.rhr), borderColor: '#38bdf8', borderWidth: 3, tension: 0.4, fill: false }, { label: 'Max', data: data.history.map(d => d.max), borderColor: '#ef4444', borderWidth: 2, tension: 0.4, fill: false }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: '#94a3b8' } } }, scales: { x: { grid: { display: false }, ticks: { color: '#94a3b8' } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } } } }
        });
    }
}

window.updateStressRange = async function (range, btn) {
    if (range) window.currentStressRange = range;
    if (btn) { btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    try {
        const cached = getCachedData('stress', window.currentStressRange, window.currentStressEndDate);
        if (cached) { renderStressVisual(cached); return; }
        const res = await fetch(`/api/stress_history?range=${window.currentStressRange}&end_date=${getLocalDateStr(window.currentStressEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) { setCachedData('stress', window.currentStressRange, window.currentStressEndDate, data); renderStressVisual(data); }
        }
    } catch (err) { console.error('Stress history error:', err); }
}

window.renderStressVisual = function (data) {
    const canvasId = 'stressHistoryChart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    if (window.currentStressRange === '1d') {
        safeSetText('stress', data.summary.avg || '--');
        const points = data.samples.map(s => ({ x: s[0], y: s[1] }));
        const getStressColor = (v) => { if (v < 25) return '#94a3b8'; if (v < 50) return '#f97316'; return '#ef4444'; };
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { datasets: [{ label: 'Stress', data: points, borderWidth: 2, pointRadius: 0, segment: { borderColor: ctx => getStressColor(ctx.p1.parsed.y) }, tension: 0.4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { type: 'time', grid: { display: false } }, y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' } } } }
        });
    } else {
        const labels = data.history.map(d => { const p = d.date.split('-'); return p[1] + '/' + p[2]; });
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Avg', data: data.history.map(d => d.avg), borderColor: '#f97316', borderWidth: 3, tension: 0.4, fill: false }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { min: 0, max: 100 } } }
        });
    }
}

window.updateSleepRange = async function (range, btn) {
    if (range) window.currentSleepRange = range;
    if (btn) { btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    try {
        const cached = getCachedData('sleep', window.currentSleepRange, window.currentSleepEndDate);
        if (cached) { renderSleepVisual(cached); return; }
        const res = await fetch(`/api/sleep_history?range=${window.currentSleepRange}&end_date=${getLocalDateStr(window.currentSleepEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) { setCachedData('sleep', window.currentSleepRange, window.currentSleepEndDate, data); renderSleepVisual(data); }
        }
    } catch (err) { console.error('Sleep history error:', err); }
}

window.renderSleepVisual = function (data) {
    const canvasId = 'sleepHistoryChart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    if (window.currentSleepRange === '1d') {
        const s = data.summary;
        safeSetText('sleep', (s.total / 3600).toFixed(1));
        safeSetText('sleep-score-val', s.score || '--');
        const stageData = [{ label: 'Deep', value: s.deep || 0, color: '#6366f1' }, { label: 'Light', value: s.light || 0, color: '#3b82f6' }, { label: 'REM', value: s.rem || 0, color: '#2dd4bf' }, { label: 'Awake', value: s.awake || 0, color: '#f97316' }].filter(d => d.value > 0);
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: stageData.map(d => d.label), datasets: [{ data: stageData.map(d => d.value), backgroundColor: stageData.map(d => d.color), borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { color: '#94a3b8' } } } }
        });
    } else {
        const labels = data.history.map(d => { const p = d.date.split('-'); return p[1] + '/' + p[2]; });
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Score', data: data.history.map(d => d.score), borderColor: '#818cf8', borderWidth: 3, tension: 0.4, fill: true, backgroundColor: 'rgba(129, 140, 248, 0.1)' }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } }
        });
    }
}

window.updateHydrationRange = async function (range, btn) {
    if (range) window.currentHydrationRange = range;
    if (btn) { btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    await renderHydrationVisual();
}

window.renderHydrationVisual = async function (data) {
    const oz = (ml) => (ml * 0.033814).toFixed(1);
    if (!data) {
        const cached = getCachedData('hydration', window.currentHydrationRange, window.currentHydrationEndDate);
        if (cached) { renderHydrationContent(cached, oz); return; }
        const res = await fetch(`/api/hydration_history?range=${window.currentHydrationRange}&end_date=${getLocalDateStr(window.currentHydrationEndDate)}`);
        if (res.ok) { data = await res.json(); setCachedData('hydration', window.currentHydrationRange, window.currentHydrationEndDate, data); }
    }
    if (data) renderHydrationContent(data, oz);
}

function renderHydrationContent(data, oz) {
    const hChart = document.getElementById('hydration-chart');
    const hDonutContainer = document.getElementById('hydration-donut-container');
    const hHistoryChart = document.getElementById('hydrationHistoryChart');

    if (window.currentHydrationRange === '1d') {
        if (hDonutContainer) hDonutContainer.style.display = 'flex';
        if (hHistoryChart) hHistoryChart.style.display = 'none';

        const summary = data.summary || data;
        const intake = summary.intake || 0;
        const goal = summary.goal || 2000;
        const p = goal > 0 ? Math.min(100, Math.round((intake / goal) * 100)) : 0;
        
        safeSetText('hydration-val', oz(intake) + ' oz');
        safeSetText('hydration-percent', p + '%');
        safeSetText('hydration-goal', `Goal: ${oz(goal)} oz`);
        
        if (hChart) {
            hChart.style.background = `conic-gradient(${p >= 100 ? '#22c55e' : '#38bdf8'} ${p}%, rgba(255,255,255,0.05) ${p}% 100%)`;
        }
    } else {
        if (hDonutContainer) hDonutContainer.style.display = 'none';
        if (hHistoryChart) hHistoryChart.style.display = 'block';

        const ctx = hHistoryChart.getContext('2d');
        if (chartInstances['hydrationHistoryChart']) chartInstances['hydrationHistoryChart'].destroy();
        chartInstances['hydrationHistoryChart'] = new Chart(ctx, {
            type: 'bar',
            data: { labels: data.history.map(d => d.date.split('-').slice(1).join('/')), datasets: [{ data: data.history.map(d => parseFloat(oz(d.intake))), backgroundColor: '#38bdf8', borderRadius: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

window.updateHRVRange = async function (range, btn) {
    if (range) window.currentHRVRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    if (window.fetchHRVHistory) window.fetchHRVHistory();
}

window.renderHRVVisual = function (data) {
    const canvasId = 'hrvHistoryChart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const statusContainer = document.getElementById('hrv-status-container');

    if (window.currentHRVRange === '1d') {
        if (canvas) canvas.style.display = 'none';
        if (statusContainer) statusContainer.style.display = 'block';

        const summary = data.hrvSummary || data.summary || data || {};
        const lastNight = summary.lastNightAvg || summary.last_night_avg || '--';
        const weeklyAvg = summary.weeklyAvg || summary.weekly_avg || '--';
        const status = summary.lastNightStatus || summary.last_night_status || summary.status || '--';
        const feedback = summary.feedbackText || summary.feedback || '';
        
        const baseline = summary.baseline || {};
        const low = baseline.balancedLow || summary.baselineLow || 0;
        const high = baseline.balancedUpper || summary.baselineHigh || 0;
        let markerPercent = (baseline.markerValue !== undefined) ? (baseline.markerValue * 100) : null;

        // Restore Preferred Arrangement: 7d Avg as Main, Nightly as Secondary
        safeSetText('hrv-val', weeklyAvg);
        safeSetText('hrv-status-badge', status.replace(/_/g, ' '));
        safeSetText('hrv-weekly-avg', `Overnight: ${lastNight} ms`);
        safeSetText('hrv-baseline-low', low || '--');
        safeSetText('hrv-baseline-high', high || '--');
        safeSetText('hrv-feedback', feedback);

        // Update badge color
        const badge = document.getElementById('hrv-status-badge');
        if (badge) {
            badge.className = 'badge';
            const s = status.toLowerCase();
            if (s.includes('balanced') && !s.includes('unbalanced')) badge.classList.add('badge-success');
            else if (s.includes('low') || s.includes('unbalanced')) badge.classList.add('badge-warning');
            else if (s.includes('poor')) badge.classList.add('badge-danger');
        }

        // Update gauge marker
        const marker = document.getElementById('hrv-marker');
        const zone = document.getElementById('hrv-baseline-zone');
        if (marker) {
            if (markerPercent !== null) {
                marker.style.left = Math.max(5, Math.min(95, markerPercent)) + '%';
            } else if (low && high) {
                const range = high - low;
                const scaleMin = Math.max(0, low - range);
                const scaleMax = high + range;
                const scaleRange = scaleMax - scaleMin;
                const val = (lastNight !== '--') ? lastNight : weeklyAvg;
                const percent = (scaleRange > 0 && typeof val === 'number') ? ((val - scaleMin) / scaleRange) * 100 : 50;
                marker.style.left = Math.max(5, Math.min(95, percent)) + '%';
            }
        }
        
        if (zone && low && high) {
            // green zone represents the baseline. In our UI it's usually static 35-65%
            zone.style.left = '35%';
            zone.style.width = '30%';
        }
    } else {
        if (canvas) canvas.style.display = 'block';
        if (statusContainer) statusContainer.style.display = 'none';

        if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
        
        const history = data.history || [];
        const statusColors = history.map(d => {
            const st = (d.status || d.lastNightStatus || '').toLowerCase();
            if (st.includes('balanced')) return '#22c55e';
            if (st.includes('low') || st.includes('unbalanced')) return '#eab308';
            if (st.includes('poor')) return '#ef4444';
            return '#38bdf8';
        });

        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: history.map(d => d.calendarDate ? d.calendarDate.split('-').slice(1).join('/') : (d.date ? d.date.split('-').slice(1).join('/') : '')),
                datasets: [
                    {
                        label: '7d Trend',
                        data: history.map(d => d.weeklyAvg || d.weekly_avg),
                        borderColor: '#ffffff', // Fallback
                        borderWidth: 3,
                        segment: {
                            borderColor: ctx => statusColors[ctx.p1DataIndex] || '#ffffff'
                        },
                        pointBackgroundColor: statusColors,
                        pointBorderColor: '#1e293b',
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        tension: 0.4,
                        fill: false,
                        order: 1
                    },
                    {
                        label: 'Nightly Avg',
                        data: history.map(d => d.lastNightAvg || d.last_night_avg),
                        borderColor: 'rgba(56, 189, 248, 0.4)',
                        borderDash: [5, 5],
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false,
                        order: 2
                    },
                    {
                        label: 'Baseline Low',
                        data: history.map(d => {
                            const b = d.baseline || d.summary?.baseline || {};
                            return b.balancedLow || d.baselineLow || 0;
                        }),
                        borderColor: 'transparent',
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false,
                        order: 3
                    },
                    {
                        label: 'Baseline Range',
                        data: history.map(d => {
                            const b = d.baseline || d.summary?.baseline || {};
                            return b.balancedUpper || d.baselineHigh || 0;
                        }),
                        borderColor: 'transparent',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        pointRadius: 0,
                        tension: 0.4,
                        fill: '-1',
                        order: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#94a3b8',
                            boxWidth: 12,
                            filter: (item) => !item.text.includes('Baseline')
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#94a3b8' },
                        suggestedMin: 40,
                        suggestedMax: 100
                    }
                }
            }
        });
    }
}

/**
 * --- ACTIVITY DETAIL ENGINE ---
 */
window.currentActivityChartsData = {}; 
window.activeChartSelection = { prefix: null, startX: null, endX: null, isDragging: false };

const activityChartBaseIds = ['activityElevChart', 'activityHrChart', 'activityCadenceChart', 'activityPowerChart', 'activitySpeedChart'];

function syncActivityCharts(source, prefix) {
    const { min, max } = source.scales.x;
    const highlight = source.options.plugins.rangeHighlight;
    
    activityChartBaseIds.forEach(baseId => {
        const id = prefix ? `${prefix}-${baseId}` : baseId;
        const chart = chartInstances[id];
        if (chart && chart !== source) {
            chart.options.scales.x.min = min;
            chart.options.scales.x.max = max;
            if (highlight) {
                chart.options.plugins.rangeHighlight.start = highlight.start;
                chart.options.plugins.rangeHighlight.end = highlight.end;
            }
            chart.update('none');
        }
    });

    if (highlight && highlight.start !== null && highlight.end !== null) {
        const xLabels = source.data.labels;
        const startIdx = xLabels.findIndex(x => x >= highlight.start);
        const endIdx = xLabels.findIndex(x => x >= highlight.end);
        if (startIdx !== -1 && endIdx !== -1 && window.highlightActivitySegment) {
            window.highlightActivitySegment(startIdx, endIdx);
        }
        window.updateSelectionStatsUI(prefix, highlight.start, highlight.end);
    }
}

window.zoomActivityCharts = function(prefix, factor) {
    const keys = Object.keys(window.chartInstances).filter(k => k.startsWith(prefix + '-'));
    if (keys.length === 0) return;
    const master = window.chartInstances[keys[0]];
    const { min, max } = master.scales.x;
    const range = max - min;
    const center = (min + max) / 2;
    const newRange = range * factor;
    
    master.options.scales.x.min = center - (newRange / 2);
    master.options.scales.x.max = center + (newRange / 2);
    master.update('none');
    syncActivityCharts(master, prefix);
    
    const scroll = document.getElementById(`${prefix}-zoom-scroll`);
    if (scroll) {
        const fullRange = master.data.labels[master.data.labels.length - 1];
        scroll.value = (center / fullRange) * 100;
    }
}

window.scrollActivityCharts = function(prefix, percent) {
    const keys = Object.keys(window.chartInstances).filter(k => k.startsWith(prefix + '-'));
    if (keys.length === 0) return;
    const master = window.chartInstances[keys[0]];
    const { min, max } = master.scales.x;
    const range = max - min;
    const fullRange = master.data.labels[master.data.labels.length - 1];
    const center = (percent / 100) * fullRange;

    master.options.scales.x.min = Math.max(0, center - (range / 2));
    master.options.scales.x.max = Math.min(fullRange, center + (range / 2));
    master.update('none');
    syncActivityCharts(master, prefix);
}

window.handleChartMouseDown = function(e, chart, prefix) {
    const rect = chart.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const val = chart.scales.x.getValueForPixel(x);
    window.activeChartSelection = { prefix, startX: val, endX: val, isDragging: true };
}

window.handleChartMouseMove = function(e, chart, prefix) {
    if (!window.activeChartSelection.isDragging) return;
    const rect = chart.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    window.activeChartSelection.endX = chart.scales.x.getValueForPixel(x);
    
    const s = Math.min(window.activeChartSelection.startX, window.activeChartSelection.endX);
    const f = Math.max(window.activeChartSelection.startX, window.activeChartSelection.endX);
    
    // Safety check - if we already have these values, avoid redundant updates
    if (chart.options.plugins.rangeHighlight.start === s && chart.options.plugins.rangeHighlight.end === f) return;

    chart.options.plugins.rangeHighlight.start = s;
    chart.options.plugins.rangeHighlight.end = f;
    chart.update('none');
    syncActivityCharts(chart, prefix);
}

window.handleChartMouseUp = function(e, chart, prefix) {
    window.activeChartSelection.isDragging = false;
}

window.updateSelectionStatsUI = function(prefix, start, end, isIndex = false) {
    const data = window.currentActivityChartsData[prefix];
    if (!data) return;
    const statsEl = document.getElementById(`${prefix}-selection-stats`);
    if (statsEl) statsEl.style.display = 'block';
    
    const times = data.timestamps.map((t, i) => i === 0 ? 0 : (new Date(t).getTime() - new Date(data.timestamps[0]).getTime())/1000);
    
    let s, f;
    if (isIndex) {
        s = Math.min(start, end);
        f = Math.max(start, end);
    } else {
        const sIdx = times.findIndex(t => t >= start);
        const eIdx = times.findIndex(t => t >= end);
        if (sIdx === -1 || eIdx === -1) return;
        s = Math.min(sIdx, eIdx);
        f = Math.max(eIdx, sIdx);
    }

    const slice = (arr) => arr ? arr.slice(s, f + 1).filter(v => v !== null) : [];
    const avg = (arr) => { const sl = slice(arr); return sl.length ? (sl.reduce((a, b) => a + b, 0) / sl.length) : 0; };
    
    // Exact duration from timestamps
    const durSec = Math.max(1, Math.round(times[f] - times[s]));
    const distDelta = (data.distance[f] || 0) - (data.distance[s] || 0);
    const distMi = Math.max(0, distDelta * 0.000621371);

    window.safeSetText(`${prefix}-stat-time`, window.formatDuration(durSec));
    window.safeSetText(`${prefix}-stat-dist`, distMi.toFixed(2) + ' mi');
    if (data.power && data.power.length > 0) window.safeSetText(`${prefix}-stat-power`, Math.round(avg(data.power)) + ' W');
    if (data.heart_rate && data.heart_rate.length > 0) window.safeSetText(`${prefix}-stat-hr`, Math.round(avg(data.heart_rate)) + ' bpm');
    
    const speedAvgMpS = avg(data.speed);
    if (data.speed && data.speed.length > 0) {
        if (prefix && prefix.includes('stage-')) {
             // For running, we want pace usually, but if it's a bike, speed. 
             // We can use the global isCycle check or just check speedAvgMpS to see if it's high.
             // Actually, let's keep it simple: if it's pace, use pace.
             const isRun = document.querySelector(`#${prefix}-activitySpeedChart`)?.parentElement?.innerText?.toLowerCase()?.includes('pace');
             if (isRun) {
                 const pacePerMi = speedAvgMpS > 0.5 ? (26.8224 / speedAvgMpS) : 0;
                 window.safeSetText(`${prefix}-stat-speed`, pacePerMi > 0 ? `${Math.floor(pacePerMi)}:${Math.floor((pacePerMi % 1) * 60).toString().padStart(2, '0')} /mi` : '--');
             } else {
                 window.safeSetText(`${prefix}-stat-speed`, (speedAvgMpS * 2.23694).toFixed(1) + ' mph');
             }
        } else {
            window.safeSetText(`${prefix}-stat-speed`, (speedAvgMpS * 2.23694).toFixed(1) + ' mph');
        }
    }
    if (data.cadence && data.cadence.length > 0) window.safeSetText(`${prefix}-stat-cadence`, Math.round(avg(data.cadence)));
}

window.clearSelection = function(prefix) {
    const statsEl = document.getElementById(`${prefix}-selection-stats`);
    if (statsEl) statsEl.style.display = 'none';
    window.clearChartHighlight(prefix);
    if (window.clearActivityHighlight) window.clearActivityHighlight();
}

window.renderActivityCharts = function(charts, isRun, isCycle, prefix = null) {
    if (!charts.timestamps || charts.timestamps.length === 0) return;
    if (prefix) window.currentActivityChartsData[prefix] = charts;
    const start = new Date(charts.timestamps[0]).getTime();
    const elapsed = charts.timestamps.map(t => (new Date(t).getTime() - start) / 1000);

    window.renderDetailChart('activityElevChart', elapsed, charts.elevation.map(e => e * 3.28084), 'Elevation', '#94a3b8', 'ft', false, null, prefix);
    window.renderDetailChart('activityHrChart', elapsed, charts.heart_rate, 'Heart Rate', '#f87171', 'bpm', false, null, prefix);
    if (charts.cadence && charts.cadence.length > 0) window.renderDetailChart('activityCadenceChart', elapsed, charts.cadence, isRun ? 'Steps' : 'RPM', '#4ade80', '', false, null, prefix);
    if (charts.power && charts.power.length > 0) window.renderDetailChart('activityPowerChart', elapsed, charts.power, 'Power', '#a855f7', 'W', false, getPowerZoneColor, prefix);
    
    if (isRun) {
        const paceData = charts.speed.map(s => (s > 0.5) ? (26.8224 / s) : null);
        window.renderDetailChart('activitySpeedChart', elapsed, paceData, 'Pace', '#38bdf8', '/mi', true, null, prefix);
    } else {
        window.renderDetailChart('activitySpeedChart', elapsed, charts.speed.map(s => s * 2.23694), 'Speed', '#38bdf8', 'mph', false, null, prefix);
    }
}

window.renderDetailChart = function(id, x, y, label, color, unit, rev = false, colorFunc = null, prefix = null) {
    const finalId = prefix ? `${prefix}-${id}` : id;
    const canvas = document.getElementById(finalId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (chartInstances[finalId]) chartInstances[finalId].destroy();

    const chart = new Chart(ctx, {
        type: 'line',
        data: { labels: x, datasets: [{
            label, data: y, borderColor: color, backgroundColor: color + '11',
            fill: true, pointRadius: 0, tension: 0.3, borderWidth: 2,
            segment: colorFunc ? {
                borderColor: ctx => ctx.p1.parsed.y ? colorFunc(ctx.p1.parsed.y) : color,
                backgroundColor: ctx => ctx.p1.parsed.y ? colorFunc(ctx.p1.parsed.y) + '33' : color + '11'
            } : undefined
        }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            events: ['mousedown', 'mousemove', 'mouseup', 'mouseout'],
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true, mode: 'index', intersect: false,
                    callbacks: {
                        title: (items) => window.formatDuration(items[0].parsed.x),
                        label: (ctx) => `${label}: ${ctx.parsed.y ? ctx.parsed.y.toFixed(1) : '--'} ${unit}`
                    }
                },
                zoom: { pan: { enabled: false }, zoom: { wheel: { enabled: false } } },
                rangeHighlight: { start: null, end: null, color: 'rgba(245, 158, 11, 0.2)' }
            },
            scales: {
                y: { reverse: rev, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#919191', font: { size: 10 }, maxTicksLimit: 5 } },
                x: { type: 'linear', ticks: { color: '#919191', font: { size: 10 }, maxTicksLimit: 8, callback: v => window.formatDuration(v) }, grid: { display: false } }
            }
        },
        plugins: [{
            id: 'rangeHighlight',
            beforeDraw: (chart, args, options) => {
                const {ctx, chartArea: {top, bottom, left, right}, scales: {x}} = chart;
                if (options.start !== null && options.end !== null) {
                    ctx.save(); ctx.fillStyle = options.color;
                    const xStart = x.getPixelForValue(options.start);
                    const xEnd = x.getPixelForValue(options.end);
                    ctx.fillRect(Math.max(xStart, left), top, Math.min(xEnd - xStart, right - xStart), bottom - top);
                    ctx.restore();
                }
            }
        }]
    });
    
    canvas.onmousedown = (e) => window.handleChartMouseDown(e, chart, prefix);
    canvas.onmousemove = (e) => window.handleChartMouseMove(e, chart, prefix);
    canvas.onmouseup = (e) => window.handleChartMouseUp(e, chart, prefix);
    canvas.onmouseout = (e) => (window.activeChartSelection.isDragging = false);

    chartInstances[finalId] = chart;
}

window.highlightChartRange = function(prefix, startIdx, endIdx) {
    const keys = Object.keys(window.chartInstances).filter(k => k.startsWith(prefix + '-'));
    keys.forEach(k => {
        const chart = window.chartInstances[k];
        if (chart && chart.options.plugins.rangeHighlight) {
            const xValues = chart.data.labels;
            const startX = xValues[startIdx];
            const endX = xValues[endIdx];
            chart.options.plugins.rangeHighlight.start = startX;
            chart.options.plugins.rangeHighlight.end = endX;
            chart.update('none');
        }
    });
}

window.clearChartHighlight = function(prefix) {
    const keys = Object.keys(window.chartInstances).filter(k => k.startsWith(prefix + '-'));
    keys.forEach(k => {
        const chart = window.chartInstances[k];
        if (chart && chart.options.plugins.rangeHighlight) {
            chart.options.plugins.rangeHighlight.start = null;
            chart.options.plugins.rangeHighlight.end = null;
            chart.update('none');
        }
    });
}

window.resetZoom = function(prefix) {
    const activePrefix = prefix || window.currentActivityPrefix;
    const keys = Object.keys(window.chartInstances).filter(k => 
        activePrefix ? k.startsWith(activePrefix + '-') : (k.includes('activity') && !k.includes('YTD') && !k.includes('YtD'))
    );
    
    if (keys.length === 0) return;
    const master = window.chartInstances[keys[0]];
    const fullRange = master.data.labels[master.data.labels.length - 1];
    
    keys.forEach(k => {
        const chart = window.chartInstances[k];
        if (chart) {
            chart.options.scales.x.min = 0;
            chart.options.scales.x.max = fullRange;
            if (chart.options.plugins.rangeHighlight) {
                chart.options.plugins.rangeHighlight.start = null;
                chart.options.plugins.rangeHighlight.end = null;
            }
            chart.update('none');
        }
    });

    // Reset map view
    if (window.activityMap && window.currentActivityPoints) {
        const displayPoints = window.currentActivityPoints.filter(p => p !== null);
        if (displayPoints.length > 1) {
            const bounds = L.latLngBounds(displayPoints);
            window.activityMap.fitBounds(bounds, { padding: [20, 20] });
        }
        if (window.clearActivityHighlight) window.clearActivityHighlight();
    }
    
    // Reset Scrollbar
    const scroll = document.getElementById(`${activePrefix}-zoom-scroll`);
    if (scroll) scroll.value = 50;
    
    // Clear selection stats
    const statsEl = document.getElementById(`${activePrefix}-selection-stats`);
    if (statsEl) statsEl.style.display = 'none';
}

window.closeModal = function() {
    const modal = document.getElementById('activityModal');
    if (modal) modal.classList.remove('active');
}

function getPowerZoneColor(p) {
    if (p >= 450) return '#a855f7'; if (p >= 350) return '#ef4444'; if (p >= 300) return '#f97316';
    if (p >= 250) return '#eab308'; if (p >= 200) return '#22c55e'; if (p >= 150) return '#3b82f6';
    return '#94a3b8';
}

window.formatDuration = function(s) {
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}` : `${m}:${sec.toString().padStart(2, '0')}`;
}
