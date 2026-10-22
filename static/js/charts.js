/**
 * Chart Rendering Functions
 * All Chart.js visualization logic
 */

// Global chart instances
window.chartInstances = window.chartInstances || {};
const chartInstances = window.chartInstances;

window.destroyChartIfExists = function (canvasIdOrEl) {
    if (!canvasIdOrEl) return;
    const canvas = typeof canvasIdOrEl === 'string' ? document.getElementById(canvasIdOrEl) : canvasIdOrEl;
    const id = typeof canvasIdOrEl === 'string' ? canvasIdOrEl : (canvas ? canvas.id : null);
    if (window.Chart && canvas) {
        try {
            const chart = window.Chart.getChart(canvas);
            if (chart) chart.destroy();
        } catch (e) {}
        try {
            if (window.Chart.instances) {
                Object.values(window.Chart.instances).forEach(c => {
                    if (c && (c.canvas === canvas || (id && c.canvas && c.canvas.id === id))) {
                        c.destroy();
                    }
                });
            }
        } catch (e) {}
    }
    if (id && window.chartInstances && window.chartInstances[id]) {
        try {
            window.chartInstances[id].destroy();
        } catch (e) {}
        delete window.chartInstances[id];
    }
    if (canvas) {
        canvas.style.display = 'block';
    }
};

window.getCleanCanvas = function (canvasIdOrEl) {
    if (!canvasIdOrEl) return null;
    const canvas = typeof canvasIdOrEl === 'string' ? document.getElementById(canvasIdOrEl) : canvasIdOrEl;
    if (!canvas) return null;

    // 1. Destroy all chart instances attached to this canvas
    window.destroyChartIfExists(canvas);

    // 2. Keep the existing canvas element in the DOM to preserve layout geometry, dimensions, and observers
    canvas.style.display = 'block';

    // 3. Reset 2D buffer
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
    }
    return canvas;
};

// Client-side cache for chart data
const chartDataCache = {
    steps: {},
    hr: {},
    stress: {},
    sleep: {},
    weight: {},
    hydration: {},
    hrv: {},
    im: {},
    intensity_minutes: {},
    calorie: {},
    activities: {}
};

function getCacheKey(range, endDate) {
    return `${range}_${getLocalDateStr(endDate)}`;
}

function getCachedData(metric, range, endDate) {
    const m = (metric === 'intensity_minutes') ? 'im' : metric;
    if (!chartDataCache[m]) chartDataCache[m] = {};
    const key = getCacheKey(range, endDate);
    return chartDataCache[m][key];
}

function setCachedData(metric, range, endDate, data) {
    const m = (metric === 'intensity_minutes') ? 'im' : metric;
    if (!chartDataCache[m]) chartDataCache[m] = {};
    const key = getCacheKey(range, endDate);
    chartDataCache[m][key] = data;
}

window.getCachedData = getCachedData;
window.setCachedData = setCachedData;

window.populateChartCache = function(metric, range, endDate, data) {
    if (chartDataCache[metric]) {
        setCachedData(metric, range, endDate, data);
    }
};

window.activeMetricControllers = window.activeMetricControllers || {};
window.metricRequestSeq = window.metricRequestSeq || {};

