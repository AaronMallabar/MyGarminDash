/**
 * Health Metrics: HRV & Intensity Minutes Logic
 */

window.currentHRVEndDate = window.currentHRVEndDate || new Date();
window.currentHRVRange = window.currentHRVRange || '1w';
window.currentIMRange = window.currentIMRange || '1w';
window.currentIMEndDate = window.currentIMEndDate || new Date();

window.updateHRVRange = async function (range, btn) {
    if (range) window.currentHRVRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn, .drilldown-range-btn, button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    if (window.updateMetricDatePill) window.updateMetricDatePill('hrv', window.currentHRVRange, window.currentHRVEndDate);
    const cached = window.getCachedData ? window.getCachedData('hrv', window.currentHRVRange, window.currentHRVEndDate) : null;
    if (cached) {
        if (window.renderHRVVisual) window.renderHRVVisual(cached);
        return;
    }
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
    const cached = window.getCachedData ? window.getCachedData('im', window.currentIMRange, window.currentIMEndDate) : null;
    if (cached) {
        if (window.renderIntensityMinutesVisualV2) window.renderIntensityMinutesVisualV2(cached);
        return;
    }
    if (window.fetchIMHistory) await window.fetchIMHistory();
}

window.shiftIMDate = function (dir) {
    if (window.shiftDate) window.shiftDate('IM', dir);
}

