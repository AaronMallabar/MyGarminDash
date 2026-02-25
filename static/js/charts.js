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
        // Check cache first
        const cached = getCachedData('weight', window.currentWeightRange, window.currentWeightEndDate);
        if (cached) {
            renderWeightChart(cached, window.currentWeightRange);
            return;
        }

        // Check preloaded data for 1y
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

    const weightData = (data.history || data) || []; // Robust check for older format too
    const summary = data.summary || {};

    // Update UI Stats
    if (summary.latest_lbs) {
        // Just the number, index.html has the unit
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
        const color = summary.range_change > 0 ? '#f87171' : '#4ade80'; // Red for gain, green for loss
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
                            const d = new Date(items[0].label);
                            return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                        },
                        label: (ctx) => `Weight: ${ctx.parsed.y.toFixed(1)} lbs`
                    }
                },
                zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
            },
            scales: {
                x: {
                    type: 'category', // Using labels as strings for better alignment
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
    fat_g: { label: 'Fat', color: '#f97316', axis: 'y1', unit: 'g' }
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
}

window.renderCalorieChart = function (data) {
    const canvasId = 'calorieHistoryChart';
    const canvas = document.getElementById(canvasId);
    const oneDayContainer = document.getElementById('calorie-1d-container');
    const range = data.range || window.currentCalorieRange;
    const history = data.history || [];

    if (range === '1d' && history.length > 0) {
        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
            chartInstances[canvasId] = null;
        }
        if (chartInstances['calorieMacrosDonut']) {
            chartInstances['calorieMacrosDonut'].destroy();
            chartInstances['calorieMacrosDonut'] = null;
        }
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
    if (chartInstances['calorieMacrosDonut']) {
        chartInstances['calorieMacrosDonut'].destroy();
        chartInstances['calorieMacrosDonut'] = null;
    }
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const filters = getCalorieFilters();
    if (history.length === 0 || filters.length === 0) {
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: { responsive: true, maintainAspectRatio: false }
        });
        return;
    }

    const labels = history.map(h => h.date);
    const datasets = [];
    const y1Metrics = filters.filter(f => (CALORIE_METRIC_CONFIG[f] || {}).axis === 'y1');
    const hasWeight = y1Metrics.includes('weight_lbs');
    const hasNutrients = y1Metrics.some(f => f !== 'weight_lbs');
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
            _metricKey: key,
            _unit: cfg.unit,
            borderColor: cfg.color,
            backgroundColor: key === 'net_energy' ? cfg.color + '10' : cfg.color + '20',
            borderWidth: key === 'net_energy' ? 4 : 2,
            tension: 0.3,
            pointRadius: history.length <= 31 ? 3 : 0,
            yAxisID: cfg.axis,
            fill: key === 'net_energy' ? 'origin' : false
        });
    });

    const y1Min = y1RawVals.length ? Math.min(...y1RawVals) : 0;
    const y1Max = y1RawVals.length ? Math.max(...y1RawVals) * 1.1 : 100;

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 10 } } },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    callbacks: {
                        title: (items) => {
                            const d = new Date(items[0].label);
                            return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#94a3b8', maxTicksLimit: 10, callback: (_, i) => {
                            const p = labels[i].split('-');
                            return p[1] + '/' + p[2];
                        }
                    }
                },
                y: {
                    position: 'left',
                    title: { display: true, text: 'kcal', color: '#94a3b8' },
                    grid: {
                        color: (ctx) => (ctx.tick && ctx.tick.value === 0) ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.05)',
                        lineWidth: (ctx) => (ctx.tick && ctx.tick.value === 0) ? 2 : 1
                    },
                    ticks: { color: '#94a3b8' }
                },
                y1: {
                    position: 'right',
                    display: y1Metrics.length > 0,
                    min: Math.max(0, y1Min - (y1Max - y1Min) * 0.1),
                    max: y1Max,
                    title: { display: y1Metrics.length > 0, text: hasWeight && hasNutrients ? 'Weight (lbs) / Nutrients' : (hasWeight ? 'lbs' : 'mg / g'), color: '#818cf8' },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#818cf8' }
                }
            }
        }
    });
};