window.fetchAndRenderMetric = async function(metric, range, endDate, endpointUrl, canvasId, renderFn) {
    window.metricRequestSeq[metric] = (window.metricRequestSeq[metric] || 0) + 1;
    const seq = window.metricRequestSeq[metric];

    if (window.activeMetricControllers[metric]) {
        try {
            window.activeMetricControllers[metric].abort();
        } catch (e) {}
    }
    const controller = new AbortController();
    window.activeMetricControllers[metric] = controller;

    const targetRange = range;
    const targetEndDate = endDate || new Date();

    const cached = window.getCachedData ? window.getCachedData(metric, targetRange, targetEndDate) : null;
    if (cached) {
        window.hideChartLoading && window.hideChartLoading(canvasId);
        try {
            renderFn(cached, targetRange);
        } catch (err) {
            console.error('Error rendering cached ' + metric + ':', err);
        }
        return;
    }

    if (targetRange === '1y' && window.isDateToday(targetEndDate) && window.preloadedData && window.preloadedData[metric]) {
        const preData = window.preloadedData[metric];
        if (window.setCachedData) window.setCachedData(metric, targetRange, targetEndDate, preData);
        window.hideChartLoading && window.hideChartLoading(canvasId);
        try {
            renderFn(preData, targetRange);
        } catch (err) {
            console.error('Error rendering preloaded ' + metric + ':', err);
        }
        return;
    }

    window.showChartLoading && window.showChartLoading(canvasId);

    try {
        const res = await fetch(endpointUrl, { signal: controller.signal });
        if (res.ok) {
            const data = await res.json();
            if (seq !== window.metricRequestSeq[metric]) {
                return;
            }
            if (data && !data.error) {
                if (window.setCachedData) window.setCachedData(metric, targetRange, targetEndDate, data);
                try {
                    renderFn(data, targetRange);
                } catch (err) {
                    console.error('Error rendering fetched ' + metric + ':', err);
                }
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            return;
        }
        console.error(metric + ' fetch error:', err);
    } finally {
        if (seq === window.metricRequestSeq[metric]) {
            window.hideChartLoading && window.hideChartLoading(canvasId);
            delete window.activeMetricControllers[metric];
        }
    }
};

window.updateMetricDatePill = function(metricKey, range, endDate) {
    const pill = document.getElementById(`${metricKey}-date-range-pill`);
    if (!pill) return;
    const end = endDate ? new Date(endDate) : new Date();
    const start = new Date(end);
    if (range === '1d') {
        pill.textContent = `📅 ${end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
        return;
    } else if (range === '1w') {
        start.setDate(end.getDate() - 6);
    } else if (range === '1m') {
        start.setDate(end.getDate() - 27);
    } else if (range === '6m') {
        start.setMonth(end.getMonth() - 6);
    } else if (range === '1y') {
        start.setFullYear(end.getFullYear() - 1);
    } else if (range === '5y') {
        start.setFullYear(end.getFullYear() - 5);
    }
    const startStr = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const endStr = end.toLocaleDateString([], { month: 'short', day: 'numeric', year: start.getFullYear() !== end.getFullYear() ? 'numeric' : undefined });
    pill.textContent = `📅 ${startStr} – ${endStr}`;
};

// Smooth, fluid animations for interactive feel
Chart.defaults.animation = {
    duration: 350,
    easing: 'easeOutQuart'
};
Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

window.renderYTDChart = function (canvasId, labels, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    window.destroyChartIfExists(canvasId);

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
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const targetRange = window.currentWeightRange || '1m';
    const targetEndDate = window.currentWeightEndDate || new Date();
    window.updateMetricDatePill('weight', targetRange, targetEndDate);
    const url = `/api/weight_history?range=${targetRange}&end_date=${getLocalDateStr(targetEndDate)}`;
    await window.fetchAndRenderMetric('weight', targetRange, targetEndDate, url, 'weightHistoryChart', renderWeightChart);
};

window.renderWeightChart = function (data, range) {
    const canvasId = 'weightHistoryChart';
    const canvas = window.getCleanCanvas(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

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

    // Hydrate drilldown stat cards
    const latestLbs = summary.latest_lbs || (weightData.length > 0 ? weightData[weightData.length - 1].weight_lbs : null);
    if (latestLbs) {
        safeSetText('weight-drilldown-current', `${latestLbs.toFixed(1)} lbs`);
    }
    safeSetText('weight-drilldown-goal', '185.0 lbs');
    const delta = summary.delta_lbs !== undefined ? summary.delta_lbs : (summary.range_change !== undefined ? summary.range_change : null);
    if (delta !== null) {
        const prefix = delta > 0 ? '+' : '';
        safeSetText('weight-drilldown-change', `${prefix}${delta.toFixed(1)} lbs`);
        const changeEl = document.getElementById('weight-drilldown-change');
        if (changeEl) changeEl.style.color = delta <= 0 ? '#4ade80' : '#f87171';
    } else {
        safeSetText('weight-drilldown-change', '0.0 lbs');
    }
    const bmiVal = (summary && summary.bmi) ? summary.bmi : (document.getElementById('weight-bmi-val')?.textContent || '--');
    safeSetText('weight-drilldown-bmi', bmiVal);

    window.updateMetricDatePill('weight', range || window.currentWeightRange, window.currentWeightEndDate);

    if (weightData.length === 0) {
        window.destroyChartIfExists(canvasId);
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false } }
            },
            plugins: [{
                id: 'emptyWeightNotice',
                afterDraw(chart) {
                    const { ctx, width, height } = chart;
                    ctx.save();
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#94a3b8';
                    ctx.font = '14px Inter, sans-serif';
                    const dateStr = summary.date || 'prior period';
                    const lbsStr = summary.latest_lbs ? `${summary.latest_lbs} lbs (${dateStr})` : 'No data';
                    ctx.fillText('No weigh-ins recorded in this date range', width / 2, height / 2 - 12);
                    ctx.fillStyle = '#38bdf8';
                    ctx.font = '12px Inter, sans-serif';
                    ctx.fillText(`Latest recorded weight: ${lbsStr}`, width / 2, height / 2 + 14);
                    ctx.restore();
                }
            }]
        });
        return;
    }

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
window.currentCalorieRange = window.currentCalorieRange || '1w';
window.currentCalorieEndDate = window.currentCalorieEndDate || new Date();
window.lastCalorieData = window.lastCalorieData || null;

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
    if (!window.currentCalorieRange) window.currentCalorieRange = '1w';
    if (!window.currentCalorieEndDate) window.currentCalorieEndDate = new Date();

    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    try {
        const cached = getCachedData('calorie', window.currentCalorieRange, window.currentCalorieEndDate);
        if (cached) {
            window.lastCalorieData = cached;
            renderCalorieChart(cached);
            updateCalorieRangeLabel();
            return;
        }
        const res = await fetch(`/api/calorie_history?range=${window.currentCalorieRange}&end_date=${getLocalDateStr(window.currentCalorieEndDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                data.range = window.currentCalorieRange;
                window.lastCalorieData = data;
                setCachedData('calorie', window.currentCalorieRange, window.currentCalorieEndDate, data);
                renderCalorieChart(data);
                updateCalorieRangeLabel();
            }
        }
    } catch (err) { console.error('Calorie history error:', err); }
};

window.onCalorieFilterChange = function () {
    const cached = getCachedData('calorie', window.currentCalorieRange || '1w', window.currentCalorieEndDate || new Date()) || window.lastCalorieData;
    if (cached) {
        renderCalorieChart(cached);
    } else if (window.updateCalorieRange) {
        window.updateCalorieRange(window.currentCalorieRange || '1w');
    }
};

window.shiftCalorieDate = async function (dir) {
    if (!window.currentCalorieEndDate) window.currentCalorieEndDate = new Date();
    const range = window.currentCalorieRange || '1w';
    let daysToShift = 7;
    if (range === '1d') daysToShift = 1;
    else if (range === '1w') daysToShift = 7;
    else if (range === '1m') daysToShift = 30;
    else if (range === '1y') daysToShift = 365;

    const newEnd = new Date(window.currentCalorieEndDate);
    newEnd.setDate(newEnd.getDate() + dir * daysToShift);

    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (newEnd > today) {
        window.currentCalorieEndDate = new Date();
    } else {
        window.currentCalorieEndDate = newEnd;
    }

    const nextBtn = document.getElementById('calorie-next');
    if (nextBtn) {
        const isToday = window.isDateToday ? window.isDateToday(window.currentCalorieEndDate) : (window.currentCalorieEndDate >= new Date(new Date().setHours(0,0,0,0)));
        nextBtn.disabled = isToday;
    }

    if (window.updateCalorieRange) {
        await window.updateCalorieRange(window.currentCalorieRange);
    }
};

window.updateCalorieRangeLabel = function () {
    const el = document.getElementById('calorie-range-label');
    if (!el) return;
    const end = window.currentCalorieEndDate ? new Date(window.currentCalorieEndDate) : new Date();
    const range = window.currentCalorieRange || '1w';
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
    if (macrosCanvas) {
        window.destroyChartIfExists(macrosCanvas);
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
    if (!data) return;
    window.lastCalorieData = data;
    const canvasId = 'calorieHistoryChart';
    const oneDayContainer = document.getElementById('calorie-1d-container');
    const range = data.range || window.currentCalorieRange || '1w';
    const history = data.history || [];

    if (range === '1d' && history.length > 0) {
        window.destroyChartIfExists(canvasId);
        window.destroyChartIfExists('calorie-macros-donut');
        renderCalorie1DayView(history[0]);
        const oldCanvas = document.getElementById(canvasId);
        if (oldCanvas) oldCanvas.style.display = 'none';
        if (oneDayContainer) oneDayContainer.style.display = 'block';
        const filterBar = document.getElementById('calorie-filters-bar');
        if (filterBar) filterBar.style.display = 'none';
        return;
    }

    if (oneDayContainer) oneDayContainer.style.display = 'none';
    const filterBar = document.getElementById('calorie-filters-bar');
    if (filterBar) filterBar.style.display = 'flex';

    const filters = getCalorieFilters();
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
            if (isNaN(num)) return null;
            if (cfg.axis === 'y1') y1RawVals.push(num);
            return num;
        });
        datasets.push({
            label: cfg.label + (cfg.unit ? ' (' + cfg.unit + ')' : ''),
            data: vals,
            borderColor: cfg.color,
            backgroundColor: key === 'net_energy' ? cfg.color + '18' : cfg.color + '20',
            borderWidth: key === 'net_energy' ? 3.5 : 2,
            tension: 0.3,
            spanGaps: true,
            pointRadius: history.length <= 31 ? 3 : 0,
            yAxisID: cfg.axis || 'y',
            fill: key === 'net_energy' ? 'origin' : false
        });
    });

    const y1Max = (y1RawVals.length && isFinite(Math.max(...y1RawVals))) ? Math.max(...y1RawVals) * 1.1 : 100;
    const y1Min = (y1RawVals.length && isFinite(Math.min(...y1RawVals))) ? Math.min(...y1RawVals) : 0;
    const y1MinVal = isFinite(y1Min) ? Math.max(0, y1Min - (y1Max - y1Min) * 0.1) : 0;
    const y1MaxVal = (isFinite(y1Max) && y1Max > y1Min) ? y1Max : ((isFinite(y1Min) ? y1Min : 0) + 10);
    const y1Title = y1Metrics.length === 1 ? (CALORIE_METRIC_CONFIG[y1Metrics[0]]?.label || 'Secondary') : 'Secondary Unit';

    // If chart instance already exists on this canvas, update in-place without DOM/context recreation
    const existingChart = chartInstances[canvasId];
    const canvasEl = document.getElementById(canvasId);
    if (existingChart && canvasEl && existingChart.canvas === canvasEl) {
        canvasEl.style.display = 'block';
        existingChart.data.labels = labels;
        existingChart.data.datasets = datasets;
        if (existingChart.options && existingChart.options.scales && existingChart.options.scales.y1) {
            existingChart.options.scales.y1.display = y1Metrics.length > 0;
            existingChart.options.scales.y1.min = y1MinVal;
            existingChart.options.scales.y1.max = y1MaxVal;
            if (existingChart.options.scales.y1.title) {
                existingChart.options.scales.y1.title.display = y1Metrics.length > 0;
                existingChart.options.scales.y1.title.text = y1Title;
            }
        }
        existingChart.update();
        return;
    }

    const canvas = window.getCleanCanvas(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

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
                            if (!items || !items.length) return '';
                            const rawLabel = items[0].label;
                            if (!rawLabel) return '';
                            try {
                                const parsed = window.parseLocalDate ? window.parseLocalDate(rawLabel) : new Date(rawLabel);
                                if (parsed && !isNaN(parsed.getTime())) {
                                    return parsed.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                                }
                            } catch (e) {}
                            return String(rawLabel);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: 10,
                        callback: function (val, index) {
                            const raw = this.getLabelForValue ? this.getLabelForValue(val) : (labels[val] || labels[index] || '');
                            if (!raw || typeof raw !== 'string') return '';
                            const p = raw.split('-');
                            return p.length >= 3 ? `${p[1]}/${p[2]}` : raw;
                        }
                    }
                },
                y: {
                    position: 'left',
                    title: { display: true, text: 'kcal', color: '#94a3b8' },
                    grid: {
                        color: (c) => (c && c.tick && c.tick.value === 0) ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.05)',
                        lineWidth: (c) => (c && c.tick && c.tick.value === 0) ? 2 : 1
                    },
                    ticks: { color: '#94a3b8' }
                },
                y1: {
                    position: 'right',
                    display: y1Metrics.length > 0,
                    min: isFinite(y1Min) ? Math.max(0, y1Min - (y1Max - y1Min) * 0.1) : 0,
                    max: (isFinite(y1Max) && y1Max > y1Min) ? y1Max : ((isFinite(y1Min) ? y1Min : 0) + 10),
                    title: { display: y1Metrics.length > 0, text: y1Metrics.length === 1 ? (CALORIE_METRIC_CONFIG[y1Metrics[0]]?.label || 'Secondary') : 'Secondary Unit', color: '#818cf8' },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#818cf8' }
                }
            }
        }
    });

    requestAnimationFrame(() => {
        if (chartInstances[canvasId]) chartInstances[canvasId].resize();
    });
};

window.updateStepsRange = async function (range, btn) {
    if (range) window.currentStepsRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const targetRange = window.currentStepsRange || '1w';
    const targetEndDate = window.currentStepsEndDate || new Date();
    window.updateMetricDatePill('steps', targetRange, targetEndDate);
    const url = `/api/steps_history?range=${targetRange}&end_date=${getLocalDateStr(targetEndDate)}`;
    await window.fetchAndRenderMetric('steps', targetRange, targetEndDate, url, 'stepsHistoryChart', renderStepsVisual);
};

window.renderStepsVisual = function (data) {
    const canvasId = 'stepsHistoryChart';
    const donutContainer = document.getElementById('steps-donut-container');
    const streakEl = document.getElementById('steps-streak');
    if (streakEl) streakEl.textContent = data.streak || 0;
    safeSetText('steps-drilldown-streak', `${data.streak || 0} days`);
    window.updateMetricDatePill('steps', window.currentStepsRange, window.currentStepsEndDate);

    const history = data.history || [];

    if (window.currentStepsRange === '1d') {
        window.destroyChartIfExists(canvasId);
        const oldCanvas = document.getElementById(canvasId);
        if (oldCanvas) oldCanvas.style.display = 'none';
        if (donutContainer) donutContainer.style.display = 'flex';

        const day = history[history.length - 1] || { totalSteps: 0, stepGoal: 10000 };
        const percent = Math.min(100, Math.round((day.totalSteps / (day.stepGoal || 10000)) * 100));
        safeSetText('steps', day.totalSteps.toLocaleString());
        safeSetText('steps-goal-text', '/ ' + (day.stepGoal >= 1000 ? (day.stepGoal / 1000) + 'k' : day.stepGoal));
        safeSetText('steps-day-percent', percent + '%');
        safeSetText('steps-drilldown-avg', day.totalSteps.toLocaleString());
        safeSetText('steps-drilldown-dist', `${(day.totalSteps * 0.000473).toFixed(2)} mi`);
        safeSetText('steps-drilldown-cal', `${Math.round(day.totalSteps * 0.04)} kcal`);

        const chart = document.getElementById('steps-day-chart');
        if (chart) chart.style.background = `conic-gradient(${percent >= 100 ? 'var(--success-color)' : 'var(--accent-color)'} 0% ${percent}%, rgba(255,255,255,0.1) ${percent}% 100%)`;
    } else {
        if (donutContainer) donutContainer.style.display = 'none';
        const canvas = window.getCleanCanvas(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const validDays = history.filter(d => d.totalSteps > 0);
        const avg = validDays.length > 0 ? Math.round(validDays.reduce((sum, d) => sum + d.totalSteps, 0) / validDays.length) : 0;
        safeSetText('steps-drilldown-avg', avg.toLocaleString());
        safeSetText('steps-drilldown-dist', `${(avg * 0.000473).toFixed(2)} mi/day`);
        safeSetText('steps-drilldown-cal', `${Math.round(avg * 0.04)} kcal/day`);

        chartInstances[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: history.map(d => { const p = (d.calendarDate || d.date || '').split('-'); return p.length >= 3 ? `${p[1]}/${p[2]}` : d.calendarDate; }),
                datasets: [{ label: 'Steps', data: history.map(d => d.totalSteps), backgroundColor: history.map(d => d.totalSteps >= (d.stepGoal || 10000) ? '#4ade80' : '#38bdf8'), borderRadius: history.length > 100 ? 0 : 4, barPercentage: history.length > 100 ? 0.7 : 0.5 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, mode: 'x' } } }, scales: { x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 12 } }, y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } } } }
        });
    }
}