const goalMetBadgePlugin = {
    id: 'goalMetBadges',
    afterDatasetsDraw(chart) {
        try {
            if (!chart || !chart.ctx || !chart.data || !chart.data.datasets) return;
            const ctx = chart.ctx;
            chart.data.datasets.forEach((dataset, datasetIndex) => {
                if (!dataset.goalMetIndices || dataset.goalMetIndices.length === 0) return;
                const meta = chart.getDatasetMeta(datasetIndex);
                if (!meta || meta.hidden || !meta.data) return;

                dataset.goalMetIndices.forEach(idx => {
                    const element = meta.data[idx];
                    if (!element || typeof element.x !== 'number' || typeof element.y !== 'number' || !isFinite(element.x) || !isFinite(element.y)) return;
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
        } catch (e) {
            console.warn('goalMetBadgePlugin error:', e);
        }
    }
};

window.renderIntensityMinutesVisualV2 = function (data) {
    try {
        const canvasId = 'imHistoryChart';
        const canvas = window.getCleanCanvas(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

    const range = data.range || window.currentIMRange || '1w';
    const goal = data.goal || 420;
    if (window.updateMetricDatePill) window.updateMetricDatePill('im', range, window.currentIMEndDate);

    const weeklySummaryEl = document.getElementById('im-weekly-summary');
    const chartTitleEl = document.getElementById('im-chart-title');

    if (range === '1d') {
        // ── 1 DAY: Daily Timeline (Cumulative line across 24h) ────────────────
        if (weeklySummaryEl) weeklySummaryEl.style.display = 'none';
        if (chartTitleEl) chartTitleEl.textContent = 'Daily Timeline';

        const sum = data.summary || {};
        const totalMinutes = sum.total != null ? sum.total : ((sum.moderate || 0) + 2 * (sum.vigorous || 0));
        const modMinutes = sum.moderate || 0;
        const vigMinutes = sum.vigorous || 0;
        const weekGoal = sum.goal || goal;

        window.safeSetText('im-drilldown-total-label', 'Total Minutes');
        window.safeSetText('im-drilldown-mod-label', 'Moderate Minutes');
        window.safeSetText('im-drilldown-vig-label', 'Vigorous Minutes (2x)');
        window.safeSetText('im-drilldown-goal-label', 'Weekly Goal');

        window.safeSetText('im-drilldown-total', `${totalMinutes} min`);
        window.safeSetText('im-drilldown-moderate', `${modMinutes} min`);
        window.safeSetText('im-drilldown-vigorous', `${vigMinutes} min`);
        window.safeSetText('im-drilldown-goal', `${weekGoal} min`);

        if (sum.weeklyTotal != null) window.safeSetText('im-val', sum.weeklyTotal);

        // Construct 24h timeline points
        let points = (data.timeline && data.timeline.length > 0) ? data.timeline : [];
        const dateStr = sum.date || (window.currentIMEndDate ? window.getLocalDateStr(window.currentIMEndDate) : new Date().toISOString().split('T')[0]);
        const dayStart = new Date(`${dateStr}T00:00:00`);
        const dayEnd = new Date(`${dateStr}T23:59:59`);
        const startMs = dayStart.getTime();
        const endMs = dayEnd.getTime();

        if (points.length === 0) {
            const raw = data.samples || [];
            points.push({ x: startMs, y: 0 });
            let running = 0;
            raw.forEach(s => {
                if (Array.isArray(s) && s[0] != null && s[1] != null) {
                    running += s[1];
                    points.push({ x: s[0], y: running });
                }
            });
            points.push({ x: endMs, y: Math.max(running, totalMinutes) });
        }

        const maxVal = Math.max(weekGoal + 60, totalMinutes + 50, 480);

        window.chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Weekly Goal',
                        data: [{ x: startMs, y: weekGoal }, { x: endMs, y: weekGoal }],
                        borderColor: 'rgba(148, 163, 184, 0.7)',
                        borderDash: [6, 4],
                        borderWidth: 1.5,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        fill: false
                    },
                    {
                        label: 'Intensity Minutes',
                        data: points,
                        borderColor: '#38bdf8',
                        backgroundColor: 'rgba(56, 189, 248, 0.12)',
                        borderWidth: 2.5,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        stepped: 'before',
                        spanGaps: true,
                        fill: true
                    }
                ]
            },
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
                            generateLabels: () => [
                                { text: 'Weekly Goal', strokeStyle: 'rgba(148, 163, 184, 0.8)', lineWidth: 2, lineDash: [4, 4], fillStyle: 'transparent' },
                                { text: 'Intensity Minutes', fillStyle: '#38bdf8', strokeStyle: '#38bdf8', lineWidth: 2 }
                            ]
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const d = new Date(items[0].parsed.x);
                                return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                            },
                            label: (c) => {
                                if (c.dataset.label === 'Weekly Goal') return `Weekly Goal: ${weekGoal} min`;
                                return `Cumulative Minutes: ${c.parsed.y} min`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        min: startMs,
                        max: endMs,
                        time: { unit: 'hour', stepSize: 6, displayFormats: { hour: 'ha' } },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        max: maxVal,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', stepSize: 100 }
                    }
                }
            }
        });

    } else if (range === '1w') {
        // ── 7 DAYS: Weekly Timeline (Cumulative Mon-Sun line plot) ─────────────
        if (weeklySummaryEl) weeklySummaryEl.style.display = 'flex';
        if (chartTitleEl) chartTitleEl.textContent = 'Weekly Timeline';

        const sum = data.summary || {};
        const weeklyTotal = sum.weeklyTotal != null ? sum.weeklyTotal : 0;
        const weeklyMod = sum.weeklyModerate != null ? sum.weeklyModerate : 0;
        const weeklyVig = sum.weeklyVigorous != null ? sum.weeklyVigorous : 0;
        const weekGoal = sum.goal || goal;
        const isGoalMet = sum.isGoalMet != null ? sum.isGoalMet : (weeklyTotal >= weekGoal && weeklyTotal > 0);
        const neededMod = sum.neededModerate != null ? sum.neededModerate : Math.max(0, weekGoal - weeklyTotal);
        const neededVig = sum.neededVigorous != null ? sum.neededVigorous : Math.ceil(neededMod / 2);

        // Update Modal Donut & Callout
        window.safeSetText('im-modal-donut-val', weeklyTotal);
        window.safeSetText('im-modal-donut-sub', `/ ${weekGoal}`);
        const imModalDonut = document.getElementById('im-modal-donut');
        if (imModalDonut) {
            const pct = Math.min(100, Math.round((weeklyTotal / weekGoal) * 100));
            imModalDonut.style.setProperty('--ring-pct', pct);
            imModalDonut.style.setProperty('--ring-color', isGoalMet ? '#22c55e' : '#38bdf8');
        }

        const calloutTitle = document.getElementById('im-callout-title');
        const calloutDesc = document.getElementById('im-callout-desc');
        if (calloutTitle && calloutDesc) {
            if (isGoalMet) {
                calloutTitle.textContent = 'Intensity Minutes Goal Met!';
                calloutDesc.innerHTML = `<span style="color: #22c55e;">🎉 Weekly goal of ${weekGoal} minutes completed!</span>`;
            } else {
                calloutTitle.textContent = 'To reach your weekly goal, you need:';
                calloutDesc.innerHTML = `<strong style="color: #4ade80;">${neededMod} min</strong> Moderate <span style="color: #64748b;">OR</span> <strong style="color: #38bdf8;">${neededVig} min</strong> Vigorous`;
            }
        }

        // Bottom Stats
        window.safeSetText('im-drilldown-total-label', 'Total Minutes');
        window.safeSetText('im-drilldown-mod-label', 'Moderate Minutes');
        window.safeSetText('im-drilldown-vig-label', 'Vigorous Minutes (2x)');
        window.safeSetText('im-drilldown-goal-label', 'Weekly Goal');

        window.safeSetText('im-drilldown-total', `${weeklyTotal} min`);
        window.safeSetText('im-drilldown-moderate', `${weeklyMod} min`);
        window.safeSetText('im-drilldown-vigorous', `${weeklyVig} min`);
        window.safeSetText('im-drilldown-goal', `${weekGoal} min`);

        const days = data.days || [];
        const xLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const linePoints = [];
        let goalMetIdx = null;

        for (let i = 0; i < 7; i++) {
            const d = days[i];
            if (!d || d.isFuture || d.cumulativeTotal == null) {
                linePoints.push(null);
            } else {
                const val = d.cumulativeTotal;
                linePoints.push(val);
                if (val >= weekGoal && goalMetIdx === null && val > 0) {
                    goalMetIdx = i;
                }
            }
        }

        const lineColor = isGoalMet ? '#22c55e' : '#38bdf8';
        const yAxisMax = Math.max(500, Math.ceil((weeklyTotal + 60) / 100) * 100);

        window.chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: xLabels,
                datasets: [
                    {
                        label: 'Weekly Goal',
                        data: Array(7).fill(weekGoal),
                        borderColor: 'rgba(148, 163, 184, 0.7)',
                        borderDash: [6, 4],
                        borderWidth: 1.5,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        fill: false
                    },
                    {
                        label: isGoalMet ? 'Intensity Minutes Goal Met' : 'Intensity Minutes',
                        data: linePoints,
                        borderColor: lineColor,
                        backgroundColor: isGoalMet ? 'rgba(34, 197, 94, 0.1)' : 'rgba(56, 189, 248, 0.1)',
                        borderWidth: 3,
                        stepped: 'before',
                        pointRadius: (c) => (c.raw != null ? 4 : 0),
                        pointBackgroundColor: lineColor,
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 1.5,
                        pointHoverRadius: 6,
                        goalMetIndices: goalMetIdx !== null ? [goalMetIdx] : [],
                        spanGaps: false,
                        fill: false
                    }
                ]
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
                            generateLabels: () => [
                                { text: 'Weekly Goal', strokeStyle: 'rgba(148, 163, 184, 0.8)', lineWidth: 2, lineDash: [4, 4], fillStyle: 'transparent' },
                                { text: 'Intensity Minutes', fillStyle: '#38bdf8', strokeStyle: '#38bdf8', lineWidth: 2 },
                                { text: 'Goal Met ✓', fillStyle: '#22c55e', strokeStyle: '#22c55e', lineWidth: 2 }
                            ]
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const idx = items[0].dataIndex;
                                const dayObj = days[idx];
                                return dayObj ? `${dayObj.dayName} (${dayObj.date})` : xLabels[idx];
                            },
                            label: (c) => {
                                if (c.dataset.label === 'Weekly Goal') return `Weekly Goal: ${weekGoal} min`;
                                if (c.parsed.y == null) return null;
                                const dayObj = days[c.dataIndex] || {};
                                const lines = [`Cumulative Total: ${c.parsed.y} min`];
                                if (dayObj.total > 0) {
                                    lines.push(`  Today: +${dayObj.total} min (${dayObj.moderate} mod, ${dayObj.vigorous * 2} vig)`);
                                }
                                return lines;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { size: 12, weight: '600' } }
                    },
                    y: {
                        beginAtZero: true,
                        max: yAxisMax,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', stepSize: 100 }
                    }
                }
            }
        });

    } else if (range === '1m') {
        // ── 4 WEEKS: Daily Totals (28 Days with Weekly Resets) ─────────────────
        if (weeklySummaryEl) weeklySummaryEl.style.display = 'none';
        if (chartTitleEl) chartTitleEl.textContent = 'Daily Totals';

        const sum = data.summary || {};
        const weekGoal = sum.goal || goal;

        window.safeSetText('im-drilldown-total-label', 'Avg Daily Total');
        window.safeSetText('im-drilldown-mod-label', 'Avg Daily Moderate');
        window.safeSetText('im-drilldown-vig-label', 'Avg Daily Vigorous');
        window.safeSetText('im-drilldown-goal-label', 'Weekly Goal');

        window.safeSetText('im-drilldown-total', `${sum.avgDailyTotal || 0} min`);
        window.safeSetText('im-drilldown-moderate', `${sum.avgDailyModerate || 0} min`);
        window.safeSetText('im-drilldown-vigorous', `${sum.avgDailyVigorous || 0} min`);
        window.safeSetText('im-drilldown-goal', `${weekGoal} min`);

        const allDays = data.allDays || [];
        const weeks = data.weeks || [];

        // Build 28 labels: display date on Mondays, empty for others
        const xLabels = [];
        for (let i = 0; i < 28; i++) {
            const d = allDays[i];
            if (i % 7 === 0 && d) {
                xLabels.push(d.label || d.date);
            } else {
                xLabels.push('');
            }
        }

        const datasets = [];
        let maxObserved = weekGoal;

        // Baseline: Weekly Goal dashed line
        datasets.push({
            label: 'Weekly Goal',
            data: Array(28).fill(weekGoal),
            borderColor: 'rgba(148, 163, 184, 0.7)',
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false
        });

        // 4 Weekly cumulative step lines
        weeks.forEach((wObj, wIdx) => {
            const wPoints = Array(28).fill(null);
            let goalMetIdx = null;
            let hasData = false;

            (wObj.days || []).forEach((d, dIdx) => {
                const globalIdx = wIdx * 7 + dIdx;
                if (!d.isFuture && d.cumulativeTotal != null) {
                    wPoints[globalIdx] = d.cumulativeTotal;
                    hasData = true;
                    if (d.cumulativeTotal > maxObserved) maxObserved = d.cumulativeTotal;
                    if (d.cumulativeTotal >= weekGoal && goalMetIdx === null && d.cumulativeTotal > 0) {
                        goalMetIdx = globalIdx;
                    }
                }
            });

            if (hasData) {
                const isMet = wObj.isGoalMet;
                const lineColor = isMet ? '#22c55e' : '#38bdf8';
                datasets.push({
                    label: isMet ? `Week ${wIdx + 1} (Goal Met)` : `Week ${wIdx + 1}`,
                    data: wPoints,
                    borderColor: lineColor,
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    stepped: 'before',
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    goalMetIndices: goalMetIdx !== null ? [goalMetIdx] : [],
                    spanGaps: false
                });
            }
        });

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
                            generateLabels: () => [
                                { text: 'Weekly Goal', strokeStyle: 'rgba(148, 163, 184, 0.8)', lineWidth: 2, lineDash: [4, 4], fillStyle: 'transparent' },
                                { text: 'Intensity Minutes', fillStyle: '#38bdf8', strokeStyle: '#38bdf8', lineWidth: 2 },
                                { text: 'Goal Met ✓', fillStyle: '#22c55e', strokeStyle: '#22c55e', lineWidth: 2 }
                            ]
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const idx = items[0].dataIndex;
                                const d = allDays[idx];
                                return d ? `${d.dayName}, ${d.date}` : `Day ${idx + 1}`;
                            },
                            label: (c) => {
                                if (c.dataset.label === 'Weekly Goal') return `Weekly Goal: ${weekGoal} min`;
                                if (c.parsed.y == null) return null;
                                const d = allDays[c.dataIndex] || {};
                                const lines = [`Cumulative Week Total: ${c.parsed.y} min`];
                                if (d.total > 0) {
                                    lines.push(`  Today: +${d.total} min (${d.moderate} mod, ${d.vigorous * 2} vig)`);
                                }
                                return lines;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: (c) => (c && typeof c.index === 'number' && c.index % 7 === 0 ? 'rgba(255, 255, 255, 0.18)' : 'transparent'),
                            lineWidth: (c) => (c && typeof c.index === 'number' && c.index % 7 === 0 ? 1.5 : 0)
                        },
                        ticks: { color: '#94a3b8', font: { size: 11 } }
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

    } else {
        // ── 1 YEAR (or 6m): Weekly Totals (52-week Layered Bar Chart) ──────────
        if (weeklySummaryEl) weeklySummaryEl.style.display = 'none';
        if (chartTitleEl) chartTitleEl.textContent = 'Weekly Totals';

        const sum = data.summary || {};
        const weekGoal = sum.goal || goal;

        window.safeSetText('im-drilldown-total-label', 'Avg Weekly Total');
        window.safeSetText('im-drilldown-mod-label', 'Avg Weekly Moderate');
        window.safeSetText('im-drilldown-vig-label', 'Avg Weekly Vigorous');
        window.safeSetText('im-drilldown-goal-label', 'Weekly Goal');

        window.safeSetText('im-drilldown-total', `${sum.avgWeeklyTotal || 0} min`);
        window.safeSetText('im-drilldown-moderate', `${sum.avgWeeklyModerate || 0} min`);
        window.safeSetText('im-drilldown-vigorous', `${sum.avgWeeklyVigorous || 0} min`);
        window.safeSetText('im-drilldown-goal', `${weekGoal} min`);

        const history = data.history || [];
        let maxObserved = weekGoal;
        history.forEach(w => {
            if (w.total > maxObserved) maxObserved = w.total;
        });

        // X-axis labels: Format dates to month abbreviations
        let lastMonth = '';
        const xLabels = history.map(w => {
            const dt = window.parseLocalDate(w.date);
            const m = dt.toLocaleDateString([], { month: 'short' });
            if (m !== lastMonth) {
                lastMonth = m;
                return m;
            }
            return '';
        });

        const yAxisMax = Math.max(1000, Math.ceil((maxObserved + 100) / 200) * 200);

        window.chartInstances[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: xLabels,
                datasets: [
                    {
                        label: 'Goal Baseline',
                        data: history.map(() => weekGoal),
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        borderRadius: 3,
                        barPercentage: 0.85,
                        categoryPercentage: 0.85,
                        grouped: false,
                        order: 2
                    },
                    {
                        label: 'Weekly Minutes',
                        data: history.map(w => w.total),
                        backgroundColor: history.map(w => (w.total >= (w.goal || weekGoal) ? '#22c55e' : '#38bdf8')),
                        borderRadius: 3,
                        barPercentage: 0.85,
                        categoryPercentage: 0.85,
                        grouped: false,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            color: '#94a3b8',
                            boxWidth: 14,
                            generateLabels: () => [
                                { text: 'Weekly Goal (420 min)', fillStyle: 'rgba(255, 255, 255, 0.15)', strokeStyle: 'transparent' },
                                { text: 'Under Goal', fillStyle: '#38bdf8', strokeStyle: '#38bdf8' },
                                { text: 'Goal Met ✓', fillStyle: '#22c55e', strokeStyle: '#22c55e' }
                            ]
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const w = history[items[0].dataIndex];
                                return w ? `Week of ${w.date}` : '';
                            },
                            label: (c) => {
                                if (c.dataset.label === 'Goal Baseline') return null;
                                const w = history[c.dataIndex] || {};
                                const isMet = w.total >= (w.goal || weekGoal);
                                return `Total: ${w.total} min ${isMet ? '(Goal Met ✓)' : ''} / Goal: ${w.goal || weekGoal} min`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 10 }, autoSkip: false }
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
    }
    } catch (err) {
        console.error('Error in renderIntensityMinutesVisualV2:', err);
    }
};
