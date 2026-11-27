/**
 * Training Data Viewer & Analytics Explorer
 * Multi-span, multi-bucket (days/weeks/months/years), cumulative or per-bucket,
 * with Cycling vs Running, Power, Speed, Pace, Elevation, HR, and Dual-Axis Overlays.
 */

window.comparisonChart = null;
window.exploreData = null;

window.exploreState = {
    span: '3m',
    bucket: 'auto',
    sport: 'cycling_vs_running',
    metric: 'distance',
    overlay: 'none',
    accumulate: false,
    chartType: 'bar' // 'bar' | 'line' | 'scatter'
};

window.setExploreSpan = function (span) {
    window.exploreState.span = span;
    document.querySelectorAll('#explore-span-group .range-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-span') === span);
    });
    const customRow = document.getElementById('explore-custom-dates');
    if (customRow) {
        customRow.style.display = span === 'custom' ? 'flex' : 'none';
        if (span === 'custom') {
            const endInput = document.getElementById('explore-end-date');
            const startInput = document.getElementById('explore-start-date');
            const todayStr = window.getEasternDateStr ? window.getEasternDateStr() : window.getLocalDateStr();
            if (endInput && !endInput.value) endInput.value = todayStr;
            if (startInput && !startInput.value) {
                const d = window.parseLocalDate ? window.parseLocalDate(todayStr) : new Date();
                d.setDate(d.getDate() - 30);
                startInput.value = window.getLocalDateStr(d);
            }
            return;
        }
    }
    window.runExploreQuery();
};

window.setExploreBucket = function (bucket) {
    window.exploreState.bucket = bucket || 'auto';
    document.querySelectorAll('#explore-bucket-group .range-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-bucket') === bucket);
    });
    window.runExploreQuery();
};

window.toggleExploreAccumulate = function () {
    window.exploreState.accumulate = !window.exploreState.accumulate;
    const btn = document.getElementById('explore-accumulate-btn');
    if (btn) {
        btn.classList.toggle('active', window.exploreState.accumulate);
        btn.textContent = window.exploreState.accumulate ? '📈 Accumulate: ON' : '📈 Accumulate: OFF';
    }
    window.runExploreQuery();
};

window.setExploreChartType = function (type) {
    window.exploreState.chartType = type || 'bar';
    document.querySelectorAll('#compare-chart-type-toggle .toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-chart') === type);
    });
    if (window.exploreData) {
        window.renderExploreChart(window.exploreData);
    }
};

window.runExploreQuery = async function () {
    const sportSel = document.getElementById('compare-sport-select');
    const metricSel = document.getElementById('compare-metric-select');
    const overlaySel = document.getElementById('explore-overlay-select');
    if (sportSel) window.exploreState.sport = sportSel.value;
    if (metricSel) window.exploreState.metric = metricSel.value;
    if (overlaySel) window.exploreState.overlay = overlaySel.value;

    const params = new URLSearchParams({
        span: window.exploreState.span,
        bucket: window.exploreState.bucket,
        sport: window.exploreState.sport,
        metric: window.exploreState.metric,
        overlay: window.exploreState.overlay,
        accumulate: window.exploreState.accumulate ? 'true' : 'false'
    });

    if (window.exploreState.span === 'custom') {
        const s = document.getElementById('explore-start-date')?.value;
        const e = document.getElementById('explore-end-date')?.value;
        if (s) params.set('start_date', s);
        if (e) params.set('end_date', e);
    }

    const loadingEl = document.getElementById('compare-chart-loading');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
        const res = await fetch(`/api/analytics/explore?${params.toString()}`);
        if (!res.ok) throw new Error('Explore API error');
        const payload = await res.json();
        window.exploreData = payload;

        const cap = document.getElementById('explore-span-caption');
        if (cap && payload.summary?.span_label) {
            cap.textContent = `${payload.summary.span_label} • by ${payload.bucket}`;
        }

        window.renderExploreScorecards(payload);
        window.renderExploreChart(payload);
        if (window.initMobileCarousels) window.initMobileCarousels();
    } catch (err) {
        console.error('Failed to load training data explorer:', err);
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
};