window.updateHRRange = async function (range, btn) {
    if (range) window.currentHRRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const targetRange = window.currentHRRange || '1w';
    const targetEndDate = window.currentHREndDate || new Date();
    window.updateMetricDatePill('hr', targetRange, targetEndDate);
    const url = `/api/hr_history?range=${targetRange}&end_date=${getLocalDateStr(targetEndDate)}`;
    await window.fetchAndRenderMetric('hr', targetRange, targetEndDate, url, 'hrHistoryChart', renderHRVisual);
};

window.renderHRVisual = function (data) {
    try {
        const canvasId = 'hrHistoryChart';
        const canvas = window.getCleanCanvas(canvasId);
        if (!canvas) return;

        const range = data.range || window.currentHRRange || '1d';
        window.updateMetricDatePill('hr', range, window.currentHREndDate);

        if (range === '1d') {
            const summary = data.summary || {};
            const dailyMax = parseInt(summary.max) || 0;
            const dailyRhr = parseInt(summary.rhr) || 0;
            const dailyMin = parseInt(summary.min) || 0;
            const zones = data.zones || [95, 114, 133, 152, 171];
            safeSetText('hr-max-val', 'Max: ' + (dailyMax || '--'));
            safeSetText('hr-drilldown-avg-label', 'Resting HR');
            safeSetText('hr-drilldown-current', (dailyRhr || '--') + ' bpm');
            safeSetText('hr-drilldown-7d', (dailyRhr || '--') + ' bpm');
            safeSetText('hr-drilldown-max', (dailyMax || '--') + ' bpm');
            safeSetText('hr-drilldown-min', (dailyMin || '--') + ' bpm');

            const rawSamples = data.samples || [];
            const points = rawSamples
                .filter(s => Array.isArray(s) && s[0] != null && s[1] != null)
                .map(s => ({ x: s[0], y: s[1] }));
            const getZoneColor = (hr) => {
                if (hr == null) return '#38bdf8';
                if (hr >= zones[4]) return '#a855f7';
                if (hr >= zones[3]) return '#ef4444';
                if (hr >= zones[2]) return '#f97316';
                if (hr >= zones[1]) return '#22c55e';
                if (hr >= zones[0]) return '#38bdf8';
                return '#94a3b8';
            };
            const minY = points.length > 0 ? Math.max(30, Math.min(...points.map(p => p.y)) - 5) : 40;
            const maxY = points.length > 0 ? Math.max(dailyMax || 120, Math.max(...points.map(p => p.y)) + 5) : 120;
            chartInstances[canvasId] = new Chart(canvas, {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'HR',
                        data: points,
                        borderColor: '#38bdf8',
                        borderWidth: 2,
                        pointRadius: 0,
                        spanGaps: true,
                        segment: {
                            borderColor: ctx => getZoneColor(ctx.p1?.parsed?.y ?? ctx.p0?.parsed?.y)
                        },
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: (items) => {
                                    if (!items.length) return '';
                                    const d = new Date(items[0].parsed.x);
                                    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                },
                                label: (ctx) => 'Heart Rate: ' + ctx.parsed.y + ' bpm'
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'time',
                            time: { displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } },
                            grid: { display: false },
                            ticks: { color: '#94a3b8', maxTicksLimit: 8 }
                        },
                        y: {
                            min: minY,
                            max: maxY,
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            ticks: { color: '#94a3b8' }
                        }
                    }
                }
            });
        } else {
            const history = data.history || [];
            const validRhr = history.map(d => d.rhr).filter(v => typeof v === 'number' && v > 0);
            const avgRhr = validRhr.length > 0 ? Math.round(validRhr.reduce((a, b) => a + b, 0) / validRhr.length) : '--';
            const maxRecorded = Math.max(0, ...history.map(d => d.max || 0));
            const minRecorded = Math.min(...history.map(d => d.min || 999).filter(v => v < 999));
            const currentRhr = history.length > 0 ? (history[history.length - 1].rhr || '--') : '--';

            const avgLabel = range === '1m' ? '4-Week Avg RHR' : (range === '1y' ? '1-Year Avg RHR' : '7-Day Avg RHR');
            safeSetText('hr-drilldown-avg-label', avgLabel);
            safeSetText('hr-drilldown-current', currentRhr + ' bpm');
            safeSetText('hr-drilldown-7d', avgRhr + ' bpm');
            safeSetText('hr-drilldown-max', (maxRecorded > 0 ? maxRecorded : '--') + ' bpm');
            safeSetText('hr-drilldown-min', (minRecorded < 999 ? minRecorded : '--') + ' bpm');

            const isLong = history.length > 35;
            const labels = history.map(d => {
                if (!d.date) return '';
                const p = d.date.split('-');
                return p.length >= 3 ? (p[1] + '/' + p[2]) : d.date;
            });
            chartInstances[canvasId] = new Chart(canvas, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Resting',
                            data: history.map(d => (typeof d.rhr === 'number' && d.rhr > 0) ? d.rhr : null),
                            borderColor: '#38bdf8',
                            backgroundColor: 'rgba(56, 189, 248, 0.1)',
                            borderWidth: isLong ? 2 : 3,
                            pointRadius: isLong ? 0 : 3,
                            pointHoverRadius: 5,
                            tension: 0.3,
                            spanGaps: true,
                            fill: false
                        },
                        {
                            label: 'Max',
                            data: history.map(d => (typeof d.max === 'number' && d.max > 0) ? d.max : null),
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderWidth: isLong ? 1.5 : 2,
                            pointRadius: isLong ? 0 : 3,
                            pointHoverRadius: 5,
                            tension: 0.3,
                            spanGaps: true,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, labels: { color: '#94a3b8' } },
                        zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 12 } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                    }
                }
            });
        }
    } catch (err) {
        console.error('Error in renderHRVisual:', err);
    }
};


window.updateStressRange = async function (range, btn) {
    if (range) window.currentStressRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const targetRange = window.currentStressRange || '1w';
    const targetEndDate = window.currentStressEndDate || new Date();
    window.updateMetricDatePill('stress', targetRange, targetEndDate);
    const url = `/api/stress_history?range=${targetRange}&end_date=${getLocalDateStr(targetEndDate)}`;
    await window.fetchAndRenderMetric('stress', targetRange, targetEndDate, url, 'stressHistoryChart', renderStressVisual);
};

window.renderStressVisual = function (data) {
    const canvasId = 'stressHistoryChart';
    const canvas = window.getCleanCanvas(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const range = data.range || window.currentStressRange || '1d';
    window.updateMetricDatePill('stress', range, window.currentStressEndDate);

    if (range === '1d') {
        const summary = data.summary || {};
        const avg = summary.avg || '--';
        safeSetText('stress', avg);
        safeSetText('stress-drilldown-avg', avg);

        const rawSamples = data.samples || [];
        const points = rawSamples
            .filter(s => Array.isArray(s) && s[0] != null && s[1] != null && s[1] >= 0)
            .map(s => ({ x: s[0], y: s[1] }));

        const totalSamplePts = points.length || 1;
        const restPts = points.filter(p => p.y < 25).length;
        const lowPts = points.filter(p => p.y >= 25 && p.y < 50).length;
        const highPts = points.filter(p => p.y >= 50).length;
        const totalLoggedHrs = (totalSamplePts * 3) / 60;
        safeSetText('stress-drilldown-rest', `${((restPts / totalSamplePts) * totalLoggedHrs).toFixed(1)} hrs`);
        safeSetText('stress-drilldown-low', `${((lowPts / totalSamplePts) * totalLoggedHrs).toFixed(1)} hrs`);
        safeSetText('stress-drilldown-high', `${((highPts / totalSamplePts) * totalLoggedHrs).toFixed(1)} hrs`);

        const getStressColor = (v) => {
            if (v == null) return '#94a3b8';
            if (v < 25) return '#38bdf8';
            if (v < 50) return '#f59e0b';
            if (v < 75) return '#f97316';
            return '#ef4444';
        };
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Stress',
                    data: points,
                    borderColor: '#f97316',
                    borderWidth: 2,
                    pointRadius: 0,
                    spanGaps: true,
                    segment: {
                        borderColor: ctx => getStressColor(ctx.p1?.parsed?.y ?? ctx.p0?.parsed?.y)
                    },
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const d = new Date(items[0].parsed.x);
                                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            },
                            label: (ctx) => `Stress: ${ctx.parsed.y}`
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } },
                        grid: { display: false },
                        ticks: { color: '#94a3b8', maxTicksLimit: 8 }
                    },
                    y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    } else {
        const history = data.history || [];
        const validStress = history.map(d => d.avg).filter(v => typeof v === 'number' && v > 0);
        const avgStress = validStress.length > 0 ? Math.round(validStress.reduce((a, b) => a + b, 0) / validStress.length) : '--';
        safeSetText('stress-drilldown-avg', avgStress);
        safeSetText('stress-drilldown-rest', 'Normal');
        safeSetText('stress-drilldown-low', 'Moderate');
        safeSetText('stress-drilldown-high', 'Occasional');

        const labels = history.map(d => {
            if (!d.date) return '';
            const p = d.date.split('-');
            return p[1] ? p[1] + '/' + p[2] : d.date;
        });
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Avg',
                    data: history.map(d => d.avg),
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                    y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }
}

window.currentSleepRange = window.currentSleepRange || '1w';
window.currentSleepEndDate = window.currentSleepEndDate || new Date();
window.currentSleep1dSubView = window.currentSleep1dSubView || 'timeline';
window.currentSleepTrendView = window.currentSleepTrendView || 'score';
window.lastSleepData = null;

