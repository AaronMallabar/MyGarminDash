/**
 * Activity Detail Modal & Stage Rendering
 */

window.openActivityDetail = async function (id, basic) {
    const modal = document.getElementById('activityModal');
    if (!modal) return;
    modal.classList.add('active');

    const aiSection = document.getElementById('modal-ai-insight');
    const aiContent = document.getElementById('modal-ai-content');
    if (aiSection) aiSection.style.display = 'none';
    if (aiContent) aiContent.innerHTML = '<div class="loading"></div>';

    const dynamicBody = document.getElementById('modal-dynamic-body');
    if (dynamicBody) dynamicBody.innerHTML = '<div style="text-align:center; padding: 2rem;"><div class="loading"></div></div>';

    window.safeSetText('modal-title', basic.activityName);
    window.safeSetText('modal-date', new Date(basic.startTimeLocal).toLocaleString());

    // AI Insight
    if (aiSection && aiContent) {
        const insight = (window.cachedActivityInsights || {})[id];
        if (insight) {
            aiSection.style.display = 'block';
            aiContent.innerHTML = `
                <div style="background: rgba(56, 189, 248, 0.1); border-left: 3px solid var(--accent-color); padding: 0.75rem 1rem; margin-bottom: 1rem; border-radius: 0 0.5rem 0.5rem 0; font-style: italic; font-weight: 500;">
                    🌟 Highlight: ${window.parseMarkdown(insight.highlight || 'Performance recorded.')}
                </div>
                <p><strong>Recap:</strong> ${window.parseMarkdown(insight.was)}</p>
                <p><strong>Coach's Tip:</strong> ${window.parseMarkdown(insight.better_next)}</p>
            `;
        } else {
            aiSection.style.display = 'none';
        }
    }

    try {
        const ids = basic.is_grouped ? (basic.grouped_ids || [id]) : [id];
        const results = await Promise.all(ids.map(sid => fetch(`/api/activity/${sid}`).then(r => r.json())));

        if (dynamicBody) dynamicBody.innerHTML = '';
        let polylines = [];

        results.forEach((data, index) => {
            if (!data || data.error) return;
            const stageBasic = basic.is_grouped ? (basic.grouped_activities[index] || basic) : basic;
            window.renderStage(data, stageBasic, basic.is_grouped ? index + 1 : null);
            if (data.polyline) polylines = polylines.concat(data.polyline);
        });

        if (polylines.length > 0 && window.renderActivityMap) {
            window.renderActivityMap(polylines);
        }
    } catch (err) {
        console.error('Modal error:', err);
        if (dynamicBody) dynamicBody.innerHTML = '<div style="color: var(--danger-color); text-align:center;">Failed to load details.</div>';
    }
}

window.renderStage = function (data, basic, num) {
    const body = document.getElementById('modal-dynamic-body');
    if (!body) return;

    const type = (basic.activityType?.typeKey || '').toLowerCase();
    const isRun = type.includes('run') || type.includes('walk');
    const isCycle = type.includes('cycling') || type.includes('ride') || type.includes('virtual') || type.includes('biking');
    const prefix = `stage-${basic.activityId}`;
    const summary = data.summary || basic;

    const div = document.createElement('div');
    div.className = 'activity-stage';
    div.style.paddingTop = '1.5rem';
    div.style.borderTop = '1px solid rgba(255,255,255,0.05)';
    div.style.marginBottom = '2rem';

    const dist = (summary.distance / 1609.34).toFixed(2) + ' mi';
    const dur = Math.round(summary.duration / 60) + ' min';
    const pace = isCycle ? (summary.averageSpeed * 2.23694).toFixed(1) + ' mph' : (data.avg_pace_str || '--');

    const hasCadence = data.charts.cadence && data.charts.cadence.length > 0 && data.charts.cadence.some(c => c > 0);
    const hasPower = data.charts.power && data.charts.power.length > 0 && data.charts.power.some(p => p > 0);
    const hasSplits = data.splits && data.splits.length > 0;

    let splitsHtml = '';
    if (hasSplits) {
        splitsHtml = `
            <div class="splits-container">
                <table class="splits-table">
                    <thead>
                        <tr>
                            <th>Mile</th>
                            <th>${isCycle ? 'Speed' : 'Pace'}</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.splits.map(s => `
                            <tr>
                                <td>${s.mile}</td>
                                <td>${s.pace_str}</td>
                                <td>${window.formatDuration(s.duration)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    div.innerHTML = `
        ${num ? `<h3 style="color: var(--accent-color); margin-bottom: 1rem;">Stage ${num}: ${basic.activityName}</h3>` : ''}
        <div class="activity-detail-grid">
            <div class="activity-detail-card"><div class="activity-detail-label">Distance</div><div class="activity-detail-value">${dist}</div></div>
            <div class="activity-detail-card"><div class="activity-detail-label">Duration</div><div class="activity-detail-value">${dur}</div></div>
            <div class="activity-detail-card"><div class="activity-detail-label">Pace/Speed</div><div class="activity-detail-value">${pace}</div></div>
            <div class="activity-detail-card"><div class="activity-detail-label">Avg HR</div><div class="activity-detail-value">${summary.averageHR ? Math.round(summary.averageHR) : '--'} bpm</div></div>
        </div>
        <div class="stage-charts" style="margin-top: 2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
            <div class="small-chart-container"><div class="chart-label">Elevation</div><canvas id="${prefix}-activityElevChart"></canvas></div>
            <div class="small-chart-container"><div class="chart-label">Heart Rate</div><canvas id="${prefix}-activityHrChart"></canvas></div>
            <div class="small-chart-container"><div class="chart-label">${isRun ? 'Pace' : 'Speed'}</div><canvas id="${prefix}-activitySpeedChart"></canvas></div>
            ${hasCadence ? `<div class="small-chart-container"><div class="chart-label">${isRun ? 'Cadence' : 'RPM'}</div><canvas id="${prefix}-activityCadenceChart"></canvas></div>` : ''}
            ${hasPower ? `<div class="small-chart-container"><div class="chart-label">Power</div><canvas id="${prefix}-activityPowerChart"></canvas></div>` : ''}
        </div>
        ${splitsHtml}
    `;
    body.appendChild(div);

    // Initializing charts
    setTimeout(() => {
        if (window.renderActivityCharts) {
            window.renderActivityCharts(data.charts, isRun, isCycle, prefix);
        }
    }, 100);
}

