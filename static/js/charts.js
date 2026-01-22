/**
 * Chart Rendering Functions
 * All Chart.js visualization logic
 */

// Global chart instances
const chartInstances = {};

function renderYTDChart(canvasId, labels, data) {
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

        let currentWeightEndDate = new Date();
        let currentWeightRange = '1m';
        async function updateWeightRange(range, btn) {
            if (range) currentWeightRange = range;
            if (btn) {
                btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            try {
                const res = await fetch(`/api/weight_history?range=${currentWeightRange}&end_date=${getLocalDateStr(currentWeightEndDate)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) renderWeightChart(data, currentWeightRange);
                }
            } catch (err) { console.error('Weight history error:', err); }
        }

        function renderWeightChart(history, range) {
            const canvasId = 'weightHistoryChart';
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

            const weights = history.map(d => d.weight_lbs);
            const min = Math.floor(Math.min(...weights) - 2);
            const max = Math.ceil(Math.max(...weights) + 2);

            chartInstances[canvasId] = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{ label: 'Weight (lbs)', data: history.map(d => ({ x: d.date, y: d.weight_lbs })), borderColor: '#818cf8', backgroundColor: 'rgba(129, 140, 248, 0.1)', borderWidth: 3, tension: 0.3, pointRadius: 3, fill: true }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `Weight: ${ctx.parsed.y.toFixed(1)} lbs` } } },
                    scales: {
                        x: { type: 'time', time: { unit: 'month' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                        y: { min, max, ticks: { color: '#94a3b8', callback: v => v + ' lbs' }, grid: { color: 'rgba(255,255,255,0.1)' } }
                    }
                }
            });
        }

        let currentStepsEndDate = new Date();
        let currentStepsRange = '1w';
        async function updateStepsRange(range, btn) {
            if (range) currentStepsRange = range;
            if (btn) {
                btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            try {
                const res = await fetch(`/api/steps_history?range=${currentStepsRange}&end_date=${getLocalDateStr(currentStepsEndDate)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) renderStepsVisual(data);
                }
            } catch (err) { console.error('Steps history error:', err); }
        }

        function renderStepsVisual(data) {
            const canvasId = 'stepsHistoryChart';
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const donutContainer = document.getElementById('steps-donut-container');
            const streakEl = document.getElementById('steps-streak');
            if (streakEl) streakEl.textContent = data.streak || 0;

            if (data.range === '1d') {
                if (canvas) canvas.style.display = 'none';
                if (donutContainer) donutContainer.style.display = 'flex';
                const day = data.history[data.history.length - 1] || { totalSteps: 0, stepGoal: 10000 };
                const percent = Math.min(100, Math.round((day.totalSteps / day.stepGoal) * 100));
                safeSetText('steps', day.totalSteps.toLocaleString());
                safeSetText('steps-day-percent', percent + '%');
                const chart = document.getElementById('steps-day-chart');
                if (chart) chart.style.background = `conic-gradient(${percent >= 100 ? 'var(--success-color)' : 'var(--accent-color)'} 0% ${percent}%, rgba(255,255,255,0.1) ${percent}% 100%)`;
            } else {
                if (canvas) canvas.style.display = 'block';
                if (donutContainer) donutContainer.style.display = 'none';
                if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

                chartInstances[canvasId] = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: data.history.map(d => { const p = d.calendarDate.split('-'); return `${p[1]}/${p[2]}`; }),
                        datasets: [{ label: 'Steps', data: data.history.map(d => d.totalSteps), backgroundColor: data.history.map(d => d.totalSteps >= d.stepGoal ? '#4ade80' : '#38bdf8'), borderRadius: 4 }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `Steps: ${ctx.parsed.y.toLocaleString()}` } } },
                        scales: {
                            x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 7 } },
                            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                        }
                    }
                });
            }
        }

        let currentHREndDate = new Date();
        let currentHRRange = '1d';
        async function updateHRRange(range, btn) {
            if (range) currentHRRange = range;
            if (btn) {
                btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            try {
                const res = await fetch(`/api/hr_history?range=${currentHRRange}&end_date=${getLocalDateStr(currentHREndDate)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) renderHRVisual(data);
                }
            } catch (err) { console.error('HR history error:', err); }
        }

        function renderHRVisual(data) {
            const canvasId = 'hrHistoryChart';
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

            if (data.range === '1d') {
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
                chartInstances[canvasId] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.history.map(d => d.date),
                        datasets: [
                            { label: 'Resting HR', data: data.history.map(d => d.rhr), borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', borderWidth: 3, fill: true, tension: 0.3 },
                            { label: 'Max HR', data: data.history.map(d => d.max), borderColor: '#ef4444', borderDash: [5, 5], borderWidth: 2, pointRadius: 2, tension: 0.3 }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                            zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } },
                            legend: { display: true, position: 'top', labels: { color: '#94a3b8', boxWidth: 12 } }
                        },
                        scales: {
                            x: { type: 'time', time: { unit: 'day' }, grid: { display: false }, ticks: { color: '#94a3b8' } },
                            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                        }
                    }
                });
            }
        }

        let currentStressEndDate = new Date();
        let currentStressRange = '1d';
        async function updateStressRange(range, btn) {
            if (range) currentStressRange = range;
            if (btn) {
                btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            try {
                const res = await fetch(`/api/stress_history?range=${currentStressRange}&end_date=${getLocalDateStr(currentStressEndDate)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) renderStressVisual(data);
                }
            } catch (err) { console.error('Stress history error:', err); }
        }

        function renderStressVisual(data) {
            const canvasId = 'stressHistoryChart';
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

            if (data.range === '1d') {
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
                chartInstances[canvasId] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.history.map(d => d.date),
                        datasets: [
                            { label: 'Avg Stress', data: data.history.map(d => d.avg), borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', borderWidth: 3, fill: true, tension: 0.3 },
                            { label: 'Max Stress', data: data.history.map(d => d.max), borderColor: '#ef4444', borderDash: [5, 5], borderWidth: 2, pointRadius: 2, tension: 0.3 }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                            zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } },
                            legend: { display: true, labels: { color: '#94a3b8' } }
                        },
                        scales: {
                            x: { type: 'time', time: { unit: 'day' }, grid: { display: false }, ticks: { color: '#94a3b8' } },
                            y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                        }
                    }
                });
            }
        }

        let currentSleepEndDate = new Date();
        let currentSleepRange = '1d';
        async function updateSleepRange(range, btn) {
            if (range) currentSleepRange = range;
            if (btn) {
                btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            try {
                const res = await fetch(`/api/sleep_history?range=${currentSleepRange}&end_date=${getLocalDateStr(currentSleepEndDate)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) renderSleepVisual(data);
                }
            } catch (err) { console.error('Sleep history error:', err); }
        }

        function renderSleepVisual(data) {
            const canvasId = 'sleepHistoryChart';
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

            if (data.range === '1d') {
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
                            legend: { display: true, position: 'right', labels: { color: '#94a3b8', boxWidth: 12, padding: 20 } },
                            tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${Math.floor(ctx.raw / 3600)}h ${Math.round((ctx.raw % 3600) / 60)}m` } }
                        }
                    }
                });
            } else {
                chartInstances[canvasId] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.history.map(d => d.date),
                        datasets: [{ label: 'Sleep Score', data: data.history.map(d => d.score), borderColor: '#818cf8', backgroundColor: 'rgba(129, 140, 248, 0.1)', borderWidth: 3, fill: true, tension: 0.3, pointRadius: 4 }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false }, zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } } },
                        scales: {
                            x: { type: 'time', time: { unit: 'day' }, grid: { display: false }, ticks: { color: '#94a3b8' } },
                            y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                        }
                    }
                });
            }
        }

        let currentHydrationRange = '1d';
        let currentHydrationEndDate = new Date();
        async function updateHydrationRange(range, btn) {
            if (range) currentHydrationRange = range;
            if (btn) { btn.parentElement.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
            const donut = document.getElementById('hydration-donut-container');
            const hChartCanvas = document.getElementById('hydrationHistoryChart');
            if (donut) donut.style.display = currentHydrationRange === '1d' ? 'block' : 'none';
            if (hChartCanvas) hChartCanvas.style.display = currentHydrationRange === '1d' ? 'none' : 'block';
            await renderHydrationVisual();
        }

        async function renderHydrationVisual() {
            try {
                const res = await fetch(`/api/hydration_history?range=${currentHydrationRange}&end_date=${getLocalDateStr(currentHydrationEndDate)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.error) return;
                    const oz = (ml) => (ml * 0.033814).toFixed(1);
                    if (currentHydrationRange === '1d') {
                        const p = Math.min(100, Math.round((data.summary.intake / data.summary.goal) * 100));
                        safeSetText('hydration-val', oz(data.summary.intake) + ' oz');
                        safeSetText('hydration-goal', 'Goal: ' + oz(data.summary.goal) + ' oz');
                        safeSetText('hydration-percent', p + '%');
                        const hChart = document.getElementById('hydration-chart');
                        if (hChart) hChart.style.background = `conic-gradient(${p >= 100 ? '#22c55e' : '#38bdf8'} ${p}%, rgba(255,255,255,0.05) ${p}% 100%)`;
                    } else {
                        const ctx = document.getElementById('hydrationHistoryChart').getContext('2d');
                        if (chartInstances['hydrationHistoryChart']) chartInstances['hydrationHistoryChart'].destroy();
                        chartInstances['hydrationHistoryChart'] = new Chart(ctx, {
                            type: 'bar',
                            data: { labels: data.history.map(d => parseLocalDate(d.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })), datasets: [{ label: 'oz', data: data.history.map(d => parseFloat(oz(d.intake))), backgroundColor: data.history.map(d => d.intake >= d.goal ? '#22c55e' : '#38bdf8'), borderRadius: 6 }] },
                            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } }
                        });
                    }
                }
            } catch (err) { console.error('Hydration error:', err); }
        }

        function shiftHydrationDate(dir) {
            currentHydrationEndDate.setDate(currentHydrationEndDate.getDate() + (dir * (currentHydrationRange === '1d' ? 1 : 7)));
            if (currentHydrationEndDate > new Date()) currentHydrationEndDate = new Date();
            renderHydrationVisual();
        }

        // --- Activity Modal & Detail Charts ---

        async function openActivityDetail(id, basic) {
            const modal = document.getElementById('activityModal');
            if (!modal) return;
            modal.classList.add('active');

            const isRun = basic.activityType.typeKey.toLowerCase().includes('run');
            const isCycle = basic.activityType.typeKey.toLowerCase().includes('cycling') || basic.activityType.typeKey.toLowerCase().includes('ride');

            safeSetText('modal-title', basic.activityName);
            safeSetText('modal-date', new Date(basic.startTimeLocal).toLocaleString());
            safeSetText('modal-distance', formatDualDistance(basic.distance / 1609.34));
            safeSetText('modal-duration', Math.round(basic.duration / 60) + ' min');
            safeSetText('modal-hr', basic.averageHR ? Math.round(basic.averageHR) + ' bpm' : '--');
            safeSetText('modal-calories', Math.round(basic.calories) + ' kcal');

            // Immediate population from basic summary data
            if (basic.elevationGain !== undefined) {
                const gainFeet = Math.round(basic.elevationGain * 3.28084);
                const gainMeters = Math.round(basic.elevationGain);
                safeSetText('modal-elevation', `${gainFeet} ft / ${gainMeters} m`);
            } else {
                safeSetText('modal-elevation', '--');
            }

            const basicCadence = basic.averageBikingCadenceInRevPerMinute || basic.averageRunningCadenceInStepsPerMinute || basic.averageCadence;
            if (basicCadence) {
                safeSetText('modal-cadence', Math.round(basicCadence) + (isRun ? ' spm' : ' rpm'));
            } else {
                safeSetText('modal-cadence', '--');
            }

            // Initial pace/speed from basic data
            if (isCycle) {
                safeSetText('modal-pace-label', 'Avg Speed');
                const mph = (basic.averageSpeed * 2.23694).toFixed(1);
                safeSetText('modal-pace', mph + ' mph');
            } else {
                safeSetText('modal-pace-label', 'Overall Pace');
                safeSetText('modal-pace', '--');
            }

            try {
                const res = await fetch(`/api/activity/${id}`);
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) {
                        const hasPower = data.charts.power && data.charts.power.length > 0 && data.charts.power.some(p => p > 0);
                        const powerCard = document.getElementById('power-summary-card');
                        const powerChartBox = document.getElementById('power-chart-container');
                        const powerTitle = document.getElementById('power-title');

                        if (powerCard) powerCard.style.display = hasPower ? 'block' : 'none';
                        if (powerChartBox) powerChartBox.style.display = hasPower ? 'block' : 'none';
                        if (powerTitle) powerTitle.style.display = hasPower ? 'block' : 'none';

                        if (hasPower && data.summary.averagePower) {
                            safeSetText('modal-power', Math.round(data.summary.averagePower) + ' W');
                        }

                        // Update with refined data if available
                        if (data.summary.elevationGain !== undefined) {
                            const gainFeet = Math.round(data.summary.elevationGain * 3.28084);
                            const gainMeters = Math.round(data.summary.elevationGain);
                            safeSetText('modal-elevation', `${gainFeet} ft / ${gainMeters} m`);
                        }

                        const avgCadence = data.summary.averageBikeCadence || data.summary.averageRunCadence || data.summary.averageCadence ||
                            data.summary.averageBikingCadenceInRevPerMinute || data.summary.averageRunningCadenceInStepsPerMinute;
                        if (avgCadence) {
                            safeSetText('modal-cadence', Math.round(avgCadence) + (isRun ? ' spm' : ' rpm'));
                        }

                        // Refined pace/speed if detailed data is available
                        if (!isCycle) {
                            safeSetText('modal-pace', data.avg_pace_str || '--');
                        }

                        renderActivityCharts(data.charts, isRun, isCycle);
                    }
                }
            } catch (err) { console.error('Activity detail error:', err); }
        }

        function closeModal() { document.getElementById('activityModal').classList.remove('active'); }

        const activityChartIds = ['activityElevChart', 'activityHrChart', 'activityCadenceChart', 'activityPowerChart', 'activitySpeedChart'];
        function syncActivityCharts(source) {
            const { min, max } = source.scales.x;
            activityChartIds.forEach(id => {
                const chart = chartInstances[id];
                if (chart && chart !== source) { chart.options.scales.x.min = min; chart.options.scales.x.max = max; chart.update('none'); }
            });
        }

        function renderActivityCharts(charts, isRun, isCycle) {
            if (!charts.timestamps) return;
            const start = new Date(charts.timestamps[0]).getTime();
            const elapsed = charts.timestamps.map(t => (new Date(t).getTime() - start) / 1000);

            renderDetailChart('activityElevChart', elapsed, charts.elevation.map(e => e * 3.28084), 'Elevation', '#94a3b8', 'ft');
            renderDetailChart('activityHrChart', elapsed, charts.heart_rate, 'Heart Rate', '#f87171', 'bpm');
            renderDetailChart('activityCadenceChart', elapsed, charts.cadence, isRun ? 'spm' : 'rpm', '#4ade80', '');

            if (charts.power && charts.power.length > 0) {
                renderDetailChart('activityPowerChart', elapsed, charts.power, 'Power', '#a855f7', 'W', false, getPowerZoneColor);
            }

            if (isRun) renderDetailChart('activitySpeedChart', elapsed, charts.speed.map(s => s > 0.5 ? 26.8224 / s : null), 'Pace', '#38bdf8', '/mi', true);
            else renderDetailChart('activitySpeedChart', elapsed, charts.speed.map(s => s * 2.23694), 'Speed', '#38bdf8', 'mph');
        }

        function renderDetailChart(id, x, y, label, color, unit, rev = false, colorFunc = null) {
            const canvas = document.getElementById(id);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (chartInstances[id]) chartInstances[id].destroy();

            const dataset = {
                label,
                data: y,
                borderColor: color,
                backgroundColor: color + '22',
                fill: true,
                pointRadius: 0,
                tension: 0.4
            };

            if (colorFunc) {
                dataset.segment = {
                    borderColor: ctx => colorFunc(ctx.p1.parsed.y),
                    backgroundColor: ctx => colorFunc(ctx.p1.parsed.y) + '44' // ~25% opacity
                };
            }

            chartInstances[id] = new Chart(ctx, {
                type: 'line',
                data: { labels: x, datasets: [dataset] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, zoom: { pan: { enabled: true, mode: 'x', onPan: (c) => syncActivityCharts(c.chart) }, zoom: { wheel: { enabled: true }, mode: 'x', onZoom: (c) => syncActivityCharts(c.chart) } } },
                    scales: {
                        y: { reverse: rev, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: v => v ? v.toFixed(1) + ' ' + unit : '' } },
                        x: { type: 'linear', ticks: { color: '#94a3b8', callback: v => formatDuration(v) }, grid: { display: false } }
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

        