function formatSleepSec(sec) {
    if (!sec || sec <= 0) return '0m';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function getSleepQualifierBadge(qualifierKey) {
    if (!qualifierKey) return '<span class="sleep-rating-badge sleep-rating-good">Good</span>';
    const key = String(qualifierKey).toUpperCase();
    if (key.includes('EXCELLENT')) {
        return '<span class="sleep-rating-badge sleep-rating-excellent">Excellent</span>';
    } else if (key.includes('GOOD')) {
        return '<span class="sleep-rating-badge sleep-rating-good">Good</span>';
    } else if (key.includes('FAIR')) {
        return '<span class="sleep-rating-badge sleep-rating-fair">Fair</span>';
    } else if (key.includes('POOR')) {
        return '<span class="sleep-rating-badge sleep-rating-poor">Poor</span>';
    }
    return `<span class="sleep-rating-badge sleep-rating-good">${qualifierKey}</span>`;
}

function formatFeedbackTitle(feedback) {
    if (!feedback) return 'Continuous';
    let clean = feedback.replace(/^POSITIVE_|^NEGATIVE_|^NEUTRAL_/, '').replace(/_/g, ' ').toLowerCase();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function formatSleepInsight(s) {
    const rawKey = s.personalizedInsight || s.insight;
    const insightMap = {
        'HARD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_HARD_TO_STRENUOUS_DURING_DAY_OUTDOOR':
            'Your outdoor activity earlier in the day promoted good sleep. Daylight activity especially helps to sync your body clock and deepen restorative sleep.',
        'HARD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_HARD_TO_STRENUOUS_DURING_DAY':
            'Your strenuous workout earlier in the day helped deepen your sleep and promoted restorative physical recovery.',
        'HARD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_MODERATE_DURING_DAY_OUTDOOR':
            'Outdoor activity yesterday helped synchronize your circadian rhythm and supported restful sleep.',
        'HARD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_MODERATE_DURING_DAY':
            'Your daytime physical activity helped promote healthy sleep architecture and deep rest.',
        'REGULAR_RHYTHM_POS':
            'Your consistent sleep timing is reinforcing your natural circadian rhythms for optimal recovery.',
        'RESTFUL_EVENING_POS':
            'A restful and low-stress evening promoted smooth sleep onset and continuous rest.',
        'POSITIVE_LONG_AND_CONTINUOUS':
            'You had long and continuous sleep with minimal interruptions, allowing optimal physical and mental recharge.'
    };

    if (rawKey && insightMap[rawKey]) {
        return insightMap[rawKey];
    }

    if (rawKey && typeof rawKey === 'string' && rawKey !== 'NONE') {
        const k = rawKey.toUpperCase();
        if (k.includes('HARD_EXERCISE') || k.includes('STRENUOUS') || k.includes('OUTDOOR')) {
            return 'Your daytime physical activity helped promote deep, restorative recovery sleep.';
        }
        if (k.includes('RHYTHM') || k.includes('SCHEDULE')) {
            return 'Keeping a consistent sleep and wake routine supports quality restorative sleep.';
        }
        if (k.includes('RESTFUL') || k.includes('EVENING')) {
            return 'A calm evening with lower stress helped maintain restful and continuous sleep.';
        }
        if (k.includes('SHORT')) {
            return 'Your sleep duration was shorter than optimal. An earlier bedtime tonight will help restore balance.';
        }
        if (k.includes('RESTLESS') || k.includes('STRESS')) {
            return 'Restlessness or higher stress was detected during sleep. Winding down before bed can help.';
        }
    }

    const totalSec = s.total || 0;
    const hrs = (totalSec / 3600).toFixed(1);
    if (totalSec >= 27000) {
        return `You had long and continuous sleep with ${hrs} hours. Balanced deep and REM cycles promoted physical recovery and mental focus.`;
    } else if (totalSec >= 21600) {
        return `You got ${hrs} hours of sleep. Consistent sleep timing can help optimize your REM and deep restorative stages.`;
    } else {
        return `Short sleep duration of ${hrs} hours recorded. Consider prioritizing an earlier bedtime tonight to support immune and physical recovery.`;
    }
}

window.shiftSleepDate = async function (dir) {
    if (!window.currentSleepEndDate) window.currentSleepEndDate = new Date();
    const range = window.currentSleepRange || '1w';
    let daysToShift = 7;
    if (range === '1d') daysToShift = 1;
    else if (range === '1w') daysToShift = 7;
    else if (range === '1m') daysToShift = 30;
    else if (range === '1y') daysToShift = 365;

    const newEnd = new Date(window.currentSleepEndDate);
    newEnd.setDate(newEnd.getDate() + dir * daysToShift);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkEnd = new Date(newEnd);
    checkEnd.setHours(0, 0, 0, 0);

    if (checkEnd > today) {
        window.currentSleepEndDate = new Date();
    } else {
        window.currentSleepEndDate = newEnd;
    }

    const nextBtn = document.getElementById('sleep-next');
    if (nextBtn) {
        const atToday = checkEnd >= today;
        nextBtn.disabled = atToday;
        nextBtn.style.opacity = atToday ? '0.4' : '1';
    }

    await window.updateSleepRange(window.currentSleepRange);
};

window.setSleep1dView = function (view, btn) {
    window.currentSleep1dSubView = view;
    if (btn) {
        const parent = btn.parentElement;
        if (parent) parent.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const timelineEl = document.getElementById('sleep-subview-timeline');
    const stagesEl = document.getElementById('sleep-subview-stages');
    if (timelineEl) timelineEl.style.display = view === 'timeline' ? 'block' : 'none';
    if (stagesEl) stagesEl.style.display = view === 'stages' ? 'block' : 'none';

    if (window.lastSleepData && (window.lastSleepData.range === '1d' || window.lastSleepData.summary)) {
        const s = window.lastSleepData.summary || {};
        if (view === 'timeline') {
            renderSleep1dTimeline(s);
        } else {
            renderSleep1dStages(s);
        }
    }
};

window.setSleepTrendView = function (view, btn) {
    window.currentSleepTrendView = view;
    if (btn) {
        const parent = btn.parentElement;
        if (parent) parent.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const titleEl = document.getElementById('sleep-trends-title');
    if (titleEl) {
        titleEl.textContent = view === 'score' ? 'Sleep Score Trend' : 'Sleep Duration Trend';
    }
    if (window.lastSleepData && window.lastSleepData.history) {
        renderSleepTrendChart(window.lastSleepData.history, window.lastSleepData.summary || {}, view, window.lastSleepData.range);
    }
};

window.updateSleepRange = async function (range, btn) {
    if (range) window.currentSleepRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const targetRange = window.currentSleepRange || '1w';
    const targetEndDate = window.currentSleepEndDate || new Date();
    window.updateMetricDatePill('sleep', targetRange, targetEndDate);

    const nextBtn = document.getElementById('sleep-next');
    if (nextBtn) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkEnd = new Date(targetEndDate);
        checkEnd.setHours(0, 0, 0, 0);
        const atToday = checkEnd >= today;
        nextBtn.disabled = atToday;
        nextBtn.style.opacity = atToday ? '0.4' : '1';
    }

    const url = `/api/sleep_history?range=${targetRange}&end_date=${getLocalDateStr(targetEndDate)}`;
    await window.fetchAndRenderMetric('sleep', targetRange, targetEndDate, url, 'modal-pane-sleep', (data) => {
        data.range = targetRange;
        renderSleepVisual(data);
    });
};

window.renderSleepVisual = function (data) {
    if (!data) return;
    window.lastSleepData = data;
    const range = data.range || window.currentSleepRange || '1d';
    window.updateMetricDatePill('sleep', range, window.currentSleepEndDate);

    const container1d = document.getElementById('sleep-1d-container');
    const containerMulti = document.getElementById('sleep-multi-container');

    if (range === '1d') {
        if (container1d) container1d.style.display = 'block';
        if (containerMulti) containerMulti.style.display = 'none';
        const s = data.summary || {};
        renderSleep1dView(s);
    } else {
        if (container1d) container1d.style.display = 'none';
        if (containerMulti) containerMulti.style.display = 'block';
        const history = data.history || [];
        const summary = data.summary || {};
        renderSleepMultiView(history, summary, range);
    }
};

function renderSleep1dView(s) {
    const scoreVal = s.score != null ? s.score : '--';
    safeSetText('sleep-1d-score-val', scoreVal);
    safeSetText('sleep-score-val', scoreVal);

    // Score Quality Qualifier
    let quality = 'Good';
    if (s.sleepScores && s.sleepScores.overall && s.sleepScores.overall.qualifierKey) {
        const qk = s.sleepScores.overall.qualifierKey.toUpperCase();
        quality = qk.charAt(0) + qk.slice(1).toLowerCase();
    } else if (typeof s.score === 'number') {
        if (s.score >= 90) quality = 'Excellent';
        else if (s.score >= 80) quality = 'Good';
        else if (s.score >= 70) quality = 'Fair';
        else quality = 'Poor';
    }
    safeSetText('sleep-1d-quality', quality);

    const durStr = formatSleepSec(s.total);
    safeSetText('sleep-1d-duration', durStr);
    safeSetText('sleep', durStr);

    safeSetText('sleep-1d-feedback-title', formatFeedbackTitle(s.feedback));
    safeSetText('sleep-1d-feedback-body', formatSleepInsight(s));

    // Bed & Wake Times
    const bTime = s.bedTime || '--';
    const wTime = s.wakeTime || '--';
    safeSetText('sleep-1d-bedtime', bTime);
    safeSetText('sleep-1d-waketime', wTime);
    safeSetText('sleep-start-time', bTime);
    safeSetText('sleep-end-time', wTime);

    // Populate Factors List
    const factorsListEl = document.getElementById('sleep-factors-list');
    if (factorsListEl) {
        const scores = s.sleepScores || {};
        const factors = [
            {
                name: 'Duration',
                value: formatSleepSec(s.total),
                badge: getSleepQualifierBadge(scores.totalDuration?.qualifierKey || (s.total >= 25200 ? 'EXCELLENT' : (s.total >= 21600 ? 'GOOD' : 'FAIR')))
            },
            {
                name: 'Stress',
                value: s.avgStress ? `${Math.round(s.avgStress)} avg` : '-- avg',
                badge: getSleepQualifierBadge(scores.stress?.qualifierKey || (s.avgStress && s.avgStress <= 15 ? 'GOOD' : 'FAIR'))
            },
            {
                name: 'Deep',
                value: formatSleepSec(s.deep),
                badge: getSleepQualifierBadge(scores.deepPercentage?.qualifierKey || (s.deep >= 3600 ? 'GOOD' : 'FAIR'))
            },
            {
                name: 'Light',
                value: formatSleepSec(s.light),
                badge: getSleepQualifierBadge(scores.lightPercentage?.qualifierKey || 'GOOD')
            },
            {
                name: 'REM',
                value: formatSleepSec(s.rem),
                badge: getSleepQualifierBadge(scores.remPercentage?.qualifierKey || (s.rem >= 3600 ? 'GOOD' : 'FAIR'))
            },
            {
                name: 'Awake/Restlessness',
                value: `${formatSleepSec(s.awake)}${s.restlessMoments ? ' • ' + s.restlessMoments + ' Restless Moments' : ''}`,
                badge: getSleepQualifierBadge(scores.awakeCount?.qualifierKey || scores.restlessness?.qualifierKey || 'EXCELLENT')
            }
        ];

        factorsListEl.innerHTML = factors.map(f => `
            <div class="sleep-factor-row">
                <div>
                    <div class="sleep-factor-title">${f.name}</div>
                    <div class="sleep-factor-sub">${f.value}</div>
                </div>
                <div>${f.badge}</div>
            </div>
        `).join('');
    }

    // Render Subview
    if (window.currentSleep1dSubView === 'timeline') {
        renderSleep1dTimeline(s);
    } else {
        renderSleep1dStages(s);
    }
}

function renderSleep1dTimeline(s) {
    const canvas = document.getElementById('sleep1dTimelineCanvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    const width = parent.clientWidth || 700;
    const height = 280;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const leftMargin = 65;
    const rightMargin = 25;
    const topMargin = 20;
    const bottomMargin = 65;
    const plotWidth = width - leftMargin - rightMargin;
    const plotHeight = height - topMargin - bottomMargin;

    // Y levels (Awake: 3, REM: 2, Light: 1, Deep: 0)
    const stageY = {
        3: topMargin + 10,
        2: topMargin + plotHeight * 0.32,
        1: topMargin + plotHeight * 0.64,
        0: topMargin + plotHeight * 0.90
    };
    const baselineY = topMargin + plotHeight;

    // Draw horizontal dashed grid lines & Y labels
    const stageLabels = [
        { label: 'Awake', y: stageY[3] },
        { label: 'REM', y: stageY[2] },
        { label: 'Light', y: stageY[1] },
        { label: 'Deep', y: stageY[0] }
    ];

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '12px Inter, sans-serif';

    stageLabels.forEach(sl => {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(sl.label, leftMargin - 14, sl.y);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(leftMargin, sl.y);
        ctx.lineTo(width - rightMargin, sl.y);
        ctx.stroke();
    });

    // Draw outer boundary dashed lines matching Garmin Connect
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(leftMargin, stageY[3] - 5);
    ctx.lineTo(leftMargin, baselineY);
    ctx.moveTo(width - rightMargin, stageY[3] - 5);
    ctx.lineTo(width - rightMargin, baselineY);
    ctx.stroke();
    ctx.setLineDash([]);

    let levels = s.sleepLevels || [];
    const totalSec = s.total || 0;

    // If no epoch levels, synthesize stages proportionally anchoring to bed time
    if (!levels || levels.length === 0) {
        if (totalSec > 0) {
            const synth = [
                { act: 1, dur: (s.light || 0) * 0.3 || (totalSec * 0.2) },
                { act: 0, dur: (s.deep || 0) || (totalSec * 0.15) },
                { act: 1, dur: (s.light || 0) * 0.4 || (totalSec * 0.25) },
                { act: 2, dur: (s.rem || 0) || (totalSec * 0.2) },
                { act: 3, dur: (s.awake || 0) || 300 },
                { act: 1, dur: (s.light || 0) * 0.3 || (totalSec * 0.15) }
            ];
            levels = [];
            synth.forEach(item => {
                if (item.dur > 0) {
                    levels.push({
                        activityLevel: item.act,
                        duration: item.dur
                    });
                }
            });
        }
    }

    if (!levels || levels.length === 0) {
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText('No sleep stage epochs recorded for this date', width / 2, height / 2);
        return;
    }

    const totalDuration = levels.reduce((sum, lvl) => sum + (lvl.duration || 0), 0) || totalSec || 31380;
    if (totalDuration <= 0) return;

    // Colors matching Garmin Connect exactly
    const stageColors = {
        0: '#1d4ed8', // Deep (dark blue)
        1: '#38bdf8', // Light (sky blue)
        2: '#c026d3', // REM (magenta/purple)
        3: '#f43f5e'  // Awake (bright pink)
    };

    // Draw stepped bar chart using relative second accumulation
    let curSec = 0;
    levels.forEach(lvl => {
        const dur = lvl.duration || 0;
        const xStart = leftMargin + (curSec / totalDuration) * plotWidth;
        const xEnd = leftMargin + ((curSec + dur) / totalDuration) * plotWidth;
        const barW = Math.max(1.5, xEnd - xStart);
        const act = lvl.activityLevel != null ? lvl.activityLevel : 1;
        const color = stageColors[act] || stageColors[1];
        const barY = stageY[act] || stageY[1];
        const barH = baselineY - barY;

        ctx.fillStyle = color;
        if (act === 3) {
            // Awake: thin vertical pink spike extending to top Awake level
            ctx.fillRect(xStart, stageY[3], Math.max(2, Math.min(barW, 3)), baselineY - stageY[3]);
        } else {
            ctx.fillRect(xStart, barY, barW + 0.5, barH);
        }
        curSec += dur;
    });

    // Draw solid baseline line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftMargin, baselineY);
    ctx.lineTo(width - rightMargin, baselineY);
    ctx.stroke();

    // Corner badges matching Garmin (sleep moon at start, alarm at end)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(leftMargin, baselineY, 7.5, 0, Math.PI * 2);
    ctx.arc(width - rightMargin, baselineY, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.stroke();

    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('💤', leftMargin, baselineY);
    ctx.fillText('⏰', width - rightMargin, baselineY);

    // Calculate hourly and 30-minute ticks matching Garmin
    let bHour = 22, bMin = 12;
    if (s.bedTime && s.bedTime !== '--') {
        const parts = s.bedTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (parts) {
            bHour = parseInt(parts[1], 10);
            bMin = parseInt(parts[2], 10);
            if (parts[3] && parts[3].toUpperCase() === 'PM' && bHour < 12) bHour += 12;
            if (parts[3] && parts[3].toUpperCase() === 'AM' && bHour === 12) bHour = 0;
        }
    }

    const minToNext30 = (30 - (bMin % 30)) % 30 || 30;
    let tickSec = minToNext30 * 60;

    while (tickSec <= totalDuration - 60) {
        const xTick = leftMargin + (tickSec / totalDuration) * plotWidth;
        if (xTick >= leftMargin + 10 && xTick <= width - rightMargin - 10) {
            const totalMinFromStart = bMin + Math.round(tickSec / 60);
            const tickHour = (bHour + Math.floor(totalMinFromStart / 60)) % 24;
            const tickMin = totalMinFromStart % 60;

            if (tickMin === 0 && tickHour % 2 === 0) {
                // Even hour: large dot + label
                ctx.fillStyle = '#cbd5e1';
                ctx.beginPath();
                ctx.arc(xTick, baselineY + 8, 3.5, 0, Math.PI * 2);
                ctx.fill();

                const dispH = tickHour === 0 ? '12a' : (tickHour === 12 ? '12p' : (tickHour > 12 ? (tickHour - 12) + 'p' : tickHour + 'a'));
                ctx.fillStyle = '#94a3b8';
                ctx.font = '11px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(dispH, xTick, baselineY + 18);
            } else {
                // 30-min mark or odd hour: small dot
                ctx.fillStyle = '#475569';
                ctx.beginPath();
                ctx.arc(xTick, baselineY + 8, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        tickSec += 1800; // 30 minutes
    }

    // 4-Color Legend matching Garmin Connect
    const legendY = baselineY + 44;
    const legendItems = [
        { label: 'Deep', color: '#1d4ed8' },
        { label: 'Light', color: '#38bdf8' },
        { label: 'REM', color: '#c026d3' },
        { label: 'Awake', color: '#f43f5e' }
    ];
    const itemWidth = 72;
    let legX = (width - legendItems.length * itemWidth) / 2 + 10;
    legendItems.forEach(item => {
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(legX, legendY, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#cbd5e1';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, legX + 10, legendY);
        legX += itemWidth;
    });
}

function renderSleep1dStages(s) {
    const canvasId = 'sleep1dStagesChart';
    const canvas = window.getCleanCanvas(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const deep = s.deep || 0;
    const light = s.light || 0;
    const rem = s.rem || 0;
    const awake = s.awake || 0;
    const total = deep + light + rem + awake;

    safeSetText('sleep-doughnut-total', formatSleepSec(s.total || total));

    const stageData = [
        { label: 'Deep', value: deep, color: '#1d4ed8' },
        { label: 'Light', value: light, color: '#38bdf8' },
        { label: 'REM', value: rem, color: '#c084fc' },
        { label: 'Awake', value: awake, color: '#fb7185' }
    ].filter(d => d.value > 0);

    const displayData = stageData.length > 0 ? stageData : [{ label: 'No Data', value: 1, color: 'rgba(255,255,255,0.06)' }];

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: displayData.map(d => d.label),
            datasets: [{
                data: displayData.map(d => d.value),
                backgroundColor: displayData.map(d => d.color),
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (c) {
                            if (displayData[0]?.label === 'No Data') return 'No sleep stage data';
                            const sec = c.parsed;
                            return ` ${c.label}: ${formatSleepSec(sec)} (${total > 0 ? Math.round((sec / total) * 100) : 0}%)`;
                        }
                    }
                }
            }
        }
    });

    // Populate stage cards below doughnut
    const cardsEl = document.getElementById('sleep-stages-breakdown-cards');
    if (cardsEl) {
        const safeTotal = total > 0 ? total : 1;
        const stagesList = [
            { label: 'Deep', sec: deep, color: '#1d4ed8' },
            { label: 'Light', sec: light, color: '#38bdf8' },
            { label: 'REM', sec: rem, color: '#c084fc' },
            { label: 'Awake', sec: awake, color: '#fb7185' }
        ];

        cardsEl.innerHTML = stagesList.map(st => `
            <div class="sleep-stage-card">
                <div class="sleep-stage-card-label">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${st.color};"></span>
                    <span>${st.label}</span>
                </div>
                <div class="sleep-stage-card-val">${formatSleepSec(st.sec)}</div>
                <div class="sleep-stage-card-pct">${Math.round((st.sec / safeTotal) * 100)}%</div>
            </div>
        `).join('');
    }
}

function renderSleepMultiView(history, summary, range) {
    // 1. Summary Cards
    const avgScore = summary.avgScore != null ? summary.avgScore : '--';
    const avgDurStr = summary.avgTotal ? formatSleepSec(summary.avgTotal) : '--';
    safeSetText('sleep-drilldown-score', avgScore);
    safeSetText('sleep-drilldown-duration', avgDurStr);
    safeSetText('sleep-drilldown-avg-bed', summary.avgBedTime || '--');
    safeSetText('sleep-drilldown-avg-wake', summary.avgWakeTime || '--');

    // 2. Render Sleep Consistency Chart
    renderSleepConsistencyChart(history, summary, range);

    // 3. Render Sleep Trends Chart
    renderSleepTrendChart(history, summary, window.currentSleepTrendView || 'score', range);

    // 4. Ensure charts fit layout dimensions if container was just switched
    requestAnimationFrame(() => {
        if (chartInstances['sleepConsistencyChart']) chartInstances['sleepConsistencyChart'].resize();
        if (chartInstances['sleepTrendChart']) chartInstances['sleepTrendChart'].resize();
    });
}

function renderSleepConsistencyChart(history, summary, range) {
    const canvasId = 'sleepConsistencyChart';
    const canvas = window.getCleanCanvas(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = history.map(d => {
        if (!d.date) return '';
        const parts = d.date.split('-');
        if (range === '1w') {
            const dt = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            return dt.toLocaleDateString('en-US', { weekday: 'short' });
        }
        return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d.date;
    });

    const floatingData = history.map(d => {
        if (d && d.bedHour != null && d.wakeHour != null) {
            return [d.bedHour, d.wakeHour];
        }
        return null;
    });

    let minH = 20.0; // 8 PM default top
    let maxH = 34.0; // 10 AM default bottom

    history.forEach(d => {
        if (d && d.bedHour && d.bedHour < minH) minH = Math.floor(d.bedHour);
        if (d && d.wakeHour && d.wakeHour > maxH) maxH = Math.ceil(d.wakeHour);
    });

    const sleepConsistencyLinesPlugin = {
        id: 'sleepConsistencyLines',
        afterDraw(chart) {
            try {
                if (!chart || !chart.chartArea || !chart.scales || !chart.scales.y) return;
                const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
                ctx.save();

                // Avg Bedtime Solid Line
                if (summary && summary.avgBedHour != null) {
                    const yBed = y.getPixelForValue(summary.avgBedHour);
                    if (yBed >= top && yBed <= bottom) {
                        ctx.strokeStyle = '#cbd5e1';
                        ctx.lineWidth = 2;
                        ctx.setLineDash([]);
                        ctx.beginPath();
                        ctx.moveTo(left, yBed);
                        ctx.lineTo(right, yBed);
                        ctx.stroke();
                    }
                }

                // Avg Wake Time Dashed Line
                if (summary && summary.avgWakeHour != null) {
                    const yWake = y.getPixelForValue(summary.avgWakeHour);
                    if (yWake >= top && yWake <= bottom) {
                        ctx.strokeStyle = '#94a3b8';
                        ctx.lineWidth = 2;
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath();
                        ctx.moveTo(left, yWake);
                        ctx.lineTo(right, yWake);
                        ctx.stroke();
                    }
                }
                ctx.restore();
            } catch (e) {
                console.warn('sleepConsistencyLines error:', e);
            }
        }
    };

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Sleep Times',
                data: floatingData,
                backgroundColor: '#2563eb',
                borderRadius: 4,
                borderSkipped: false,
                barPercentage: range === '1y' ? 0.9 : 0.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            if (!items.length) return '';
                            const idx = items[0].dataIndex;
                            return history[idx]?.date || items[0].label;
                        },
                        label: function (c) {
                            const d = history[c.dataIndex];
                            if (!d) return '';
                            return [
                                ` Bedtime: ${d.bedTime || '--'}`,
                                ` Wake Time: ${d.wakeTime || '--'}`,
                                ` Duration: ${formatSleepSec(d.total)}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', maxTicksLimit: range === '1y' ? 12 : 14 }
                },
                y: {
                    reverse: true,
                    min: minH,
                    max: maxH,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        stepSize: 4,
                        callback: function (val) {
                            const h = val >= 24 ? val - 24 : val;
                            const p = (val >= 12 && val < 24) ? 'p' : 'a';
                            let disp = Math.round(h) % 12;
                            if (disp === 0) disp = 12;
                            return `${disp}${p}`;
                        }
                    }
                }
            }
        },
        plugins: [sleepConsistencyLinesPlugin]
    });
}

function renderSleepTrendChart(history, summary, mode, range) {
    const canvasId = 'sleepTrendChart';
    const canvas = window.getCleanCanvas(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = history.map(d => {
        if (!d.date) return '';
        const parts = d.date.split('-');
        if (range === '1w') {
            const dt = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            return dt.toLocaleDateString('en-US', { weekday: 'short' });
        }
        return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d.date;
    });

    if (mode === 'score') {
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Score',
                    data: history.map(d => d.score),
                    borderColor: '#818cf8',
                    borderWidth: 2.5,
                    tension: 0.25,
                    spanGaps: true,
                    pointRadius: history.length > 35 ? 0 : 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#818cf8',
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (c) {
                                return ` Sleep Score: ${c.parsed.y != null ? c.parsed.y : 'N/A'}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8', maxTicksLimit: range === '1y' ? 12 : 14 }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', stepSize: 25 }
                    }
                }
            }
        });
    } else {
        // Duration Trend: Stacked Bar Chart
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Deep',
                        data: history.map(d => +(d.deep / 3600).toFixed(2)),
                        backgroundColor: '#1d4ed8'
                    },
                    {
                        label: 'Light',
                        data: history.map(d => +(d.light / 3600).toFixed(2)),
                        backgroundColor: '#38bdf8'
                    },
                    {
                        label: 'REM',
                        data: history.map(d => +(d.rem / 3600).toFixed(2)),
                        backgroundColor: '#c084fc'
                    },
                    {
                        label: 'Awake',
                        data: history.map(d => +(d.awake / 3600).toFixed(2)),
                        backgroundColor: '#fb7185'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#94a3b8', boxWidth: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (c) {
                                return ` ${c.dataset.label}: ${c.parsed.y} hrs`;
                            },
                            footer: function (items) {
                                const total = items.reduce((sum, item) => sum + item.parsed.y, 0);
                                return `Total Sleep: ${total.toFixed(1)} hrs`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: '#94a3b8', maxTicksLimit: range === '1y' ? 12 : 14 }
                    },
                    y: {
                        stacked: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: v => `${v}h`
                        }
                    }
                }
            }
        });
    }
}