window.updateStepsRange = async function (range, btn) {
    if (range) window.currentStepsRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    try {
        // Check cache first
        const cached = getCachedData('steps', window.currentStepsRange, window.currentStepsEndDate);
        if (cached) {
            renderStepsVisual(cached);
            return;
        }

        // Check preloaded data for 1y
        if (window.currentStepsRange === '1y' && isDateToday(window.currentStepsEndDate) && window.preloadedData['steps']) {
            setCachedData('steps', window.currentStepsRange, window.currentStepsEndDate, window.preloadedData['steps']);
            renderStepsVisual(window.preloadedData['steps']);
            return;
        }

        const res = await fetch(`/api/steps_history?range=${window.currentStepsRange}&end_date=${getLocalDateStr(window.currentStepsEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                setCachedData('steps', window.currentStepsRange, window.currentStepsEndDate, data);
                renderStepsVisual(data);
            }
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
        const goalK = day.stepGoal >= 1000 ? (day.stepGoal / 1000) + 'k' : day.stepGoal;
        safeSetText('steps-goal-text', '/ ' + goalK);

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

        const barPct = data.history.length > 100 ? 1.0 : (data.history.length > 30 ? 0.8 : 0.6);
        const radius = data.history.length > 100 ? 0 : 4;
        if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.history.map(d => { const p = d.calendarDate.split('-'); return `${p[1]}/${p[2]}`; }),
                datasets: [{
                    label: 'Steps',
                    data: data.history.map(d => d.totalSteps),
                    backgroundColor: data.history.map(d => d.totalSteps >= d.stepGoal ? '#4ade80' : '#38bdf8'),
                    borderRadius: radius,
                    barPercentage: data.history.length > 100 ? 0.7 : (data.history.length > 30 ? 0.4 : 0.5),
                    categoryPercentage: data.history.length > 100 ? 0.9 : 0.8
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => `Steps: ${ctx.parsed.y.toLocaleString()}` } },
                    zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: window.innerWidth < 600 ? 5 : 7 } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }
}

window.updateHRRange = async function (range, btn) {
    if (range) window.currentHRRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    try {
        // Check cache first
        const cached = getCachedData('hr', window.currentHRRange, window.currentHREndDate);
        if (cached) {
            renderHRVisual(cached);
            return;
        }

        // Check preloaded data for 1y
        if (window.currentHRRange === '1y' && isDateToday(window.currentHREndDate) && window.preloadedData['hr']) {

            setCachedData('hr', window.currentHRRange, window.currentHREndDate, window.preloadedData['hr']);
            renderHRVisual(window.preloadedData['hr']);
            return;
        }

        const res = await fetch(`/api/hr_history?range=${window.currentHRRange}&end_date=${getLocalDateStr(window.currentHREndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                setCachedData('hr', window.currentHRRange, window.currentHREndDate, data);
                renderHRVisual(data);
            }
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
        const maxHR = data.max_hr || 190;
        const zones = data.zones || [95, 114, 133, 152, 171];
        safeSetText('hr-max-val', data.summary.max || '--');

        const points = data.samples.map(s => ({ x: s[0], y: s[1] }));
        const getZoneColor = (hr) => {
            if (hr >= zones[4]) return '#a855f7';
            if (hr >= zones[3]) return '#ef4444';
            if (hr >= zones[2]) return '#f97316';
            if (hr >= zones[1]) return '#22c55e';
            if (hr >= zones[0]) return '#3b82f6';
            return '#94a3b8';
        };

        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Heart Rate',
                    data: points,
                    borderWidth: 2,
                    pointRadius: 0,
                    segment: { borderColor: ctx => getZoneColor(ctx.p1.parsed.y) },
                    tension: 0.4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } } },
                scales: {
                    x: { type: 'time', time: { displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } }, grid: { display: false }, ticks: { color: '#94a3b8' } },
                    y: { min: 40, max: Math.max(200, maxHR + 5), grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    } else {
        const labels = data.history.map(d => {
            const p = d.date.split('-');
            return p[1] + '/' + p[2];
        });
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Resting HR',
                        data: data.history.map(d => d.rhr),
                        borderColor: '#38bdf8',
                        backgroundColor: 'rgba(56, 189, 248, 0.1)',
                        borderWidth: 3,
                        pointRadius: data.history.length > 31 ? 0 : 3,
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Max HR',
                        data: data.history.map(d => d.max),
                        borderColor: '#ef4444',
                        borderWidth: 2,
                        pointRadius: data.history.length > 31 ? 0 : 2,
                        tension: 0.4,
                        fill: false
                    }
                ]
            },
            options: {
                animation: false,
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: window.innerWidth > 600,
                        position: 'top',
                        labels: {
                            color: '#94a3b8',
                            boxWidth: window.innerWidth < 768 ? 8 : 12,
                            padding: window.innerWidth < 768 ? 5 : 10,
                            font: { size: window.innerWidth < 768 ? 9 : 11 }
                        }
                    },
                    zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: window.innerWidth < 600 ? 5 : 12 } },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }
}

