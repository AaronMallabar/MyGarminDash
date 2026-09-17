/**
 * Health Metrics: HRV & Intensity Minutes Logic
 */

window.currentHRVEndDate = new Date();
window.currentHRVRange = '1d';
window.currentIMRange = '1d';

window.updateHRVRange = async function (range, btn) {
    if (range) window.currentHRVRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    if (window.updateMetricDatePill) window.updateMetricDatePill('hrv', window.currentHRVRange, window.currentHRVEndDate);
    if (window.fetchHRVHistory) await window.fetchHRVHistory();
}

window.shiftHRVDate = function (dir) {
    if (window.shiftDate) window.shiftDate('HRV', dir);
}

window.updateIMRange = async function (range, btn) {
    if (range) window.currentIMRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    if (window.updateMetricDatePill) window.updateMetricDatePill('im', window.currentIMRange, window.currentIMEndDate);
    if (window.fetchIMHistory) await window.fetchIMHistory();
}

window.shiftIMDate = function (dir) {
    if (window.shiftDate) window.shiftDate('IM', dir);
}

const goalMetBadgePlugin = {
    id: 'goalMetBadges',
    afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!dataset.goalMetIndices || dataset.goalMetIndices.length === 0) return;
            const meta = chart.getDatasetMeta(datasetIndex);
            if (meta.hidden) return;

            dataset.goalMetIndices.forEach(idx => {
                const element = meta.data[idx];
                if (!element) return;
                const { x, y } = element;

                ctx.save();
                // Draw white circle with green border
                ctx.beginPath();
                ctx.arc(x, y, 9, 0, 2 * Math.PI);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = '#22c55e';
                ctx.stroke();

                // Draw green checkmark inside
                ctx.beginPath();
                ctx.moveTo(x - 4, y);
                ctx.lineTo(x - 1, y + 3.5);
                ctx.lineTo(x + 4, y - 3.5);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#22c55e';
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
                ctx.restore();
            });
        });
    }
};