window.renderGlanceSleepTimeline = function (sleepSummary) {
    const canvas = document.getElementById('glance-sleep-timeline-canvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    const width = parent.clientWidth || 240;
    const height = parent.clientHeight || 80;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!sleepSummary) return;

    let levels = sleepSummary.sleepLevels || [];
    const deepSec = sleepSummary.deep || 0;
    const lightSec = sleepSummary.light || 0;
    const remSec = sleepSummary.rem || 0;
    const awakeSec = sleepSummary.awake || 0;
    const totalSec = sleepSummary.total || (deepSec + lightSec + remSec + awakeSec);

    const stageColors = {
        0: '#1d4ed8', // Deep
        1: '#38bdf8', // Light
        2: '#c026d3', // REM
        3: '#f43f5e'  // Awake
    };

    const stageHeights = {
        0: height * 0.32,
        1: height * 0.58,
        2: height * 0.78,
        3: height * 0.98
    };

    if (!levels || levels.length === 0) {
        if (totalSec > 0) {
            const synth = [
                { act: 1, dur: lightSec * 0.3 || (totalSec * 0.2) },
                { act: 0, dur: deepSec || (totalSec * 0.15) },
                { act: 1, dur: lightSec * 0.4 || (totalSec * 0.25) },
                { act: 2, dur: remSec || (totalSec * 0.2) },
                { act: 3, dur: awakeSec || 300 },
                { act: 1, dur: lightSec * 0.3 || (totalSec * 0.15) }
            ];
            levels = [];
            synth.forEach(item => {
                if (item.dur > 0) {
                    levels.push({
                        activityLevel: item.act,
                        duration: item.dur
                    });
                }
            });
        }
    }

    if (!levels || levels.length === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.fillRect(0, height - 12, width, 12);
        return;
    }

    const totalDuration = levels.reduce((sum, lvl) => sum + (lvl.duration || 0), 0) || totalSec || 31380;
    if (totalDuration <= 0) return;

    let curSec = 0;
    levels.forEach(lvl => {
        const dur = lvl.duration || 0;
        const xStart = (curSec / totalDuration) * width;
        const xEnd = ((curSec + dur) / totalDuration) * width;
        const barW = Math.max(1.5, xEnd - xStart);
        const act = lvl.activityLevel != null ? lvl.activityLevel : 1;
        const color = stageColors[act] || stageColors[1];
        const barH = stageHeights[act] || stageHeights[1];
        const y = height - barH;

        ctx.fillStyle = color;
        if (act === 3) {
            ctx.fillRect(xStart, height - stageHeights[3], Math.max(1.5, Math.min(barW, 2.5)), stageHeights[3]);
        } else {
            ctx.fillRect(xStart, y, barW + 0.5, barH);
        }
        curSec += dur;
    });
};