function formatPace(minPerMi) {
    if (!minPerMi || minPerMi <= 0) return '--';
    const mins = Math.floor(minPerMi);
    const secs = Math.round((minPerMi - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

window.renderExploreScorecards = function (payload) {
    const container = document.getElementById('compare-scorecards-grid');
    if (!container || !payload || !payload.summary) return;
    const s = payload.summary;

    container.innerHTML = `
        <div class="card glance-card" style="padding: 1rem; border-left: 3px solid #38bdf8; background: rgba(30, 41, 59, 0.45); min-height: auto;">
            <div style="font-size: 0.72rem; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem;">
                📏 Total Distance
            </div>
            <div style="font-size: 1.55rem; font-weight: 800; color: #fff; margin-bottom: 0.2rem;">
                ${s.total_miles.toLocaleString()} <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">mi</span>
            </div>
            <div style="font-size: 0.76rem; color: var(--text-secondary);">
                🚴 ${s.cycling_miles} mi • 🏃 ${s.running_miles} mi
            </div>
        </div>

        <div class="card glance-card" style="padding: 1rem; border-left: 3px solid #4ade80; background: rgba(30, 41, 59, 0.45); min-height: auto;">
            <div style="font-size: 0.72rem; font-weight: 700; color: #4ade80; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem;">
                ⚡ Speed &amp; Pace
            </div>
            <div style="font-size: 1.55rem; font-weight: 800; color: #fff; margin-bottom: 0.2rem;">
                ${s.avg_speed_mph ?? '--'} <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">mph</span>
            </div>
            <div style="font-size: 0.76rem; color: var(--text-secondary);">
                Run Pace: ${formatPace(s.avg_pace_min_mi)} /mi
            </div>
        </div>

        <div class="card glance-card" style="padding: 1rem; border-left: 3px solid #f59e0b; background: rgba(30, 41, 59, 0.45); min-height: auto;">
            <div style="font-size: 0.72rem; font-weight: 700; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem;">
                🔋 Power &amp; Heart Rate
            </div>
            <div style="font-size: 1.55rem; font-weight: 800; color: #fff; margin-bottom: 0.2rem;">
                ${s.avg_power_w ?? '--'} <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">W</span>
            </div>
            <div style="font-size: 0.76rem; color: var(--text-secondary);">
                Avg HR: ${s.avg_hr ?? '--'} bpm
            </div>
        </div>

        <div class="card glance-card" style="padding: 1rem; border-left: 3px solid #c084fc; background: rgba(30, 41, 59, 0.45); min-height: auto;">
            <div style="font-size: 0.72rem; font-weight: 700; color: #c084fc; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem;">
                ⏱️ Volume &amp; Climb
            </div>
            <div style="font-size: 1.55rem; font-weight: 800; color: #fff; margin-bottom: 0.2rem;">
                ${s.total_hours} <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">hrs</span>
            </div>
            <div style="font-size: 0.76rem; color: var(--text-secondary);">
                ${s.workouts} workouts • ${s.elevation_ft.toLocaleString()} ft • ${s.calories.toLocaleString()} kcal
            </div>
        </div>
    `;
};

window.renderExploreChart = function (payload) {
    const canvas = document.getElementById('comparisonStudioChart');
    if (!canvas || !payload || !payload.series) return;

    if (window.comparisonChart) {
        window.comparisonChart.destroy();
        window.comparisonChart = null;
    }

    const ctx = canvas.getContext('2d');
    const chartType = window.exploreState.chartType;
    const ser = payload.series;
    const unit = ser.unit || '';
    const hasOverlay = Array.isArray(ser.overlay) && ser.overlay.length > 0;

    if (chartType === 'scatter') {
        const ptsCycling = (payload.workouts || []).filter(w => w.sport === 'cycling').map(w => ({ x: w.bucket_idx, y: w.y, ...w }));
        const ptsRunning = (payload.workouts || []).filter(w => w.sport === 'running').map(w => ({ x: w.bucket_idx, y: w.y, ...w }));
        const ptsOther = (payload.workouts || []).filter(w => w.sport !== 'cycling' && w.sport !== 'running').map(w => ({ x: w.bucket_idx, y: w.y, ...w }));

        const datasets = [];
        if (ptsCycling.length) datasets.push({ label: 'Cycling', data: ptsCycling, backgroundColor: '#38bdf8', pointRadius: 6, pointHoverRadius: 9 });
        if (ptsRunning.length) datasets.push({ label: 'Running', data: ptsRunning, backgroundColor: '#f97316', pointRadius: 6, pointHoverRadius: 9 });
        if (ptsOther.length) datasets.push({ label: 'Other', data: ptsOther, backgroundColor: '#a855f7', pointRadius: 6, pointHoverRadius: 9 });

        window.comparisonChart = new Chart(ctx, {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (evt, elements) => {
                    if (elements && elements.length > 0) {
                        const el = elements[0];
                        const pt = window.comparisonChart.data.datasets[el.datasetIndex].data[el.index];
                        if (pt && pt.id && window.openActivityDetail) {
                            window.openActivityDetail(pt.id, { activityId: pt.id, activityName: pt.name, startTimeLocal: pt.date });
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        max: Math.max(0, (payload.labels || []).length - 1),
                        ticks: {
                            color: '#94a3b8',
                            stepSize: 1,
                            maxTicksLimit: 10,
                            callback: (val) => (payload.labels && payload.labels[Math.round(val)]) || ''
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    y: {
                        title: { display: true, text: `${payload.metric.toUpperCase()} (${unit})`, color: '#94a3b8' },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#e2e8f0', font: { family: 'Inter', weight: 600 } } },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        borderWidth: 1,
                        callbacks: {
                            title: (items) => items[0]?.raw?.name || 'Workout',
                            label: (item) => {
                                const pt = item.raw;
                                const lines = [`📅 ${pt.date}`, `📊 ${payload.metric}: ${pt.y} ${unit}`, `📏 ${pt.dist} mi • ⏱️ ${pt.dur} min`];
                                if (pt.spd) lines.push(`⚡ ${pt.spd} mph`);
                                if (pt.pwr) lines.push(`🔋 ${pt.pwr} W`);
                                if (pt.hr) lines.push(`❤️ ${pt.hr} bpm`);
                                return lines;
                            }
                        }
                    }
                }
            }
        });
        return;
    }

    const isLine = chartType === 'line' || window.exploreState.accumulate;
    const datasets = [
        {
            label: `${ser.primary_label} (${unit})`,
            data: ser.primary,
            type: isLine ? 'line' : 'bar',
            backgroundColor: isLine ? 'rgba(56, 189, 248, 0.14)' : 'rgba(56, 189, 248, 0.85)',
            borderColor: '#38bdf8',
            borderWidth: isLine ? 2.5 : 1,
            borderRadius: isLine ? 0 : 4,
            fill: isLine,
            tension: 0.25,
            pointRadius: isLine ? 2.5 : 0,
            yAxisID: 'y',
            spanGaps: true
        }
    ];

    if (Array.isArray(ser.secondary)) {
        datasets.push({
            label: `${ser.secondary_label} (${unit})`,
            data: ser.secondary,
            type: isLine ? 'line' : 'bar',
            backgroundColor: isLine ? 'rgba(249, 115, 22, 0.14)' : 'rgba(249, 115, 22, 0.85)',
            borderColor: '#f97316',
            borderWidth: isLine ? 2.5 : 1,
            borderRadius: isLine ? 0 : 4,
            fill: isLine,
            tension: 0.25,
            pointRadius: isLine ? 2.5 : 0,
            yAxisID: 'y',
            spanGaps: true
        });
    }

    if (hasOverlay) {
        datasets.push({
            label: `${ser.overlay_label} (${ser.overlay_unit})`,
            data: ser.overlay,
            type: 'line',
            borderColor: '#4ade80',
            backgroundColor: 'rgba(74, 222, 128, 0.1)',
            borderWidth: 2,
            borderDash: [4, 4],
            tension: 0.25,
            pointRadius: 2.5,
            yAxisID: 'y1',
            spanGaps: true
        });
    }

    const scales = {
        x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8', maxRotation: 40, autoSkip: true, maxTicksLimit: 12 }
        },
        y: {
            position: 'left',
            title: { display: true, text: `${payload.metric.toUpperCase()} (${unit})`, color: '#94a3b8' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8' }
        }
    };

    if (hasOverlay) {
        scales.y1 = {
            position: 'right',
            title: { display: true, text: `${ser.overlay_label.toUpperCase()} (${ser.overlay_unit})`, color: '#4ade80' },
            grid: { drawOnChartArea: false },
            ticks: { color: '#4ade80' }
        };
    }

    window.comparisonChart = new Chart(ctx, {
        type: isLine ? 'line' : 'bar',
        data: { labels: payload.labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales,
            plugins: {
                legend: { labels: { color: '#e2e8f0', font: { family: 'Inter', weight: 600 } } },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    borderWidth: 1
                }
            }
        }
    });
};

// Backwards-compatible aliases if anything still calls old names
window.runComparisonQuery = window.runExploreQuery;

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.runExploreQuery) {
            window.runExploreQuery();
        }
    }, 350);
});
