/**
 * Comparison Studio & Multi-Metric Analytics Suite
 * Interactive side-by-side bar charts, scatter plots, and cumulative comparisons
 */

window.comparisonChart = null;
window.comparisonData = null;

window.compareState = {
    preset: 'this_vs_last_month',
    period_a: '',
    period_b: '',
    sport: 'cycling',
    metric: 'distance',
    chartType: 'bar' // 'bar' | 'scatter' | 'cumulative'
};

window.setCompareChartType = function (type) {
    window.compareState.chartType = type || 'bar';
    document.querySelectorAll('#compare-chart-type-toggle .toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-chart') === type);
    });
    if (window.comparisonData) {
        window.renderComparisonChart(window.comparisonData);
    }
};

window.setComparePreset = function (preset) {
    window.compareState.preset = preset;
    document.querySelectorAll('#compare-preset-group .range-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-preset') === preset);
    });

    const customRow = document.getElementById('compare-custom-pickers');
    if (customRow) {
        customRow.style.display = preset === 'custom' ? 'flex' : 'none';
    }

    // Auto-calculate period keys based on preset
    const months = window.comparisonAvailableMonths || [];
    const years = window.comparisonAvailableYears || [];

    if (preset === 'this_vs_last_month') {
        // If current month has minimal activities (< 2), default to last full month vs month before
        if (months.length >= 2) {
            window.compareState.period_a = months[0];
            window.compareState.period_b = months[1];
        }
    } else if (preset === 'this_vs_last_year_month') {
        if (months.length > 0) {
            const currentM = months[0];
            const targetPrevYear = (parseInt(currentM.slice(0, 4)) - 1) + currentM.slice(4);
            window.compareState.period_a = currentM;
            window.compareState.period_b = months.includes(targetPrevYear) ? targetPrevYear : (months[12] || months[1]);
        }
    } else if (preset === 'this_vs_last_year') {
        if (years.length >= 2) {
            window.compareState.period_a = years[0];
            window.compareState.period_b = years[1];
        }
    }

    // Sync select dropdown values if custom pickers exist
    const selA = document.getElementById('compare-custom-a');
    const selB = document.getElementById('compare-custom-b');
    if (selA && window.compareState.period_a) selA.value = window.compareState.period_a;
    if (selB && window.compareState.period_b) selB.value = window.compareState.period_b;

    window.runComparisonQuery();
};

window.runComparisonQuery = async function () {
    const sportSel = document.getElementById('compare-sport-select');
    const metricSel = document.getElementById('compare-metric-select');
    if (sportSel) window.compareState.sport = sportSel.value;
    if (metricSel) window.compareState.metric = metricSel.value;

    if (window.compareState.preset === 'custom') {
        const selA = document.getElementById('compare-custom-a');
        const selB = document.getElementById('compare-custom-b');
        if (selA) window.compareState.period_a = selA.value;
        if (selB) window.compareState.period_b = selB.value;
    }

    const params = new URLSearchParams({
        period_a: window.compareState.period_a || '',
        period_b: window.compareState.period_b || '',
        sport: window.compareState.sport,
        metric: window.compareState.metric,
        preset: window.compareState.preset
    });

    const loadingEl = document.getElementById('compare-chart-loading');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
        const res = await fetch(`/api/analytics/compare?${params.toString()}`);
        if (!res.ok) throw new Error('Comparison API error');
        const payload = await res.json();

        // Save available periods on first run
        if (payload.available_months && !window.comparisonAvailableMonths) {
            window.comparisonAvailableMonths = payload.available_months;
            window.comparisonAvailableYears = payload.available_years;
            window.populateCustomPickers(payload.available_months, payload.available_years);
        }

        window.comparisonData = payload.data;
        window.renderScorecards(payload.data);
        window.renderComparisonChart(payload.data);
    } catch (err) {
        console.error('Failed to load comparison analytics:', err);
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
};