window.updateHydrationRange = async function (range, btn) {
    if (range) window.currentHydrationRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const targetRange = window.currentHydrationRange || '1w';
    const targetEndDate = window.currentHydrationEndDate || new Date();
    window.updateMetricDatePill('hydration', targetRange, targetEndDate);
    const url = `/api/hydration_history?range=${targetRange}&end_date=${getLocalDateStr(targetEndDate)}`;
    await window.fetchAndRenderMetric('hydration', targetRange, targetEndDate, url, 'hydrationHistoryChart', (data) => {
        renderHydrationContent(data, (ml) => (ml * 0.033814).toFixed(1));
    });
};

window.renderHydrationVisual = async function (data) {
    const oz = (ml) => (ml * 0.033814).toFixed(1);
    if (!data) {
        const cached = getCachedData('hydration', window.currentHydrationRange, window.currentHydrationEndDate);
        if (cached) { renderHydrationContent(cached, oz); return; }
        if (window.currentHydrationRange === '1y' && isDateToday(window.currentHydrationEndDate) && window.preloadedData['hydration']) {
            setCachedData('hydration', window.currentHydrationRange, window.currentHydrationEndDate, window.preloadedData['hydration']);
            renderHydrationContent(window.preloadedData['hydration'], oz);
            return;
        }
        window.showChartLoading && window.showChartLoading('hydrationHistoryChart');
        try {
            const res = await fetch(`/api/hydration_history?range=${window.currentHydrationRange}&end_date=${getLocalDateStr(window.currentHydrationEndDate)}`);
            if (res.ok) { data = await res.json(); setCachedData('hydration', window.currentHydrationRange, window.currentHydrationEndDate, data); }
        } catch (e) {
            console.error('Hydration fetch error:', e);
        } finally {
            window.hideChartLoading && window.hideChartLoading('hydrationHistoryChart');
        }
    }
    if (data) renderHydrationContent(data, oz);
}

