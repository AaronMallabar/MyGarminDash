/**
 * Health Metrics: HRV & Intensity Minutes Logic
 */

window.currentHRVEndDate = new Date();
window.currentHRVRange = '1d';
window.currentIMRange = '1d';

window.updateHRVRange = async function (range, btn) {
    if (range) window.currentHRVRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    if (window.fetchHRVHistory) await window.fetchHRVHistory();
}


window.shiftHRVDate = function (dir) {
    if (window.shiftDate) window.shiftDate('HRV', dir);
}


// Note: currentHRVRange, currentHRVEndDate are managed globally in index.html or health.js
// renderHRVVisual is now handled by charts.js which has the more advanced gauge/feedback logic.


window.updateIMRange = async function (range, btn) {
    if (range) window.currentIMRange = range;
    if (btn) {
        btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    if (window.fetchIMHistory) await window.fetchIMHistory();
}

window.shiftIMDate = function (dir) {
    if (window.shiftDate) window.shiftDate('IM', dir);
}


window.renderIntensityMinutesVisualV2 = function (data) {
    const canvasId = 'imHistoryChart';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window.chartInstances[canvasId]) window.chartInstances[canvasId].destroy();

    const range = data.range || window.currentIMRange;
    const history = data.history || [];
    const goal = data.goal || 150;

    if (history.length > 0) {
        let thisWeekTotal = 0;
        for (let i = history.length - 1; i >= 0; i--) {
            const d = history[i];
            const dt = window.parseLocalDate(d.date);
            thisWeekTotal += d.total;
            if (dt.getDay() === 1) break;
        }
        window.safeSetText('im-val', thisWeekTotal);
        window.safeSetText('im-goal', goal);
    }

    if (range === '1d') {
        const points = (data.samples || []).map(s => ({ x: s[0], y: s[1] }));
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
                    fill: true,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { type: 'time', time: { displayFormats: { hour: 'HH:mm' } }, grid: { display: false }, ticks: { color: '#94a3b8' } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    } else if (range === '6m' || range === '1y') {
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
        const weeks_seg = [];
        let curWeek = [];
        history.forEach(d => {
            const dt = window.parseLocalDate(d.date);
            if (dt.getDay() === 1 && curWeek.length > 0) {
                weeks_seg.push(curWeek);
                curWeek = [];
            }
            curWeek.push(d);
        });
        if (curWeek.length > 0) weeks_seg.push(curWeek);

        const dsLabels = history.map(d => {
            const dt = window.parseLocalDate(d.date);
            if (dt.getDay() === 1) return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
            if (range === '1w') return dt.toLocaleDateString([], { weekday: 'short' });
            return '';
        });

        const dsDatasets = weeks_seg.map((week, idx) => {
            let cumulative = 0;
            const weekData = history.map(h => {
                const dayInWeek = week.find(w => w.date === h.date);
                if (dayInWeek) {
                    cumulative += dayInWeek.total;
                    return cumulative;
                }
                return null;
            });
            const isGoalMet = cumulative >= goal;
            const color = isGoalMet ? '#4ade80' : '#38bdf8';
            return {
                label: `Week ${idx + 1}`,
                data: weekData,
                borderColor: color,
                borderWidth: 3,
                pointRadius: 0,
                stepped: idx === weeks_seg.length - 1 ? 'before' : false,
                fill: false,
                spanGaps: false
            };
        });

        dsDatasets.push({
            label: 'Weekly Goal',
            data: history.map(() => goal),
            borderColor: 'rgba(255, 255, 255, 0.3)',
            borderDash: [5, 5],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            order: 0
        });

        window.chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { labels: dsLabels, datasets: dsDatasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', autoSkip: false } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }
}
