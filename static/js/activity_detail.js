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
    const isStrength = type.includes('strength');
    const prefix = `stage-${basic.activityId}`;
    const summary = data.summary || basic;

    const div = document.createElement('div');
    div.className = 'activity-stage';
    div.style.paddingTop = '1.5rem';
    div.style.borderTop = '1px solid rgba(255,255,255,0.05)';
    div.style.marginBottom = '2rem';

    // Context-aware labels
    const distLabel = isStrength ? 'Calories' : 'Distance';
    const distValue = isStrength ? (summary.calories || '--') + ' kcal' : (summary.distance / 1609.34).toFixed(2) + ' mi';

    const durLabel = 'Duration';
    const durValue = Math.round(summary.duration / 60) + ' min';

    const paceLabel = isStrength ? 'Work Time' : (isCycle ? 'Speed' : 'Pace');
    const workTimeS = summary.movingDuration || summary.activeTime || (data.exercise_sets?.exerciseSets?.filter(s => s.setType === 'ACTIVE').reduce((sum, s) => sum + (s.duration || 0), 0)) || 0;
    const paceValue = isStrength
        ? (workTimeS ? Math.round(workTimeS / 60) + ' min' : '--')
        : (isCycle ? (summary.averageSpeed * 2.23694).toFixed(1) + ' mph' : (data.avg_pace_str || '--'));

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

    let pbHtml = '';
    const hasBests = data.bests && (data.bests.is_run || data.bests.is_bike);
    if (hasBests) {
        const isBike = data.bests.is_bike;
        const chartId = `${prefix}-activityBestsChart`;

        // Build the compact data table
        let tableRows = '';
        if (isBike && data.bests.power) {
            const labels = {'5': '5s', '30': '30s', '60': '1m', '120': '2m', '300': '5m', '600': '10m', '1200': '20m', '1800': '30m', '3600': '60m'};
            const keys = ['5', '30', '60', '120', '300', '600', '1200', '1800', '3600'];
            keys.forEach(k => {
                const val = data.bests.power[k];
                if (val && val > 0) {
                    tableRows += `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.6rem; background: rgba(15, 23, 42, 0.5); border-radius: 0.4rem; border: 1px solid rgba(255,255,255,0.03);">
                            <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">${labels[k]}</span>
                            <span style="font-size: 0.8rem; font-weight: 800; color: white;">${val}<span style="font-size: 0.6rem; opacity: 0.5; margin-left: 2px;">W</span></span>
                        </div>`;
                }
            });
        }
        if (!isBike && data.bests.pace) {
            const labels = {'1mi': '1 Mile', '5k': '5K', '5mi': '5 Mile'};
            Object.keys(data.bests.pace).forEach(k => {
                const s = data.bests.pace[k];
                if (s && s > 0) {
                    const m = Math.floor(s / 60);
                    const sec = Math.floor(s % 60).toString().padStart(2, '0');
                    tableRows += `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.6rem; background: rgba(15, 23, 42, 0.5); border-radius: 0.4rem; border: 1px solid rgba(255,255,255,0.03);">
                            <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">${labels[k]}</span>
                            <span style="font-size: 0.8rem; font-weight: 800; color: white;">${m}:${sec}<span style="font-size: 0.6rem; opacity: 0.5; margin-left: 2px;">/mi</span></span>
                        </div>`;
                }
            });
        }

        if (tableRows) {
            pbHtml = `
                <div style="margin-top: 1.5rem;">
                    <h4 style="color: var(--accent-color); margin-bottom: 1rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="display: inline-block; width: 3px; height: 14px; background: var(--accent-color); border-radius: 2px;"></span>
                        ${isBike ? 'Power Curve' : 'Pace Analysis'}
                    </h4>
                    <div style="display: grid; grid-template-columns: 1.4fr 1fr; gap: 1.5rem; align-items: start;">
                        <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 1rem; padding: 1rem; height: 280px; position: relative;">
                            <canvas id="${chartId}"></canvas>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 0.3rem; max-height: 280px; overflow-y: auto;">
                            ${tableRows}
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // Strength Sets Support
    let strengthHtml = '';
    const muscleStats = data.muscle_stats || {};

    // --- High Fidelity Image Based Muscle Map ---
    const renderMuscleMap = () => {
        const muscleFiles = [
            'abs', 'biceps', 'calves', 'chest', 'delts', 'forearms', 'glutes', 'hamstrings',
            'lats', 'lowerback', 'obliques', 'quads', 'shoulders', 'traps', 'triceps', 'upperback',
            'hipflexors'
        ];

        // Mapping from stats keys to file names
        const fileMap = {
            'Abs': 'abs', 'Core': 'abs', 'Chest': 'chest', 'Pectorals': 'chest',
            'Shoulders': 'delts', 'Deltoids': 'delts', 'Shoulder': 'delts',
            'Biceps': 'biceps', 'Forearms': 'forearms', 'Quads': 'quads',
            'Upper Quad': 'quads', 'Lower Quad': 'quads', 'Obliques': 'obliques',
            'Glutes': 'glutes', 'Hamstrings': 'hamstrings', 'Lower Back': 'lowerback',
            'Upper Back': 'upperback', 'Lats': 'lats', 'Latissimus': 'lats',
            'Triceps': 'triceps', 'Calves': 'calves', 'Traps': 'traps',
            'Hip Flexors': 'hipflexors'
        };

        let highlightHtml = '';
        const addedFiles = new Set();

        Object.entries(muscleStats).forEach(([muscle, stat]) => {
            const fileName = fileMap[muscle];
            if (fileName && stat.priority === 'primary' && !addedFiles.has(fileName)) {
                highlightHtml += `<img src="/static/images/muscle_map/highlights/${fileName}.png" class="muscle-highlight active-primary" title="${muscle}: ${stat.reps} reps">`;
                addedFiles.add(fileName);
            }
        });

        return `
            <div class="muscle-map-container tech-grid" style="padding: 1.5rem; background: rgba(0,0,0,0.5);">
                <div style="position: relative; width: 100%; height: 100%; display: flex; justify-content: center;">
                    <img src="/static/images/muscle_map/musclemap.png" class="muscle-base">
                    ${highlightHtml}
                    <div class="muscle-view-label">Primary Load Distribution</div>
                </div>
            </div>
        `;
    };

    if (data.exercise_sets) {
        const activeSets = (data.exercise_sets.exerciseSets || []).filter(s => s.setType === 'ACTIVE');

        if (activeSets.length > 0) {
            const prioritizedMuscles = Object.entries(muscleStats)
                .sort((a, b) => b[1].seconds - a[1].seconds);

            strengthHtml = `
                <div class="strength-dashboard" data-view-mode="time" style="margin-top: 2rem; display: grid; grid-template-columns: 1fr 1.5fr; gap: 2.5rem; animation: fadeIn 0.8s ease-out;">
                    <!-- Body Map Column -->
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-secondary); letter-spacing: 0.1em; display: flex; align-items: center; gap: 0.5rem;">
                            <span style="width: 8px; height: 8px; background: var(--accent-color); border-radius: 50%; box-shadow: 0 0 10px var(--accent-color);"></span>
                            Primary Anatomy Profile
                        </div>
                        ${renderMuscleMap()}
                    </div>
                    
                    <!-- Performance Data Column -->
                    <div style="display: flex; flex-direction: column; gap: 2.5rem;">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.75rem;">
                                <h4 style="margin: 0; color: var(--text-primary); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 800;">
                                    Target Loadings
                                </h4>
                                <!-- Metrics Toggle -->
                                <div class="metrics-toggle" style="display: flex; background: rgba(0,0,0,0.3); padding: 2px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);">
                                    <button onclick="this.closest('.strength-dashboard').setAttribute('data-view-mode', 'time')" class="toggle-btn active" style="padding: 4px 12px; border: none; border-radius: 18px; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; cursor: pointer; background: transparent; color: var(--text-secondary); transition: all 0.3s;">Time</button>
                                    <button onclick="this.closest('.strength-dashboard').setAttribute('data-view-mode', 'reps')" class="toggle-btn" style="padding: 4px 12px; border: none; border-radius: 18px; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; cursor: pointer; background: transparent; color: var(--text-secondary); transition: all 0.3s;">Reps</button>
                                </div>
                            </div>
                            
                            <div class="muscle-stats-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem;">
                                ${prioritizedMuscles.map(([m, s]) => `
                                    <div class="muscle-stat-row" style="padding: 1.25rem; border-radius: 1rem; border: 1px solid rgba(255,255,255,0.05); background: rgba(30, 41, 59, 0.2); display: flex; justify-content: space-between; align-items: center;">
                                        <div style="flex: 1;">
                                            <div style="font-weight: 800; color: var(--accent-color); font-size: 0.95rem; text-transform: uppercase;">${m}</div>
                                            <div class="mode-time" style="font-size: 0.7rem; color: var(--text-secondary);">${Math.round(s.seconds / 60)}m Primary Work</div>
                                            <div class="mode-reps" style="font-size: 0.7rem; color: var(--text-secondary); display: none;">${s.reps} Reps Target</div>
                                        </div>
                                        <div style="text-align: right; min-width: 45px;">
                                            <div class="mode-time" style="font-size: 1.4rem; font-weight: 900; line-height: 1;">${Math.round(s.seconds / 60)}<span style="font-size: 0.6rem; margin-left: 2px; opacity: 0.5;">m</span></div>
                                            <div class="mode-reps" style="font-size: 1.4rem; font-weight: 900; line-height: 1; display: none;">${s.reps}</div>
                                            <div style="font-size: 0.55rem; text-transform: uppercase; color: var(--accent-color); opacity: 0.7; font-weight: 700; margin-top: 2px;" class="mode-label">Unit</div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <div>
                            <h4 style="margin-bottom: 1.25rem; color: var(--text-secondary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700;">Detailed Set Logistics</h4>
                            <div class="splits-container" style="max-height: 280px; overflow-y: auto; border-radius: 1rem; border: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.2);">
                                <table class="splits-table">
                                    <thead>
                                        <tr>
                                            <th>Exercise</th>
                                            <th>Reps</th>
                                            <th>Weight</th>
                                            <th>Time</th>
                                            <th>Targeted</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${activeSets.map(s => {
                const uniqueNames = [...new Set(s.exercises.map(ex => ex.name || ex.category).filter(n => n))];
                let exName = uniqueNames.join(', ');
                if (!exName) exName = 'Exercise';
                const weightLbs = s.weight ? (s.weight * 0.00220462).toFixed(1) + ' lbs' : '--';
                const timeStr = window.formatDuration(s.duration || 0);
                const targets = (s.targeted_muscles || []).join(', ') || '--';
                return `
                                                <tr>
                                                    <td style="font-weight: 600; font-size: 0.85rem;">${exName}</td>
                                                    <td style="font-weight: 800; font-size: 0.95rem; color: var(--text-primary); text-align: center;">${s.repetitionCount || '--'}</td>
                                                    <td style="color: var(--text-secondary); font-weight: 700; font-size: 0.85rem;">${weightLbs}</td>
                                                    <td style="font-size: 0.85rem; color: var(--text-secondary);">${timeStr}</td>
                                                    <td style="color: var(--accent-color); font-weight: 800; font-size: 0.75rem; text-transform: uppercase;">${targets}</td>
                                                </tr>
                                            `;
            }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    div.innerHTML = `
        ${num ? `<h3 style="color: var(--accent-color); margin-bottom: 1rem;">Stage ${num}: ${basic.activityName}</h3>` : ''}
        <div class="activity-detail-grid">
            <div class="activity-detail-card"><div class="activity-detail-label">${distLabel}</div><div class="activity-detail-value">${distValue}</div></div>
            <div class="activity-detail-card"><div class="activity-detail-label">${durLabel}</div><div class="activity-detail-value">${durValue}</div></div>
            <div class="activity-detail-card"><div class="activity-detail-label">${paceLabel}</div><div class="activity-detail-value">${paceValue}</div></div>
            <div class="activity-detail-card"><div class="activity-detail-label">Avg HR</div><div class="activity-detail-value">${summary.averageHR ? Math.round(summary.averageHR) : '--'} bpm</div></div>
        </div>
        ${strengthHtml}
        ${pbHtml}
        <div class="stage-charts" style="margin-top: 2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
            ${isStrength ? '' : `<div class="small-chart-container"><div class="chart-label">Elevation</div><canvas id="${prefix}-activityElevChart"></canvas></div>`}
            <div class="small-chart-container"><div class="chart-label">Heart Rate</div><canvas id="${prefix}-activityHrChart"></canvas></div>
            ${isStrength ? '' : `<div class="small-chart-container"><div class="chart-label">${isRun ? 'Pace' : 'Speed'}</div><canvas id="${prefix}-activitySpeedChart"></canvas></div>`}
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
        // Render the activity-specific bests chart (power curve / pace)
        if (hasBests && window.renderActivityBestsChart) {
            const chartId = `${prefix}-activityBestsChart`;
            window.renderActivityBestsChart(chartId, data.bests, data.bests.is_bike);
        }
    }, 100);
}