window.updateStressRange = async function (range, btn) {
    if (range) window.currentStressRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    try {
        // Check cache first
        const cached = getCachedData('stress', window.currentStressRange, window.currentStressEndDate);
        if (cached) {
            renderStressVisual(cached);
            return;
        }

        // Check preloaded data for 1y
        if (window.currentStressRange === '1y' && isDateToday(window.currentStressEndDate) && window.preloadedData['stress']) {

            setCachedData('stress', window.currentStressRange, window.currentStressEndDate, window.preloadedData['stress']);
            renderStressVisual(window.preloadedData['stress']);
            return;
        }

        const res = await fetch(`/api/stress_history?range=${window.currentStressRange}&end_date=${getLocalDateStr(window.currentStressEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                setCachedData('stress', window.currentStressRange, window.currentStressEndDate, data);
                renderStressVisual(data);
            }
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
        const getStressColor = (val) => {
            if (val < 0) return 'rgba(148, 163, 184, 0.1)';
            if (val <= 25) return '#94a3b8';
            if (val <= 50) return '#f97316';
            if (val <= 75) return '#f43f5e';
            return '#ef4444';
        };

        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Stress',
                    data: points,
                    borderWidth: 2,
                    pointRadius: 0,
                    segment: { borderColor: ctx => getStressColor(ctx.p1.parsed.y) },
                    tension: 0.4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } } },
                scales: {
                    x: { type: 'time', time: { displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } }, grid: { display: false }, ticks: { color: '#94a3b8' } },
                    y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    } else {
        const labels = data.history.map(d => {
            const p = d.date.split('-');
            return p[1] + '/' + p[2];
        });
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Avg',
                        data: data.history.map(d => d.avg),
                        borderColor: '#f97316',
                        backgroundColor: 'rgba(249, 115, 22, 0.1)',
                        borderWidth: 3,
                        pointRadius: data.history.length > 31 ? 0 : 3,
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Max',
                        data: data.history.map(d => d.max),
                        borderColor: '#ef4444',
                        borderWidth: 2,
                        pointRadius: data.history.length > 31 ? 0 : 2,
                        tension: 0.4,
                        fill: false
                    }
                ]
            },
            options: {
                animation: false,
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: window.innerWidth > 600,
                        labels: {
                            color: '#94a3b8',
                            boxWidth: window.innerWidth < 768 ? 8 : 12,
                            padding: window.innerWidth < 768 ? 5 : 10,
                            font: { size: window.innerWidth < 768 ? 9 : 11 }
                        }
                    },
                    zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: window.innerWidth < 600 ? 5 : 12 } },
                    y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }
}

window.updateSleepRange = async function (range, btn) {
    if (range) window.currentSleepRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    try {
        // Check cache first
        const cached = getCachedData('sleep', window.currentSleepRange, window.currentSleepEndDate);
        if (cached) {
            renderSleepVisual(cached);
            return;
        }

        // Check preloaded data for 1y
        if (window.currentSleepRange === '1y' && isDateToday(window.currentSleepEndDate) && window.preloadedData['sleep']) {
            setCachedData('sleep', window.currentSleepRange, window.currentSleepEndDate, window.preloadedData['sleep']);
            renderSleepVisual(window.preloadedData['sleep']);
            return;
        }

        const res = await fetch(`/api/sleep_history?range=${window.currentSleepRange}&end_date=${getLocalDateStr(window.currentSleepEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                setCachedData('sleep', window.currentSleepRange, window.currentSleepEndDate, data);
                renderSleepVisual(data);
            }
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
        const stageData = [
            { label: 'Deep', value: s.deep || 0, color: '#6366f1' },
            { label: 'Light', value: s.light || 0, color: '#3b82f6' },
            { label: 'REM', value: s.rem || 0, color: '#2dd4bf' },
            { label: 'Awake', value: s.awake || 0, color: '#f97316' }
        ].filter(d => d.value > 0);

        chartInstances[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: stageData.map(d => d.label), datasets: [{ data: stageData.map(d => d.value), backgroundColor: stageData.map(d => d.color), borderWidth: 0 }] },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: {
                    legend: {
                        display: window.innerWidth > 400,
                        position: window.innerWidth < 768 ? 'bottom' : 'right',
                        labels: {
                            color: '#94a3b8',
                            boxWidth: window.innerWidth < 768 ? 8 : 12,
                            padding: window.innerWidth < 768 ? 10 : 20,
                            font: { size: window.innerWidth < 768 ? 9 : 11 }
                        }
                    },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${Math.floor(ctx.raw / 3600)}h ${Math.round((ctx.raw % 3600) / 60)}m` } }
                }
            }
        });
    } else {
        const labels = data.history.map(d => {
            const p = d.date.split('-');
            return p[1] + '/' + p[2];
        });
        const isMobile = window.innerWidth < 600;
        const barPct = data.history.length > 100 ? 0.7 : (data.history.length > 30 ? 0.4 : 0.5);
        const catPct = data.history.length > 100 ? 0.9 : 0.8;
        const radius = data.history.length > 100 ? 0 : 4;
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Score',
                    data: data.history.map(d => d.score),
                    borderColor: '#818cf8',
                    backgroundColor: 'rgba(129, 140, 248, 0.1)',
                    borderWidth: 3,
                    pointRadius: data.history.length > 31 ? 0 : 4,
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                animation: false,
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: isMobile ? 5 : 12 } },
                    y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }
}

window.updateHydrationRange = async function (range, btn) {
    if (range) window.currentHydrationRange = range;
    if (btn) { btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    const donut = document.getElementById('hydration-donut-container');
    const hChartCanvas = document.getElementById('hydrationHistoryChart');
    if (donut) donut.style.display = window.currentHydrationRange === '1d' ? 'block' : 'none';
    if (hChartCanvas) hChartCanvas.style.display = window.currentHydrationRange === '1d' ? 'none' : 'block';
    await renderHydrationVisual();
}

async function renderHydrationVisual() {
    try {
        // Check cache first
        const cached = getCachedData('hydration', window.currentHydrationRange, window.currentHydrationEndDate);
        if (cached) {
            const oz = (ml) => (ml * 0.033814).toFixed(1);
            if (window.currentHydrationRange === '1d') {
                const p = Math.min(100, Math.round((cached.summary.intake / cached.summary.goal) * 100));
                safeSetText('hydration-val', oz(cached.summary.intake) + ' oz');
                safeSetText('hydration-goal', 'Goal: ' + oz(cached.summary.goal) + ' oz');
                safeSetText('hydration-percent', p + '%');
                const hChart = document.getElementById('hydration-chart');
                if (hChart) hChart.style.background = `conic-gradient(${p >= 100 ? '#22c55e' : '#38bdf8'} ${p}%, rgba(255,255,255,0.05) ${p}% 100%)`;
            } else {
                const ctx = document.getElementById('hydrationHistoryChart').getContext('2d');
                if (chartInstances['hydrationHistoryChart']) chartInstances['hydrationHistoryChart'].destroy();
                const fastLabels = cached.history.map(d => {
                    const parts = d.date.split('-');
                    return parts[1] + '/' + parts[2];
                });
                chartInstances['hydrationHistoryChart'] = new Chart(ctx, {
                    type: 'bar',
                    data: { labels: fastLabels, datasets: [{ label: 'oz', data: cached.history.map(d => parseFloat(oz(d.intake))), backgroundColor: cached.history.map(d => d.intake >= d.goal ? '#22c55e' : '#38bdf8'), borderRadius: cached.history.length > 100 ? 0 : 6, barPercentage: cached.history.length > 100 ? 1.0 : (cached.history.length > 30 ? 0.8 : 0.6) }] },
                    options: {
                        animation: false,
                        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                        scales: {
                            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                            x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }
                        }
                    }
                });
            }
            return;
        }

        // Check preloaded data for 1y
        if (window.currentHydrationRange === '1y' && isDateToday(window.currentHydrationEndDate) && window.preloadedData['hydration']) {
            setCachedData('hydration', window.currentHydrationRange, window.currentHydrationEndDate, window.preloadedData['hydration']);
            const data = window.preloadedData['hydration'];
            const oz = (ml) => (ml * 0.033814).toFixed(1);
            const ctx = document.getElementById('hydrationHistoryChart').getContext('2d');
            if (chartInstances['hydrationHistoryChart']) chartInstances['hydrationHistoryChart'].destroy();
            chartInstances['hydrationHistoryChart'] = new Chart(ctx, {
                type: 'bar',
                data: { labels: data.history.map(d => parseLocalDate(d.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })), datasets: [{ label: 'oz', data: data.history.map(d => parseFloat(oz(d.intake))), backgroundColor: data.history.map(d => d.intake >= d.goal ? '#22c55e' : '#38bdf8'), borderRadius: 6 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } }
            });
            return;
        }
        const res = await fetch(`/api/hydration_history?range=${window.currentHydrationRange}&end_date=${getLocalDateStr(window.currentHydrationEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.error) return;

            // Cache the fetched data
            setCachedData('hydration', window.currentHydrationRange, window.currentHydrationEndDate, data);

            const oz = (ml) => (ml * 0.033814).toFixed(1);
            if (window.currentHydrationRange === '1d') {
                const p = Math.min(100, Math.round((data.summary.intake / data.summary.goal) * 100));
                safeSetText('hydration-val', oz(data.summary.intake) + ' oz');
                safeSetText('hydration-goal', 'Goal: ' + oz(data.summary.goal) + ' oz');
                safeSetText('hydration-percent', p + '%');
                const hChart = document.getElementById('hydration-chart');
                if (hChart) hChart.style.background = `conic-gradient(${p >= 100 ? '#22c55e' : '#38bdf8'} ${p}%, rgba(255,255,255,0.05) ${p}% 100%)`;
            } else {
                const ctx = document.getElementById('hydrationHistoryChart').getContext('2d');
                if (chartInstances['hydrationHistoryChart']) chartInstances['hydrationHistoryChart'].destroy();
                // Optimization: Fast date labels
                const fastLabels = data.history.map(d => {
                    const parts = d.date.split('-');
                    return parts[1] + '/' + parts[2];
                });
                chartInstances['hydrationHistoryChart'] = new Chart(ctx, {
                    type: 'bar',
                    data: { labels: fastLabels, datasets: [{ label: 'oz', data: data.history.map(d => parseFloat(oz(d.intake))), backgroundColor: data.history.map(d => d.intake >= d.goal ? '#22c55e' : '#38bdf8'), borderRadius: data.history.length > 100 ? 0 : 6, barPercentage: data.history.length > 100 ? 1.0 : (data.history.length > 30 ? 0.8 : 0.6) }] },
                    options: {
                        animation: false,
                        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                        scales: {
                            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                            x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }
                        }
                    }
                });
            }
        }
    } catch (err) { console.error('Hydration error:', err); }
}

function shiftHydrationDate(dir) {
    window.currentHydrationEndDate.setDate(window.currentHydrationEndDate.getDate() + (dir * (window.currentHydrationRange === '1d' ? 1 : 7)));
    if (window.currentHydrationEndDate > new Date()) window.currentHydrationEndDate = new Date();
    renderHydrationVisual();
}


window.updateHRVRange = async function (range, btn) {
    if (range) window.currentHRVRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    if (window.fetchHRV) window.fetchHRV();
}

window.shiftHRVDate = function (dir) {
    window.currentHRVEndDate.setDate(window.currentHRVEndDate.getDate() + (dir * (window.currentHRVRange === '1d' ? 1 : 7)));
    if (window.currentHRVEndDate > new Date()) window.currentHRVEndDate = new Date();
    window.fetchHRV();
}

/**
 * Render HRV Visual Card
 */
window.renderHRVVisual = function (data) {
    const canvasId = 'hrvHistoryChart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const statusContainer = document.getElementById('hrv-status-container');
    if (window.chartInstances[canvasId]) window.chartInstances[canvasId].destroy();

    const range = data.range || window.currentHRVRange;

    // Daily View
    if (range === '1d') {
        if (canvas) canvas.style.display = 'none';
        if (statusContainer) statusContainer.style.display = 'block';

        if (!data.hrvSummary) return;
        const summary = data.hrvSummary;

        // Set values: Primary = 7d Avg, Secondary = Overnight
        safeSetText('hrv-val', summary.weeklyAvg || '--');
        safeSetText('hrv-weekly-avg', `Overnight: ${summary.lastNightAvg || '--'} ms`);

        // Status Badge
        const statusEl = document.getElementById('hrv-status-badge');
        if (statusEl) {
            const status = summary.status || 'NO_STATUS';
            statusEl.textContent = status.replace(/_/g, ' ');
            statusEl.className = 'badge';

            if (status === 'BALANCED') statusEl.classList.add('badge-balanced');
            else if (status === 'UNBALANCED') statusEl.classList.add('badge-unbalanced');
            else if (status === 'LOW') statusEl.classList.add('badge-low');
            else statusEl.classList.add('badge-gray');
        }

        // Baseline Gauge logic
        const baseline = summary.baseline;
        if (baseline) {
            safeSetText('hrv-baseline-low', baseline.balancedLow || '--');
            safeSetText('hrv-baseline-high', baseline.balancedUpper || '--');

            const low = (baseline.balancedLow || 40) - 15;
            const high = (baseline.balancedUpper || 80) + 15;
            const rangeVal = high - low;
            const val = summary.lastNightAvg || low;
            const pct = Math.max(0, Math.min(100, ((val - low) / rangeVal) * 100));

            const marker = document.getElementById('hrv-marker');
            if (marker) marker.style.left = `${pct}%`;

            const zone = document.getElementById('hrv-baseline-zone');
            if (zone) {
                const zoneStart = Math.max(0, ((baseline.balancedLow - low) / rangeVal) * 100);
                const zoneWidth = ((baseline.balancedUpper - baseline.balancedLow) / rangeVal) * 100;
                zone.style.left = `${zoneStart}%`;
                zone.style.width = `${zoneWidth}%`;
            }
        }

        // Feedback
        const feedback = summary.feedbackPhrase || '';
        const friendlyFeedback = feedback
            .replace(/HRV_STATUS_FEEDBACK_/g, '')
            .replace(/HRV_UNBALANCED_/g, 'Unbalanced: ')
            .replace(/_/g, ' ')
            .toLowerCase()
            .replace(/^\w/, c => c.toUpperCase());
        safeSetText('hrv-feedback', friendlyFeedback || 'No feedback available');

    } else {
        // History View (Chart)
        if (canvas) canvas.style.display = 'block';
        if (statusContainer) statusContainer.style.display = 'none';

        if (!data.history || data.history.length === 0) return;

        const labels = data.history.map(d => {
            const p = d.calendarDate.split('-');
            return p[1] + '/' + p[2];
        });

        // Current summary for badge/value if available
        const lastSummary = data.history[data.history.length - 1];
        if (lastSummary) {
            safeSetText('hrv-val', lastSummary.weeklyAvg || '--');
            safeSetText('hrv-weekly-avg', `Overnight: ${lastSummary.lastNightAvg || '--'} ms`);

            const statusEl = document.getElementById('hrv-status-badge');
            if (statusEl) {
                const status = lastSummary.status || 'NO_STATUS';
                statusEl.textContent = status.replace(/_/g, ' ');
                statusEl.className = 'badge';
                if (status === 'BALANCED') statusEl.classList.add('badge-balanced');
                else if (status === 'UNBALANCED') statusEl.classList.add('badge-unbalanced');
                else if (status === 'LOW') statusEl.classList.add('badge-low');
                else statusEl.classList.add('badge-gray');
            }
        }

        const radius = data.history.length > 100 ? 0 : 5;
        const weeklyAvgData = data.history.map(d => d.weeklyAvg);
        const lastNightData = data.history.map(d => d.lastNightAvg);
        const baselineLow = data.history.map(d => d.baseline ? d.baseline.balancedLow : null);
        const baselineHigh = data.history.map(d => d.baseline ? d.baseline.balancedUpper : null);

        const pointColors = data.history.map(d => {
            if (d.status === 'BALANCED') return '#4ade80';
            if (d.status === 'UNBALANCED' || d.status === 'UNBALANCED_LOW') return '#fb923c';
            if (d.status === 'LOW' || d.status === 'POOR') return '#f87171';
            return '#94a3b8';
        });

        const pointShapes = data.history.map(d => {
            if (d.status === 'BALANCED') return 'circle';
            if (d.status === 'UNBALANCED' || d.status === 'UNBALANCED_LOW') return 'rect';
            if (d.status === 'LOW' || d.status === 'POOR') return 'triangle';
            return 'circle';
        });

        window.chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '7d Avg',
                        data: weeklyAvgData,
                        borderColor: 'transparent',
                        pointBackgroundColor: pointColors,
                        pointBorderColor: pointColors,
                        pointStyle: pointShapes,
                        pointRadius: radius,
                        pointHoverRadius: radius + 2,
                        showLine: false,
                        z: 20
                    },
                    {
                        label: 'Overnight Avg',
                        data: lastNightData,
                        borderColor: 'rgba(255, 255, 255, 0.4)',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        tension: 0.4,
                        z: 10
                    },
                    {
                        label: 'Baseline High',
                        data: baselineHigh,
                        borderColor: 'transparent',
                        backgroundColor: 'rgba(74, 222, 128, 0.12)',
                        pointRadius: 0,
                        fill: false,
                        tension: 0.1,
                        z: 0
                    },
                    {
                        label: 'Baseline Low',
                        data: baselineLow,
                        borderColor: 'transparent',
                        backgroundColor: 'rgba(74, 222, 128, 0.12)',
                        pointRadius: 0,
                        fill: '-1',
                        tension: 0.1,
                        z: 0
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 7 } },
                    y: { beginAtZero: false, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }
}

// --- Activity Detail Charts ---

const activityChartBaseIds = ['activityElevChart', 'activityHrChart', 'activityCadenceChart', 'activityPowerChart', 'activitySpeedChart'];

function syncActivityCharts(source, prefix) {
    const { min, max } = source.scales.x;
    // Find all charts in the same stage (same prefix)
    activityChartBaseIds.forEach(baseId => {
        const id = prefix ? `${prefix}-${baseId}` : baseId;
        const chart = chartInstances[id];
        if (chart && chart !== source) {
            chart.options.scales.x.min = min;
            chart.options.scales.x.max = max;
            chart.update('none');
        }
    });
}

window.closeModal = function () { document.getElementById('activityModal').classList.remove('active'); }

const activityChartIds = ['activityElevChart', 'activityHrChart', 'activityCadenceChart', 'activityPowerChart', 'activitySpeedChart'];
function syncActivityCharts(source) {
    const { min, max } = source.scales.x;
    activityChartIds.forEach(id => {
        const chart = chartInstances[id];
        if (chart && chart !== source) { chart.options.scales.x.min = min; chart.options.scales.x.max = max; chart.update('none'); }
    });
}

function renderActivityCharts(charts, isRun, isCycle, prefix = null) {
    if (!charts.timestamps || charts.timestamps.length === 0) return;
    const start = new Date(charts.timestamps[0]).getTime();
    const elapsed = charts.timestamps.map(t => (new Date(t).getTime() - start) / 1000);

    renderDetailChart('activityElevChart', elapsed, charts.elevation.map(e => e * 3.28084), 'Elevation', '#94a3b8', 'ft', false, null, prefix);
    renderDetailChart('activityHrChart', elapsed, charts.heart_rate, 'Heart Rate', '#f87171', 'bpm', false, null, prefix);

    if (charts.cadence && charts.cadence.length > 0) {
        renderDetailChart('activityCadenceChart', elapsed, charts.cadence, isRun ? 'Steps' : 'RPM', '#4ade80', '', false, null, prefix);
    }

    if (charts.power && charts.power.length > 0) {
        renderDetailChart('activityPowerChart', elapsed, charts.power, 'Power', '#a855f7', 'W', false, getPowerZoneColor, prefix);
    }

    if (isRun) {
        // PACE: Convert m/s to min/mi
        const paceData = charts.speed.map(s => (s > 0.5) ? (26.8224 / s) : null);
        renderDetailChart('activitySpeedChart', elapsed, paceData, 'Pace', '#38bdf8', '/mi', true, null, prefix);
    } else {
        // SPEED: Convert m/s to mph
        renderDetailChart('activitySpeedChart', elapsed, charts.speed.map(s => s * 2.23694), 'Speed', '#38bdf8', 'mph', false, null, prefix);
    }
}

function renderDetailChart(id, x, y, label, color, unit, rev = false, colorFunc = null, prefix = null) {
    const finalId = prefix ? `${prefix}-${id}` : id;
    const canvas = document.getElementById(finalId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (chartInstances[finalId]) chartInstances[finalId].destroy();

    const dataset = {
        label,
        data: y,
        borderColor: color,
        backgroundColor: color + '11',
        fill: true,
        pointRadius: 0,
        tension: 0.3,
        borderWidth: 2
    };

    if (colorFunc) {
        dataset.segment = {
            borderColor: ctx => ctx.p1.parsed.y ? colorFunc(ctx.p1.parsed.y) : color,
            backgroundColor: ctx => ctx.p1.parsed.y ? colorFunc(ctx.p1.parsed.y) + '33' : color + '11'
        };
    }

    chartInstances[finalId] = new Chart(ctx, {
        type: 'line',
        data: { labels: x, datasets: [dataset] },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: (items) => formatDuration(items[0].parsed.x),
                        label: (ctx) => `${label}: ${ctx.parsed.y ? ctx.parsed.y.toFixed(1) : '--'} ${unit}`
                    }
                },
                zoom: {
                    pan: { enabled: true, mode: 'x', onPan: (c) => syncActivityCharts(c.chart, prefix) },
                    zoom: { wheel: { enabled: true }, mode: 'x', onZoom: (c) => syncActivityCharts(c.chart, prefix) }
                }
            },
            scales: {
                y: {
                    reverse: rev,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#919191', font: { size: 10 }, maxTicksLimit: 5 }
                },
                x: {
                    type: 'linear',
                    ticks: { color: '#919191', font: { size: 10 }, maxTicksLimit: 8, callback: v => formatDuration(v) },
                    grid: { display: false }
                }
            }
        }
    });
}

function getPowerZoneColor(p) {
    if (p >= 450) return '#a855f7'; // Purple
    if (p >= 350) return '#ef4444'; // Red
    if (p >= 300) return '#f97316'; // Orange
    if (p >= 250) return '#eab308'; // Yellow
    if (p >= 200) return '#22c55e'; // Green
    if (p >= 150) return '#3b82f6'; // Blue
    return '#94a3b8'; // Grey
}

function formatDuration(s) {
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}` : `${m}:${sec.toString().padStart(2, '0')}`;
}