window.renderIntensityMinutesVisualV2 = function (data) {
    const canvasId = 'imHistoryChart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window.chartInstances[canvasId]) window.chartInstances[canvasId].destroy();

    const range = data.range || window.currentIMRange || '1w';
    const history = data.history || [];
    const goal = data.goal || 420;
    if (window.updateMetricDatePill) window.updateMetricDatePill('im', range, window.currentIMEndDate);

    // Calculate moderate, vigorous, and total for drilldown stats
    let totalModerate = 0;
    let totalVigorous = 0;
    let totalMinutes = 0;

    if (range === '1d') {
        const sum = data.summary || {};
        totalModerate = sum.moderate || 0;
        totalVigorous = sum.vigorous || 0;
        totalMinutes = sum.total != null ? sum.total : (totalModerate + 2 * totalVigorous);
        const weekVal = sum.weeklyTotal != null ? sum.weeklyTotal : ((sum.startDayMinutes || 0) + totalMinutes);
        window.safeSetText('im-val', weekVal);
        window.safeSetText('im-goal', sum.goal || goal);

        window.safeSetText('im-drilldown-total', `${totalMinutes} min`);
        window.safeSetText('im-drilldown-moderate', `${totalModerate} min`);
        window.safeSetText('im-drilldown-vigorous', `${totalVigorous} min`);
        window.safeSetText('im-drilldown-goal', `${sum.goal || goal} min`);

        const rawSamples = data.samples || [];
        let points = rawSamples
            .filter(s => Array.isArray(s) && s[0] != null && s[1] != null)
            .map(s => ({ x: s[0], y: s[1] }));

        if (points.length === 0) {
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
            points = [{ x: todayStart.getTime(), y: 0 }, { x: todayEnd.getTime(), y: 0 }];
        }

        const maxVal = Math.max(10, ...points.map(p => p.y || 0));

        window.chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Intensity Minutes',
                    data: points,
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    spanGaps: true,
                    fill: true,
                    tension: 0.2
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        type: 'time',
                        time: { displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } },
                        grid: { display: false },
                        ticks: { color: '#94a3b8', maxTicksLimit: 8 }
                    },
                    y: {
                        beginAtZero: true,
                        max: maxVal + 2,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    } else if (range === '1m') {
        // ── 4 WEEKS VIEW (Weekly Build-Up Stepped Chart) ──────────────────────
        // Build 28 days (4 complete Monday-to-Sunday weeks)
        let endDt = window.currentIMEndDate ? new Date(window.currentIMEndDate) : new Date();
        if (isNaN(endDt.getTime())) endDt = new Date();
        const daysToMon = (endDt.getDay() + 6) % 7; // Monday = 0
        const currMon = new Date(endDt);
        currMon.setDate(endDt.getDate() - daysToMon);
        currMon.setHours(0, 0, 0, 0);

        const startMon = new Date(currMon);
        startMon.setDate(currMon.getDate() - 21); // 3 weeks ago Monday

        const all28Dates = [];
        const dateKeys = [];
        const xLabels = [];

        for (let i = 0; i < 28; i++) {
            const d = new Date(startMon);
            d.setDate(startMon.getDate() + i);
            all28Dates.push(d);
            const dStr = window.getLocalDateStr ? window.getLocalDateStr(d) : d.toISOString().split('T')[0];
            dateKeys.push(dStr);
            xLabels.push(d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
        }

        const historyMap = {};
        history.forEach(item => {
            const k = item.date || item.calendarDate;
            if (k) historyMap[k] = item;
        });

        // Compute aggregate stats across 4 weeks
        history.forEach(d => {
            totalModerate += d.moderate || 0;
            totalVigorous += d.vigorous || 0;
            totalMinutes += d.total != null ? d.total : ((d.moderate || 0) + 2 * (d.vigorous || 0));
        });

        const weeklyAvg = Math.round(totalMinutes / 4);
        window.safeSetText('im-drilldown-total', `${totalMinutes} min (${weeklyAvg}/wk)`);
        window.safeSetText('im-drilldown-moderate', `${totalModerate} min`);
        window.safeSetText('im-drilldown-vigorous', `${totalVigorous} min`);
        window.safeSetText('im-drilldown-goal', `${goal} min`);

        const todayStr = window.getLocalDateStr ? window.getLocalDateStr(new Date()) : new Date().toISOString().split('T')[0];
        const datasets = [];
        let maxObserved = goal;

        // Weekly Goal horizontal dashed baseline
        datasets.push({
            label: 'Weekly Goal',
            data: Array(28).fill(goal),
            borderColor: 'rgba(148, 163, 184, 0.7)',
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            stepped: false
        });

        // 4 Weekly Stepped Line Datasets
        for (let w = 0; w < 4; w++) {
            const weekDataPoints = Array(28).fill(null);
            let cumMinutes = 0;
            let weekGoal = goal;
            let goalMetIndex = null;
            let hasPoints = false;

            for (let d = 0; d < 7; d++) {
                const gIdx = w * 7 + d;
                const dKey = dateKeys[gIdx];

                // Stop plotting future days beyond today
                if (dKey > todayStr && !historyMap[dKey]) {
                    continue;
                }

                const dayItem = historyMap[dKey] || {};
                if (dayItem.goal) weekGoal = dayItem.goal;

                const mod = dayItem.moderate || 0;
                const vig = dayItem.vigorous || 0;
                const dayTotal = dayItem.total != null ? dayItem.total : (mod + 2 * vig);

                if (dayItem.startDayMinutes != null) {
                    cumMinutes = dayItem.startDayMinutes + dayTotal;
                } else {
                    cumMinutes += dayTotal;
                }

                weekDataPoints[gIdx] = cumMinutes;
                hasPoints = true;
                if (cumMinutes > maxObserved) maxObserved = cumMinutes;

                if (cumMinutes >= weekGoal && goalMetIndex === null && cumMinutes > 0) {
                    goalMetIndex = gIdx;
                }
            }

            if (hasPoints) {
                const isGoalMet = cumMinutes >= weekGoal && cumMinutes > 0;
                const lineColor = isGoalMet ? '#22c55e' : '#38bdf8';

                datasets.push({
                    label: isGoalMet ? 'Intensity Minutes Goal Met' : 'Intensity Minutes',
                    data: weekDataPoints,
                    borderColor: lineColor,
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    stepped: 'before',
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    goalMetIndices: goalMetIndex !== null ? [goalMetIndex] : [],
                    spanGaps: false
                });
            }
        }

        const yAxisMax = Math.max(1000, Math.ceil((maxObserved + 100) / 200) * 200);

        window.chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: xLabels,
                datasets: datasets
            },
            plugins: [goalMetBadgePlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            color: '#94a3b8',
                            boxWidth: 14,
                            padding: 16,
                            generateLabels: () => [
                                {
                                    text: 'Weekly Goal',
                                    strokeStyle: 'rgba(148, 163, 184, 0.8)',
                                    lineWidth: 2,
                                    lineDash: [4, 4],
                                    fillStyle: 'transparent',
                                    hidden: false
                                },
                                {
                                    text: 'Intensity Minutes',
                                    fillStyle: '#38bdf8',
                                    strokeStyle: '#38bdf8',
                                    lineWidth: 2,
                                    hidden: false
                                },
                                {
                                    text: 'Intensity Minutes Goal Met',
                                    fillStyle: '#22c55e',
                                    strokeStyle: '#22c55e',
                                    lineWidth: 2,
                                    hidden: false
                                }
                            ]
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const idx = items[0].dataIndex;
                                const d = all28Dates[idx];
                                return d ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
                            },
                            label: (ctx) => {
                                if (ctx.dataset.label === 'Weekly Goal') {
                                    return `Weekly Goal: ${ctx.parsed.y} min`;
                                }
                                const val = ctx.parsed.y;
                                if (val == null) return null;
                                const isMet = val >= goal;
                                const dayItem = historyMap[dateKeys[ctx.dataIndex]] || {};
                                const mod = dayItem.moderate || 0;
                                const vig = dayItem.vigorous || 0;
                                const dayTotal = dayItem.total != null ? dayItem.total : (mod + 2 * vig);

                                const res = [`Cumulative Week Total: ${val} min ${isMet ? ' (Goal Met ✓)' : ''}`];
                                if (dayTotal > 0) {
                                    res.push(`  + Today: ${dayTotal} min (${mod} mod, ${vig * 2} vig)`);
                                }
                                return res;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: (ctx) => (ctx.index % 7 === 0 ? 'rgba(255, 255, 255, 0.18)' : 'transparent'),
                            lineWidth: (ctx) => (ctx.index % 7 === 0 ? 1.5 : 0)
                        },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 10 },
                            maxRotation: 45,
                            minRotation: 45,
                            autoSkip: false
                        }
                    },
                    y: {
                        beginAtZero: true,
                        max: yAxisMax,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', stepSize: 200 }
                    }
                }
            }
        });

    } else if (range === '6m' || range === '1y') {
        history.forEach(w => {
            totalModerate += w.moderate || 0;
            totalVigorous += w.vigorous || 0;
            totalMinutes += w.total || 0;
        });
        const weeklyAvg = history.length > 0 ? Math.round(totalMinutes / history.length) : 0;
        window.safeSetText('im-drilldown-total', `${weeklyAvg} min/wk`);
        window.safeSetText('im-drilldown-moderate', `${history.length > 0 ? Math.round(totalModerate / history.length) : 0} min/wk`);
        window.safeSetText('im-drilldown-vigorous', `${history.length > 0 ? Math.round(totalVigorous / history.length) : 0} min/wk`);
        window.safeSetText('im-drilldown-goal', `${goal} min`);

        window.chartInstances[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: history.map(w => {
                    const dt = window.parseLocalDate(w.date);
                    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
                }),
                datasets: [{
                    label: 'Weekly Minutes',
                    data: history.map(w => w.total),
                    backgroundColor: history.map(w => w.total >= (w.goal || goal) ? '#4ade80' : '#38bdf8'),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const w = history[ctx.dataIndex];
                                const g = w.goal || goal;
                                return `Total: ${ctx.parsed.y} / Goal: ${g} mins`;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 12 } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    } else {
        // 1w (7 Days)
        history.forEach(d => {
            totalModerate += d.moderate || 0;
            totalVigorous += d.vigorous || 0;
            totalMinutes += d.total != null ? d.total : ((d.moderate || 0) + 2 * (d.vigorous || 0));
        });
        window.safeSetText('im-drilldown-total', `${totalMinutes} min`);
        window.safeSetText('im-drilldown-moderate', `${totalModerate} min`);
        window.safeSetText('im-drilldown-vigorous', `${totalVigorous} min`);
        window.safeSetText('im-drilldown-goal', `${goal} min`);

        const labels = history.map(d => {
            const dt = window.parseLocalDate(d.date || d.calendarDate);
            return dt.toLocaleDateString([], { weekday: 'short' });
        });

        window.chartInstances[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Moderate',
                        data: history.map(d => d.moderate || 0),
                        backgroundColor: '#4ade80',
                        borderRadius: 3
                    },
                    {
                        label: 'Vigorous (2x)',
                        data: history.map(d => (d.vigorous || 0) * 2),
                        backgroundColor: '#38bdf8',
                        borderRadius: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, labels: { color: '#94a3b8', boxWidth: 12 } }
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 14 } },
                    y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }
};