window.populateCustomPickers = function (months, years) {
    const selA = document.getElementById('compare-custom-a');
    const selB = document.getElementById('compare-custom-b');
    if (!selA || !selB) return;

    let html = '<optgroup label="Months">';
    months.forEach(m => {
        const dt = new Date(m + '-02');
        const label = dt.toLocaleDateString([], { month: 'short', year: 'numeric' });
        html += `<option value="${m}">${label}</option>`;
    });
    html += '</optgroup><optgroup label="Full Years">';
    years.forEach(y => {
        html += `<option value="${y}">${y} (Full Year)</option>`;
    });
    html += '</optgroup>';

    selA.innerHTML = html;
    selB.innerHTML = html;

    if (window.compareState.period_a) selA.value = window.compareState.period_a;
    if (window.compareState.period_b) selB.value = window.compareState.period_b;
};

window.renderScorecards = function (data) {
    const container = document.getElementById('compare-scorecards-grid');
    if (!container || !data) return;

    const pa = data.period_a;
    const pb = data.period_b;
    const unit = data.unit;
    const delta = data.delta;
    const deltaPct = data.delta_pct;
    const isPositive = delta > 0;
    const isZero = delta === 0;

    let deltaColor = isPositive ? 'var(--success-color)' : 'var(--danger-color)';
    let deltaSign = isPositive ? '+' : '';
    let deltaIcon = isPositive ? '📈' : '📉';
    if (isZero) {
        deltaColor = 'var(--text-secondary)';
        deltaIcon = '⚖️';
    }

    container.innerHTML = `
        <div class="card glance-card" style="padding: 1rem; border-left: 3px solid #38bdf8; background: rgba(30, 41, 59, 0.45);">
            <div style="font-size: 0.72rem; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">
                ${pa.label}
            </div>
            <div style="font-size: 1.6rem; font-weight: 800; color: #fff; margin-bottom: 0.2rem;">
                ${pa.summary} <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">${unit}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">
                ${pa.acts_count} activities recorded
            </div>
        </div>

        <div class="card glance-card" style="padding: 1rem; border-left: 3px solid #c084fc; background: rgba(30, 41, 59, 0.45);">
            <div style="font-size: 0.72rem; font-weight: 700; color: #c084fc; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">
                ${pb.label}
            </div>
            <div style="font-size: 1.6rem; font-weight: 800; color: #fff; margin-bottom: 0.2rem;">
                ${pb.summary} <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">${unit}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">
                ${pb.acts_count} activities recorded
            </div>
        </div>

        <div class="card glance-card" style="padding: 1rem; border-left: 3px solid ${deltaColor}; background: rgba(30, 41, 59, 0.45);">
            <div style="font-size: 0.72rem; font-weight: 700; color: ${deltaColor}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; display: flex; justify-content: space-between;">
                <span>${deltaIcon} Difference (Delta)</span>
                <span>${deltaSign}${deltaPct}%</span>
            </div>
            <div style="font-size: 1.6rem; font-weight: 800; color: ${deltaColor}; margin-bottom: 0.2rem;">
                ${deltaSign}${delta} <span style="font-size: 0.85rem; font-weight: 600; opacity: 0.8;">${unit}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">
                ${isPositive ? 'Ahead of comparison period' : (isZero ? 'Equal to comparison period' : 'Behind comparison period')}
            </div>
        </div>
    `;
};