function renderHydrationContent(data, oz) {
    try {
        const canvasId = 'hydrationHistoryChart';
        const hChart = document.getElementById('hydration-chart');
        const hDonutContainer = document.getElementById('hydration-donut-container');
        const hHistoryChart = document.getElementById(canvasId);
        window.updateMetricDatePill('hydration', window.currentHydrationRange, window.currentHydrationEndDate);

        if (window.currentHydrationRange === '1d') {
            window.destroyChartIfExists(canvasId);
            const oldC = document.getElementById(canvasId);
            if (oldC) oldC.style.display = 'none';
            if (hDonutContainer) hDonutContainer.style.display = 'flex';

            const summary = data.summary || data;
            const intake = summary.intake || 0;
            const goal = summary.goal || 2839;
            const p = goal > 0 ? Math.min(100, Math.round((intake / goal) * 100)) : 0;
            const intakeOz = oz(intake);
            const goalOz = oz(goal);
            
            safeSetText('hydration-val', intakeOz + ' oz');
            safeSetText('hydration-percent', p + '%');
            safeSetText('hydration-goal', `Goal: ${goalOz} oz`);
            safeSetText('hydration-drilldown-intake', `${intakeOz} oz`);
            safeSetText('hydration-drilldown-goal', `${goalOz} oz`);
            safeSetText('hydration-drilldown-avg', `${intakeOz} oz`);
            safeSetText('hydration-drilldown-adherence', `${p}%`);
            
            if (hChart) {
                hChart.style.background = `conic-gradient(${p >= 100 ? '#22c55e' : '#38bdf8'} ${p}%, rgba(255,255,255,0.05) ${p}% 100%)`;
            }
        } else {
            if (hDonutContainer) hDonutContainer.style.display = 'none';
            const canvas = window.getCleanCanvas(canvasId);
            if (!canvas) return;

            const history = data.history || [];
            const validIntake = history.map(d => parseFloat(oz(d.intake || 0))).filter(v => v > 0);
            const avgOz = validIntake.length > 0 ? Math.round(validIntake.reduce((a, b) => a + b, 0) / validIntake.length) : '--';
            const latestGoal = history.length > 0 ? oz(history[history.length - 1].goal || 2839) : '96.0';

            const metDays = history.filter(d => (d.intake || 0) >= (d.goal || 2839)).length;
            const adherencePct = history.length > 0 ? Math.round((metDays / history.length) * 100) : 0;

            safeSetText('hydration-drilldown-intake', validIntake.length > 0 ? `${validIntake[validIntake.length - 1]} oz` : '-- oz');
            safeSetText('hydration-drilldown-goal', `${latestGoal} oz`);
            safeSetText('hydration-drilldown-avg', `${avgOz} oz`);
            safeSetText('hydration-drilldown-adherence', `${adherencePct}%`);

            const ctx = canvas.getContext('2d');
            chartInstances[canvasId] = new Chart(ctx, {
                type: 'bar',
                data: { labels: history.map(d => (d.date || '').split('-').slice(1).join('/')), datasets: [{ data: history.map(d => parseFloat(oz(d.intake || 0))), backgroundColor: '#38bdf8', borderRadius: 4 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }
    } catch (err) {
        console.error('Error in renderHydrationContent:', err);
    }
}

window.updateHRVRange = async function (range, btn) {
    if (range) window.currentHRVRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const targetRange = window.currentHRVRange || '1w';
    const targetEndDate = window.currentHRVEndDate || new Date();
    window.updateMetricDatePill('hrv', targetRange, targetEndDate);
    const url = `/api/hrv?range=${targetRange}&end_date=${getLocalDateStr(targetEndDate)}`;
    await window.fetchAndRenderMetric('hrv', targetRange, targetEndDate, url, 'hrvHistoryChart', renderHRVVisual);
};

window.renderHRVVisual = function (data) {
    try {
        const canvasId = 'hrvHistoryChart';
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
    const statusContainer = document.getElementById('hrv-status-container');
    window.updateMetricDatePill('hrv', window.currentHRVRange, window.currentHRVEndDate);

    const history = data.history || [];
    const latestHistory = history.length > 0 ? history[history.length - 1] : {};
    const summary = data.hrvSummary || data.summary || (data.lastNightAvg != null ? data : latestHistory) || {};
    const lastNight = summary.lastNightAvg != null ? summary.lastNightAvg : (summary.last_night_avg != null ? summary.last_night_avg : (latestHistory.lastNightAvg != null ? latestHistory.lastNightAvg : '--'));
    const weeklyAvg = summary.weeklyAvg != null ? summary.weeklyAvg : (summary.weekly_avg != null ? summary.weekly_avg : (latestHistory.weeklyAvg != null ? latestHistory.weeklyAvg : '--'));
    const status = summary.lastNightStatus || summary.last_night_status || summary.status || latestHistory.status || 'BALANCED';
    const feedback = summary.feedbackText || summary.feedback || '';
    
    const baseline = summary.baseline || latestHistory.baseline || {};
    const low = baseline.balancedLow || summary.baselineLow || latestHistory.baselineLow || 0;
    const high = baseline.balancedUpper || summary.baselineHigh || latestHistory.baselineHigh || 0;

    safeSetText('hrv-drilldown-7d', typeof weeklyAvg === 'number' ? `${weeklyAvg} ms` : `${weeklyAvg}`);
    safeSetText('hrv-drilldown-night', typeof lastNight === 'number' ? `${lastNight} ms` : `${lastNight}`);
    safeSetText('hrv-drilldown-low', low ? `${low} ms` : '--');
    safeSetText('hrv-drilldown-high', high ? `${high} ms` : '--');
    safeSetText('hrv-drilldown-base-low', low || '--');
    safeSetText('hrv-drilldown-base-high', high || '--');
    safeSetText('hrv-drilldown-status', status.replace(/_/g, ' '));

    if (window.currentHRVRange === '1d') {
        window.destroyChartIfExists(canvasId);
        const oldC = document.getElementById(canvasId);
        if (oldC) oldC.style.display = 'none';
        if (statusContainer) statusContainer.style.display = 'block';

        let displayFeedback = feedback;
        if (!displayFeedback && status) {
            const s = status.toLowerCase();
            if (s.includes('balanced') && !s.includes('unbalanced') && low && high && lastNight !== '--') {
                displayFeedback = `Your overnight HRV of ${lastNight} ms is balanced within your baseline (${low}–${high} ms), indicating good autonomic recovery.`;
            }
        }

        safeSetText('hrv-val', weeklyAvg);
        safeSetText('hrv-status-badge', status.replace(/_/g, ' '));
        safeSetText('hrv-weekly-avg', `Overnight: ${lastNight} ms`);
        safeSetText('hrv-baseline-low', low || '--');
        safeSetText('hrv-baseline-high', high || '--');
        safeSetText('hrv-feedback', displayFeedback);

        const badge = document.getElementById('hrv-status-badge');
        if (badge) {
            badge.className = 'badge';
            const s = status.toLowerCase();
            if (s.includes('balanced') && !s.includes('unbalanced')) badge.classList.add('badge-success');
            else if (s.includes('low') || s.includes('unbalanced')) badge.classList.add('badge-warning');
            else if (s.includes('poor')) badge.classList.add('badge-danger');
        }

        const marker = document.getElementById('hrv-marker');
        const zone = document.getElementById('hrv-baseline-zone');
        const drillMarker = document.getElementById('hrv-drilldown-marker');
        const drillZone = document.getElementById('hrv-drilldown-zone');

        if (low && high) {
            const range = high - low;
            const buffer = Math.max(15, range * 0.75);
            const scaleMin = Math.max(0, low - buffer);
            const scaleMax = high + buffer;
            const scaleRange = scaleMax - scaleMin;

            if (scaleRange > 0) {
                const zoneLeft = ((low - scaleMin) / scaleRange) * 100;
                const zoneWidth = ((high - low) / scaleRange) * 100;
                if (zone) { zone.style.left = `${zoneLeft.toFixed(1)}%`; zone.style.width = `${zoneWidth.toFixed(1)}%`; }
                if (drillZone) { drillZone.style.left = `${zoneLeft.toFixed(1)}%`; drillZone.style.width = `${zoneWidth.toFixed(1)}%`; }

                const val = (typeof lastNight === 'number') ? lastNight : ((typeof weeklyAvg === 'number') ? weeklyAvg : 0);
                if (val > 0) {
                    const percent = ((val - scaleMin) / scaleRange) * 100;
                    const pos = `${Math.max(2, Math.min(98, percent)).toFixed(1)}%`;
                    if (marker) marker.style.left = pos;
                    if (drillMarker) drillMarker.style.left = pos;
                }
            }
        }
    } else {
        if (statusContainer) statusContainer.style.display = 'none';
        const canvas = window.getCleanCanvas(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const getStatusColor = (s) => {
            if (!s) return '#22c55e';
            const str = String(s).toLowerCase();
            if (str.includes('balanced') && !str.includes('unbalanced')) return '#22c55e';
            if (str.includes('low') || str.includes('unbalanced')) return '#eab308';
            if (str.includes('poor')) return '#ef4444';
            return '#22c55e';
        };
        const statusColors = history.map(d => getStatusColor(d.status || d.lastNightStatus || d.last_night_status));

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
    } catch (err) {
        console.error('Error in renderHRVVisual:', err);
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
    window.destroyChartIfExists(finalId);

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

// ============================================================================
// GARMIN AT-A-GLANCE MINI VISUAL RENDERERS
// ============================================================================

window.renderGlanceHRSparkline = function(hrData) {
    const canvas = document.getElementById('glance-hr-sparkline');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let rawList = [];
    if (Array.isArray(hrData)) {
        rawList = hrData;
    } else if (hrData && Array.isArray(hrData.samples)) {
        rawList = hrData.samples;
    } else if (hrData && Array.isArray(hrData.history)) {
        rawList = hrData.history;
    }

    const points = [];
    rawList.forEach(item => {
        if (typeof item === 'number' && item > 0) {
            points.push(item);
        } else if (Array.isArray(item) && item.length >= 2 && typeof item[1] === 'number' && item[1] > 0) {
            points.push(item[1]);
        } else if (item && typeof item.rhr === 'number' && item.rhr > 0) {
            points.push(item.rhr);
        }
    });

    if (points.length < 2) {
        window.destroyChartIfExists('glance-hr-sparkline');
        return;
    }

    let sampled = points;
    if (points.length > 40) {
        const step = Math.ceil(points.length / 40);
        sampled = points.filter((_, idx) => idx % step === 0);
    }

    window.destroyChartIfExists('glance-hr-sparkline');

    const gradient = ctx.createLinearGradient(0, 0, 0, 45);
    gradient.addColorStop(0, 'rgba(248, 113, 113, 0.35)');
    gradient.addColorStop(1, 'rgba(248, 113, 113, 0.0)');

    window.chartInstances['glance-hr-sparkline'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sampled.map((_, i) => i),
            datasets: [{
                data: sampled,
                borderColor: '#f87171',
                borderWidth: 2,
                backgroundColor: gradient,
                fill: true,
                pointRadius: 0,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } }
        }
    });
};

window.renderGlanceWeightSparkline = function(weightData) {
    const canvas = document.getElementById('glance-weight-sparkline');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const list = Array.isArray(weightData) ? weightData : ((weightData && weightData.history) || []);
    const vals = list.map(d => typeof d === 'number' ? d : d.weight_lbs).filter(v => typeof v === 'number' && v > 0);
    
    if (vals.length < 2) {
        window.destroyChartIfExists('glance-weight-sparkline');
        return;
    }

    window.destroyChartIfExists('glance-weight-sparkline');

    const gradient = ctx.createLinearGradient(0, 0, 0, 45);
    gradient.addColorStop(0, 'rgba(129, 140, 248, 0.35)');
    gradient.addColorStop(1, 'rgba(129, 140, 248, 0.0)');

    window.chartInstances['glance-weight-sparkline'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: vals.map((_, i) => i),
            datasets: [{
                data: vals,
                borderColor: '#818cf8',
                borderWidth: 2,
                backgroundColor: gradient,
                fill: true,
                pointRadius: (ctx) => ctx.dataIndex === vals.length - 1 ? 4 : 0,
                pointBackgroundColor: '#818cf8',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } }
        }
    });
};

window.renderGlanceStressSparkline = function(stressData) {
    const canvas = document.getElementById('glance-stress-sparkline');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let rawList = [];
    if (Array.isArray(stressData)) {
        rawList = stressData;
    } else if (stressData && Array.isArray(stressData.samples)) {
        rawList = stressData.samples;
    } else if (stressData && Array.isArray(stressData.history)) {
        rawList = stressData.history;
    }

    const points = [];
    rawList.forEach(item => {
        if (typeof item === 'number' && item >= 0) {
            points.push(item);
        } else if (Array.isArray(item) && item.length >= 2 && typeof item[1] === 'number' && item[1] >= 0) {
            points.push(item[1]);
        } else if (item && typeof item.avg === 'number' && item.avg >= 0) {
            points.push(item.avg);
        }
    });

    if (points.length < 2) {
        window.destroyChartIfExists('glance-stress-sparkline');
        return;
    }

    let sampled = points;
    if (points.length > 40) {
        const step = Math.ceil(points.length / 40);
        sampled = points.filter((_, idx) => idx % step === 0);
    }

    window.destroyChartIfExists('glance-stress-sparkline');

    const gradient = ctx.createLinearGradient(0, 0, 0, 45);
    gradient.addColorStop(0, 'rgba(168, 85, 247, 0.35)');
    gradient.addColorStop(1, 'rgba(168, 85, 247, 0.0)');

    window.chartInstances['glance-stress-sparkline'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sampled.map((_, i) => i),
            datasets: [{
                data: sampled,
                borderColor: '#a855f7',
                borderWidth: 2,
                backgroundColor: gradient,
                fill: true,
                pointRadius: 0,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } }
        }
    });
};

window.renderGlanceHRV = function(hrvData, hrvHistory = []) {
    if (!hrvData) return;
    const summary = hrvData.hrvSummary || hrvData.summary || hrvData;
    const lastNight = summary.lastNightAvg || summary.last_night_avg || '--';
    const weeklyAvg = summary.weeklyAvg || summary.weekly_avg || '--';
    const baseline = summary.baseline || { lowUpper: 77, balancedLow: 77, balancedUpper: 103 };
    const low = baseline.balancedLow || baseline.lowUpper || summary.baselineLow || 70;
    const high = baseline.balancedUpper || summary.baselineHigh || 100;
    const status = summary.lastNightStatus || summary.last_night_status || summary.status || 'BALANCED';

    window.safeSetText('hrv-val', weeklyAvg);
    window.safeSetText('hrv-last-night-caption', `Overnight: ${lastNight} ms`);
    window.safeSetText('hrv-baseline-low', low);
    window.safeSetText('hrv-baseline-high', high);

    const badge = document.getElementById('hrv-status-badge');
    if (badge) {
        const isBal = String(status).toUpperCase().includes('BALANCED');
        badge.textContent = isBal ? 'Balanced' : status.replace(/_/g, ' ');
        badge.style.background = isBal ? 'rgba(74, 222, 128, 0.15)' : 'rgba(251, 146, 60, 0.15)';
        badge.style.color = isBal ? '#4ade80' : '#fb923c';
    }

    const buffer = Math.max(15, (high - low) * 0.5);
    const minScale = Math.max(10, low - buffer);
    const maxScale = high + buffer;
    const zoneLeft = Math.max(0, Math.min(100, ((low - minScale) / (maxScale - minScale)) * 100));
    const zoneWidth = Math.max(15, Math.min(100 - zoneLeft, ((high - low) / (maxScale - minScale)) * 100));
    const reading = (typeof lastNight === 'number' && lastNight > 0) ? lastNight : ((typeof weeklyAvg === 'number' && weeklyAvg > 0) ? weeklyAvg : 0);
    const markerPct = reading > 0 ? Math.max(2, Math.min(98, ((reading - minScale) / (maxScale - minScale)) * 100)) : 50;

    const zoneEl = document.getElementById('hrv-baseline-zone');
    const markerEl = document.getElementById('hrv-marker');
    if (zoneEl) { zoneEl.style.left = zoneLeft.toFixed(1) + '%'; zoneEl.style.width = zoneWidth.toFixed(1) + '%'; }
    if (markerEl) { markerEl.style.left = markerPct.toFixed(1) + '%'; }

    // Render 4w scatter sparkline
    const canvas = document.getElementById('glance-hrv-sparkline');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        const histList = (Array.isArray(hrvHistory) && hrvHistory.length > 0) ? hrvHistory : ((hrvData && hrvData.history) || []);
        const points = histList.map(h => (typeof h === 'number' ? h : (h.lastNightAvg || h.value || h.hrv || null))).filter(p => typeof p === 'number' && p > 0);
        
        if (points.length < 2) {
            window.destroyChartIfExists('glance-hrv-sparkline');
            return;
        }

        window.destroyChartIfExists('glance-hrv-sparkline');
        window.chartInstances['glance-hrv-sparkline'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: points.map((_, i) => i),
                datasets: [{
                    data: points,
                    borderColor: '#4ade80',
                    borderWidth: 1.5,
                    pointRadius: 2.5,
                    pointBackgroundColor: '#4ade80',
                    pointBorderColor: '#0f172a',
                    tension: 0.2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false, min: minScale, max: maxScale } }
            }
        });
    }
};

window.renderGlanceDonut = function(elementId, current, goal, color) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const safeGoal = goal > 0 ? goal : 1;
    const pct = Math.min(100, Math.round((current / safeGoal) * 100));
    el.style.setProperty('--ring-color', color || '#4ade80');
    el.style.setProperty('--ring-pct', pct);
};

window.renderWeekStreak = function(containerId, historyDays, goal) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const entries = Array.isArray(historyDays) ? historyDays.slice(-7) : [];
    
    el.innerHTML = days.map((dayChar, i) => {
        const entry = entries[i];
        let val = 0;
        if (typeof entry === 'number') {
            val = entry;
        } else if (entry) {
            val = entry.totalSteps || entry.total || entry.intake || entry.val || entry.activeMinutes || 0;
        }
        const isMet = val >= (goal || 1);
        return `<span class="streak-dot ${isMet ? 'met' : ''}">${isMet ? '✓' : dayChar}</span>`;
    }).join('');
};