window.renderComparisonChart = function (data) {
    const canvas = document.getElementById('comparisonStudioChart');
    if (!canvas || !data) return;

    if (window.comparisonChart) {
        window.comparisonChart.destroy();
        window.comparisonChart = null;
    }

    const ctx = canvas.getContext('2d');
    const chartType = window.compareState.chartType;
    const pa = data.period_a;
    const pb = data.period_b;
    const unit = data.unit;

    if (chartType === 'scatter') {
        // Scatter Plot: plots every individual workout
        window.comparisonChart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: pa.label,
                        data: data.scatter_a,
                        backgroundColor: '#38bdf8',
                        borderColor: '#0284c7',
                        borderWidth: 2,
                        pointRadius: 6,
                        pointHoverRadius: 9
                    },
                    {
                        label: pb.label,
                        data: data.scatter_b,
                        backgroundColor: '#c084fc',
                        borderColor: '#9333ea',
                        borderWidth: 2,
                        pointRadius: 6,
                        pointHoverRadius: 9
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (evt, elements) => {
                    if (elements && elements.length > 0) {
                        const el = elements[0];
                        const pt = window.comparisonChart.data.datasets[el.datasetIndex].data[el.index];
                        if (pt && pt.id && window.openActivityDetail) {
                            window.openActivityDetail(pt.id, {
                                activityId: pt.id,
                                activityName: pt.name,
                                startTimeLocal: pt.date
                            });
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: data.labels.length > 12 ? 'Day of the Month (1–31)' : 'Month',
                            color: '#94a3b8',
                            font: { family: 'Inter', size: 12, weight: 600 }
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    },
                    y: {
                        title: {
                            display: true,
                            text: `${data.metric.toUpperCase()} (${unit})`,
                            color: '#94a3b8',
                            font: { family: 'Inter', size: 12, weight: 600 }
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: '#e2e8f0', font: { family: 'Inter', weight: 600 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            title: (items) => {
                                const pt = items[0].raw;
                                return pt.name || 'Workout';
                            },
                            label: (item) => {
                                const pt = item.raw;
                                return [
                                    `📅 Date: ${pt.date}`,
                                    `📊 ${data.metric}: ${pt.y} ${unit}`,
                                    `📏 Distance: ${pt.dist} mi`,
                                    `⚡ Speed: ${pt.spd} mph`,
                                    `⏱️ Duration: ${pt.dur} min`,
                                    `👆 Click to view full activity`
                                ];
                            }
                        }
                    }
                }
            }
        });
    } else if (chartType === 'cumulative') {
        // Cumulative progression line chart
        window.comparisonChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: `${pa.label} (Cumulative)`,
                        data: data.cum_a,
                        borderColor: '#38bdf8',
                        backgroundColor: 'rgba(56, 189, 248, 0.12)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.25,
                        pointRadius: 2,
                        pointHoverRadius: 6
                    },
                    {
                        label: `${pb.label} (Cumulative)`,
                        data: data.cum_b,
                        borderColor: '#c084fc',
                        backgroundColor: 'rgba(192, 132, 252, 0.06)',
                        borderWidth: 2.5,
                        borderDash: [5, 5],
                        fill: true,
                        tension: 0.25,
                        pointRadius: 2,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    },
                    y: {
                        title: {
                            display: true,
                            text: `Cumulative ${data.metric.toUpperCase()} (${unit})`,
                            color: '#94a3b8'
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    }
                },
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
    } else {
        // Default: Side-by-Side Grouped Bar Chart
        window.comparisonChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: pa.label,
                        data: data.bars_a,
                        backgroundColor: 'rgba(56, 189, 248, 0.85)',
                        borderColor: '#38bdf8',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: pb.label,
                        data: data.bars_b,
                        backgroundColor: 'rgba(192, 132, 252, 0.85)',
                        borderColor: '#c084fc',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    },
                    y: {
                        title: {
                            display: true,
                            text: `${data.metric.toUpperCase()} (${unit})`,
                            color: '#94a3b8'
                        },
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
                            label: (item) => `${item.dataset.label}: ${item.raw} ${unit}`
                        }
                    }
                }
            }
        });
    }
};

// Initialize Studio on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    // Run comparison query after dashboard initializes
    setTimeout(() => {
        if (window.runComparisonQuery) {
            window.setComparePreset('this_vs_last_month');
        }
    }, 400);
});
