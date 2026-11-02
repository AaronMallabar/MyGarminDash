/**
 * Activity Detail Modal & Stage Rendering
 */

window.openActivityDetail = async function (id, basic = {}) {
    basic = basic || {};
    const modal = document.getElementById('activityModal');
    if (!modal) return;
    modal.classList.add('active');

    const aiSection = document.getElementById('modal-ai-insight');
    const aiContent = document.getElementById('modal-ai-content');
    if (aiSection) aiSection.style.display = 'none';
    if (aiContent) aiContent.innerHTML = '<div class="loading"></div>';

    const dynamicBody = document.getElementById('modal-dynamic-body');
    if (dynamicBody) dynamicBody.innerHTML = '<div style="text-align:center; padding: 2rem;"><div class="loading"></div></div>';

    window.safeSetText('modal-title', basic.activityName || 'Loading Activity...');
    window.safeSetText('modal-date', basic.startTimeLocal ? new Date(basic.startTimeLocal).toLocaleString() : '');

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
            if (!basic.activityName && data.activityName) {
                window.safeSetText('modal-title', data.activityName);
                if (data.startTimeLocal) window.safeSetText('modal-date', new Date(data.startTimeLocal).toLocaleString());
            }
            const stageBasic = basic.is_grouped 
                ? (basic.grouped_activities[index] || basic) 
                : Object.assign({}, basic, {
                    activityId: id,
                    activityName: basic.activityName || data.activityName || 'Activity',
                    startTimeLocal: basic.startTimeLocal || data.startTimeLocal || '',
                    activityType: basic.activityType || { typeKey: data.activityType || 'unknown' }
                });
            window.renderStage(data, stageBasic, basic.is_grouped ? index + 1 : null);
            if (data.polyline) polylines = polylines.concat(data.polyline);
        });

        if (polylines.length > 0 && window.renderActivityMap) {
            window.renderActivityMap(polylines);
        }
        
        // Save prefix for global reset access
        window.currentActivityPrefix = ids.length === 1 ? `stage-${ids[0]}` : null;
    } catch (err) {
        console.error('Modal error:', err);
        if (dynamicBody) dynamicBody.innerHTML = '<div style="color: var(--danger-color); text-align:center;">Failed to load details.</div>';
    }
};

window.renderStage = function (data, basic, num) {
    const body = document.getElementById('modal-dynamic-body');
    if (!body) return;

    const type = (basic.activityType?.typeKey || '').toLowerCase();
    const isRun = type.includes('run') || type.includes('walk');
    const isCycle = (window.isCyclingActivity && window.isCyclingActivity(basic)) || 
                    type.includes('cycling') || type.includes('ride') || type.includes('virtual') || 
                    type.includes('biking') || type.includes('bike') || type.includes('road') || 
                    Boolean(data.is_cycling);
    const isStrength = type.includes('strength');
    const prefix = `stage-${basic.activityId}`;
    const summary = data.summary || basic;
    const telem = data.telemetry || {};

    const div = document.createElement('div');
    div.className = `activity-stage ${prefix}-stage-wrapper`;
    div.style.paddingTop = '1.5rem';
    div.style.borderTop = '1px solid rgba(255,255,255,0.05)';
    div.style.marginBottom = '2rem';

    // Context-aware labels & Base metrics
    const distLabel = isStrength ? 'Calories' : 'Distance';
    const rawDist = summary.distance != null ? summary.distance : (basic.distance != null ? basic.distance : (data.distance != null ? data.distance : null));
    const distValue = isStrength 
        ? ((summary.calories || basic.calories || '--') + ' kcal') 
        : (rawDist != null && !isNaN(rawDist) ? (Number(rawDist) / 1609.34).toFixed(2) + ' mi' : '-- mi');

    const durLabel = 'Duration';
    const rawDur = summary.duration != null ? summary.duration : (basic.duration != null ? basic.duration : (data.duration != null ? data.duration : (summary.movingDuration || basic.movingDuration || null)));
    const durValue = rawDur != null && !isNaN(rawDur) ? Math.round(Number(rawDur) / 60) + ' min' : '-- min';

    const paceLabel = isStrength ? 'Work Time' : (isCycle ? 'Speed' : 'Pace');
    const workTimeS = summary.movingDuration || basic.movingDuration || summary.activeTime || (data.exercise_sets?.exerciseSets?.filter(s => s.setType === 'ACTIVE').reduce((sum, s) => sum + (s.duration || 0), 0)) || 0;
    
    // Speed: support Avg & Max speed
    const rawAvgSpeed = summary.averageSpeed != null ? summary.averageSpeed : (basic.averageSpeed != null ? basic.averageSpeed : (data.avg_speed != null ? data.avg_speed : null));
    const rawMaxSpeed = summary.maxSpeed != null ? summary.maxSpeed : (basic.maxSpeed != null ? basic.maxSpeed : (data.max_speed != null ? data.max_speed : null));
    
    const avgSpeedMph = (telem.speed && telem.speed.avg_mph) != null 
        ? telem.speed.avg_mph 
        : (rawAvgSpeed != null && !isNaN(rawAvgSpeed) ? (Number(rawAvgSpeed) * 2.23694).toFixed(1) : null);
    const maxSpeedMph = (telem.speed && telem.speed.max_mph) != null 
        ? telem.speed.max_mph 
        : (rawMaxSpeed != null && !isNaN(rawMaxSpeed) ? (Number(rawMaxSpeed) * 2.23694).toFixed(1) : null);

    const paceValue = isStrength
        ? (workTimeS ? Math.round(workTimeS / 60) + ' min' : '--')
        : (avgSpeedMph ? `${avgSpeedMph} mph` : (data.avg_pace_str || '--'));

    // Telemetry and load metrics
    const normPower = summary.normalizedPower || summary.normPower || telem.normalized_power;
    const ftp = telem.ftp || summary.functionalThresholdPower || 250;
    const intensityFactor = telem.intensity_factor || summary.intensityFactor || (normPower ? (normPower / ftp) : null);
    const tss = telem.training_stress_score || summary.trainingStressScore || (normPower && intensityFactor ? ((summary.duration * normPower * intensityFactor) / (ftp * 3600)) * 100 : null);
    const totalWorkKj = (telem.total_work_kj !== undefined && telem.total_work_kj !== null) 
        ? telem.total_work_kj 
        : (summary.totalWork ? Math.round(summary.totalWork > 100 ? summary.totalWork : summary.totalWork * 4.184) : null);
    const calories = summary.calories || telem.active_calories;
    
    const avgHR = summary.averageHR || (telem.cardiac_ceiling && telem.cardiac_ceiling.avg_hr);
    const maxHR = summary.maxHR || summary.maxHeartRate || (telem.cardiac_ceiling && telem.cardiac_ceiling.max_hr);
    const avgCad = summary.averageBikeCadence || summary.averageCadence || (telem.cadence && telem.cadence.avg_rpm);
    const maxCad = summary.maxBikeCadence || summary.maxCadence || (telem.cadence && telem.cadence.max_rpm);
    const weather = telem.weather || data.weather;

    const hasCadence = (data.charts.cadence && data.charts.cadence.length > 0 && data.charts.cadence.some(c => c > 0)) || Boolean(avgCad);
    const hasPower = (data.charts.power && data.charts.power.length > 0 && data.charts.power.some(p => p > 0)) || Boolean(normPower);
    const hasSplits = data.splits && data.splits.length > 0;

    // --- 1. Summary Cards Grid ---
    let summaryCardsHtml = '';
    if (isCycle) {
        summaryCardsHtml = `
            <div class="activity-detail-grid cycling-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 0.85rem; margin: 1.5rem 0;">
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Distance</div>
                    <div class="activity-detail-value" style="font-size: 1.25rem; font-weight: 800; color: #fff; margin-top: 0.2rem;">${distValue}</div>
                </div>
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Duration</div>
                    <div class="activity-detail-value" style="font-size: 1.25rem; font-weight: 800; color: #fff; margin-top: 0.2rem;">${durValue}</div>
                </div>
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;" title="Speed (Average & Peak MPH)">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Speed</div>
                    <div class="activity-detail-value" style="font-size: ${maxSpeedMph && avgSpeedMph ? '0.95rem' : '1.25rem'}; font-weight: 800; color: var(--accent-color); margin-top: ${maxSpeedMph && avgSpeedMph ? '0.35rem' : '0.2rem'}; line-height: 1.3;">
                        ${maxSpeedMph && avgSpeedMph ? `Avg: ${avgSpeedMph} | Max: ${maxSpeedMph} <span style="font-size: 0.7rem; opacity: 0.8;">mph</span>` : (avgSpeedMph ? `${avgSpeedMph} <span style="font-size: 0.7rem; opacity: 0.8;">mph</span>` : '--')}
                    </div>
                </div>
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;" title="Cardiac Ceiling (Average & Peak HR)">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Cardiac Ceiling</div>
                    <div class="activity-detail-value" style="font-size: 0.95rem; font-weight: 800; color: #f87171; margin-top: 0.35rem; line-height: 1.3;">
                        ${avgHR ? `Avg: ${Math.round(avgHR)}` : '--'}${maxHR ? ` | Max: ${Math.round(maxHR)}` : ''} <span style="font-size: 0.7rem; opacity: 0.8;">bpm</span>
                    </div>
                </div>
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;" title="Cadence (Average & Peak RPM)">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Cadence</div>
                    <div class="activity-detail-value" style="font-size: 0.95rem; font-weight: 800; color: #38bdf8; margin-top: 0.35rem; line-height: 1.3;">
                        ${avgCad ? `Avg: ${Math.round(avgCad)}` : '--'}${maxCad ? ` | Max: ${Math.round(maxCad)}` : ''} <span style="font-size: 0.7rem; opacity: 0.8;">rpm</span>
                    </div>
                </div>
                ${normPower ? `
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;" title="Garmin Normalized Power (NP)">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Norm Power (NP)</div>
                    <div class="activity-detail-value" style="font-size: 1.25rem; font-weight: 800; color: #fbbf24; margin-top: 0.2rem;">
                        ${Math.round(normPower)} <span style="font-size: 0.7rem; opacity: 0.8; font-weight: normal;">W</span>
                    </div>
                </div>
                ` : ''}
                ${intensityFactor ? `
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;" title="Intensity Factor (NP / FTP)">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Intensity Factor</div>
                    <div class="activity-detail-value" style="font-size: 1.25rem; font-weight: 800; color: #34d399; margin-top: 0.2rem;">
                        ${Number(intensityFactor).toFixed(2)}
                    </div>
                </div>
                ` : ''}
                ${tss ? `
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;" title="Training Stress Score (TSS)">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Training Stress</div>
                    <div class="activity-detail-value" style="font-size: 1.25rem; font-weight: 800; color: #a855f7; margin-top: 0.2rem;">
                        ${Number(tss).toFixed(1)} <span style="font-size: 0.7rem; opacity: 0.8; font-weight: normal;">TSS</span>
                    </div>
                </div>
                ` : ''}
                ${totalWorkKj ? `
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;" title="Mechanical Work (kJ) and Active Energy (kcal)">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Total Work</div>
                    <div class="activity-detail-value" style="font-size: 1rem; font-weight: 800; color: #fff; margin-top: 0.35rem; line-height: 1.3;">
                        ${totalWorkKj} kJ ${calories ? `<span style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">(${Math.round(calories)} kcal)</span>` : ''}
                    </div>
                </div>
                ` : (calories ? `
                <div class="activity-detail-card" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 0.85rem; text-align: center;">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Active Calories</div>
                    <div class="activity-detail-value" style="font-size: 1.25rem; font-weight: 800; color: #fff; margin-top: 0.2rem;">${Math.round(calories)} kcal</div>
                </div>
                ` : '')}
                ${weather && weather.display ? `
                <div class="activity-detail-card weather-card" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); padding: 0.85rem; border-radius: 0.85rem; text-align: center; grid-column: span 2;" title="Weather & Wind during ride">
                    <div class="activity-detail-label" style="font-size: 0.7rem; color: #10b981; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em;">Weather &amp; Wind</div>
                    <div class="activity-detail-value" style="font-size: 0.95rem; font-weight: 800; color: #6ee7b7; margin-top: 0.35rem;">
                        🌤️ ${weather.display}
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    } else {
        // Standard view for running / others
        summaryCardsHtml = `
            <div class="activity-detail-grid">
                <div class="activity-detail-card"><div class="activity-detail-label">${distLabel}</div><div class="activity-detail-value">${distValue}</div></div>
                <div class="activity-detail-card"><div class="activity-detail-label">${durLabel}</div><div class="activity-detail-value">${durValue}</div></div>
                <div class="activity-detail-card"><div class="activity-detail-label">${paceLabel}</div><div class="activity-detail-value">${paceValue}</div></div>
                <div class="activity-detail-card">
                    <div class="activity-detail-label">Heart Rate</div>
                    <div class="activity-detail-value">
                        ${maxHR && avgHR ? `Avg: ${Math.round(avgHR)} | Max: ${Math.round(maxHR)} bpm` : (avgHR ? `${Math.round(avgHR)} bpm` : '--')}
                    </div>
                </div>
            </div>
        `;
    }

    // --- 2. Enhanced 5-Mile Splits Table ---
    let splitsHtml = '';
    if (hasSplits) {
        splitsHtml = `
            <div id="${prefix}-splits-section" class="splits-container" style="margin-top: 2rem; background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.06); border-radius: 1rem; overflow: hidden;">
                <div style="padding: 1rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: space-between;">
                    <h4 style="color: var(--accent-color); margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="display: inline-block; width: 3px; height: 14px; background: var(--accent-color); border-radius: 2px;"></span>
                        ${isCycle ? '5-Mile Splits Breakdown' : 'Splits Analysis'}
                    </h4>
                    <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 700; background: rgba(255,255,255,0.05); padding: 0.2rem 0.6rem; border-radius: 1rem;">
                        ${data.splits.length} Segments
                    </span>
                </div>
                <div style="overflow-x: auto;">
                    <table class="splits-table" style="margin: 0; width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: rgba(30, 41, 59, 0.7);">
                                <th style="padding: 0.75rem 1rem; text-align: left;">Split</th>
                                <th style="padding: 0.75rem 1rem; text-align: left;">Time</th>
                                <th style="padding: 0.75rem 1rem; text-align: left;">${isCycle ? 'Speed' : 'Pace'}</th>
                                ${isCycle ? `
                                <th style="padding: 0.75rem 1rem; text-align: right;">Avg Power</th>
                                <th style="padding: 0.75rem 1rem; text-align: right;">Elev Gain</th>
                                <th style="padding: 0.75rem 1rem; text-align: right;">Avg HR</th>
                                <th style="padding: 0.75rem 1rem; text-align: right;">Cadence</th>
                                ` : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${data.splits.map(s => `
                                <tr style="border-top: 1px solid rgba(255,255,255,0.04);">
                                    <td style="padding: 0.75rem 1rem; font-weight: 700; color: #fff;">
                                        ${s.split_label || ('Mile ' + s.mile)}
                                    </td>
                                    <td style="padding: 0.75rem 1rem; font-variant-numeric: tabular-nums; color: var(--text-secondary); font-weight: 600;">
                                        ${s.time_str || window.formatDuration(s.duration)}
                                    </td>
                                    <td style="padding: 0.75rem 1rem; font-weight: 700; color: var(--accent-color);">
                                        ${s.speed_str || s.pace_str}
                                    </td>
                                    ${isCycle ? `
                                    <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 700; color: #fbbf24;">
                                        ${s.avg_power_str || (s.avg_power ? s.avg_power + ' W' : '--')}
                                    </td>
                                    <td style="padding: 0.75rem 1rem; text-align: right; color: #34d399; font-weight: 600;">
                                        ${s.elev_gain_str || (s.elev_gain_ft ? '+' + s.elev_gain_ft + ' ft' : '0 ft')}
                                    </td>
                                    <td style="padding: 0.75rem 1rem; text-align: right; color: #f87171; font-weight: 600;">
                                        ${s.avg_hr_str || (s.avg_hr ? s.avg_hr + ' bpm' : '--')}
                                    </td>
                                    <td style="padding: 0.75rem 1rem; text-align: right; color: #38bdf8; font-weight: 600;">
                                        ${s.avg_cadence_str || (s.avg_cadence ? s.avg_cadence + ' rpm' : '--')}
                                    </td>
                                    ` : ''}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // --- 3. Intensity & Zone Distribution ---
    let zonesHtml = '';
    const pz = (telem.power_zones || []).filter(z => z.seconds > 0 || (telem.power_zones && telem.power_zones.some(x => x.seconds > 0)));
    const hz = (telem.hr_zones || []).filter(z => z.seconds > 0 || (telem.hr_zones && telem.hr_zones.some(x => x.seconds > 0)));

    if (pz.length > 0 || hz.length > 0) {
        const renderStackedBar = (zones) => `
            <div class="zone-stacked-bar" style="display: flex; width: 100%; height: 10px; border-radius: 5px; overflow: hidden; background: rgba(0,0,0,0.3); margin-bottom: 1.25rem; border: 1px solid rgba(255,255,255,0.05);">
                ${zones.map(z => z.percent > 0 ? `
                    <div style="width: ${z.percent}%; background: ${z.color}; transition: width 0.5s;" title="Z${z.zone} ${z.name}: ${z.minutes}m (${z.percent}%)"></div>
                ` : '').join('')}
            </div>
        `;

        const renderZoneList = (zones) => zones.map(z => `
            <div class="zone-row" style="margin-bottom: 0.75rem;">
                <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 0.75rem; margin-bottom: 0.25rem;">
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <span style="font-weight: 800; color: ${z.color}; font-size: 0.8rem;">Z${z.zone}</span>
                        <span style="color: var(--text-primary); font-weight: 600;">${z.name}</span>
                        <span style="color: var(--text-secondary); font-size: 0.65rem; opacity: 0.8;">(${z.range})</span>
                    </div>
                    <div style="font-variant-numeric: tabular-nums; font-weight: 700; color: white;">
                        <span>${z.minutes} <span style="font-size: 0.65rem; color: var(--text-secondary); font-weight: normal;">min</span></span>
                        <span style="margin-left: 0.4rem; color: ${z.color};">(${z.percent}%)</span>
                    </div>
                </div>
                <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                    <div class="zone-bar-fill" style="height: 100%; width: ${Math.min(100, z.percent)}%; background: ${z.color}; border-radius: 3px; transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);"></div>
                </div>
            </div>
        `).join('');

        zonesHtml = `
            <div id="${prefix}-zones-section" class="activity-section-block" style="margin-top: 2rem;">
                <h4 style="color: var(--accent-color); margin-bottom: 1.25rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; display: flex; align-items: center; gap: 0.5rem;">
                    <span style="display: inline-block; width: 3px; height: 14px; background: var(--accent-color); border-radius: 2px;"></span>
                    Intensity &amp; Zone Distribution
                </h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem;">
                    ${pz.length > 0 ? `
                    <div class="zone-card" style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.06); border-radius: 1rem; padding: 1.25rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                            <span style="font-size: 0.8rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em;">⚡ Power Zones (Coggan Z1-Z7)</span>
                            <span style="font-size: 0.7rem; color: #fbbf24; background: rgba(251, 191, 36, 0.1); padding: 0.2rem 0.6rem; border-radius: 1rem; border: 1px solid rgba(251, 191, 36, 0.2); font-weight: 700;">FTP: ${Math.round(ftp)}W</span>
                        </div>
                        ${renderStackedBar(pz)}
                        <div class="zone-list">
                            ${renderZoneList(pz)}
                        </div>
                    </div>
                    ` : ''}
                    ${hz.length > 0 ? `
                    <div class="zone-card" style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.06); border-radius: 1rem; padding: 1.25rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                            <span style="font-size: 0.8rem; font-weight: 800; color: #f87171; text-transform: uppercase; letter-spacing: 0.05em;">❤️ Heart Rate Zones (Z1-Z5)</span>
                            <span style="font-size: 0.7rem; color: #f87171; background: rgba(248, 113, 113, 0.1); padding: 0.2rem 0.6rem; border-radius: 1rem; border: 1px solid rgba(248, 113, 113, 0.2); font-weight: 700;">Max HR: ${maxHR ? Math.round(maxHR) + ' bpm' : '--'}</span>
                        </div>
                        ${renderStackedBar(hz)}
                        <div class="zone-list">
                            ${renderZoneList(hz)}
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // --- PB & Power Curve Analysis ---
    let pbHtml = '';
    const bests = data.bests || {};
    const getVal = (v) => (v && typeof v === 'object' ? v.value : v) || 0;
    const hasPowerBests = bests.power && Object.values(bests.power).some(v => getVal(v) > 0);
    const hasPaceBests = bests.pace && Object.values(bests.pace).some(v => getVal(v) > 0);
    const hasBests = hasPowerBests || hasPaceBests;
    
    if (hasBests) {
        const isBike = hasPowerBests;
        const chartId = `${prefix}-activityBestsChart`;

        let tableRows = '';
        if (isBike && bests.power) {
            const labels = {'5': '5s', '30': '30s', '60': '1m', '120': '2m', '300': '5m', '600': '10m', '1200': '20m', '1800': '30m', '3600': '60m'};
            const keys = ['5', '30', '60', '120', '300', '600', '1200', '1800', '3600'];
            keys.forEach(k => {
                const rec = bests.power[k];
                const val = rec && typeof rec === 'object' ? rec.value : rec;
                if (val && val > 0) {
                    const start = rec.start || 0;
                    const end = rec.end || 0;
                    tableRows += `
                        <div class="pb-row-clickable" 
                             onclick="window.toggleActivityHighlight(this, '${prefix}', ${start}, ${end})"
                             style="display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.6rem; background: rgba(15, 23, 42, 0.5); border-radius: 0.4rem; border: 1px solid rgba(255,255,255,0.03); cursor: pointer; transition: all 0.2s ease;">
                            <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">${labels[k]}</span>
                            <span style="font-size: 0.8rem; font-weight: 800; color: white;">${val}<span style="font-size: 0.6rem; opacity: 0.5; margin-left: 2px;">W</span></span>
                        </div>`;
                }
            });
        }
        if (!isBike && bests.pace) {
            const labels = {'1mi': '1 Mile', '5k': '5K', '5mi': '5 Mile'};
            Object.keys(bests.pace).forEach(k => {
                const rec = bests.pace[k];
                const s = rec && typeof rec === 'object' ? rec.value : rec;
                if (s && s > 0) {
                    const start = rec.start || 0;
                    const end = rec.end || 0;
                    const m = Math.floor(s / 60);
                    const sec = Math.floor(s % 60).toString().padStart(2, '0');
                    tableRows += `
                        <div class="pb-row-clickable" 
                             onclick="window.toggleActivityHighlight(this, '${prefix}', ${start}, ${end})"
                             style="display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.6rem; background: rgba(15, 23, 42, 0.5); border-radius: 0.4rem; border: 1px solid rgba(255,255,255,0.03); cursor: pointer; transition: all 0.2s ease;">
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

    // --- Strength Sets Support ---
    let strengthHtml = '';
    const muscleStats = data.muscle_stats || {};

    const renderMuscleMap = () => {
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
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-secondary); letter-spacing: 0.1em; display: flex; align-items: center; gap: 0.5rem;">
                            <span style="width: 8px; height: 8px; background: var(--accent-color); border-radius: 50%; box-shadow: 0 0 10px var(--accent-color);"></span>
                            Primary Anatomy Profile
                        </div>
                        ${renderMuscleMap()}
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 2.5rem;">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.75rem;">
                                <h4 style="margin: 0; color: var(--text-primary); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 800;">
                                    Target Loadings
                                </h4>
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
                                            let exName = uniqueNames.join(', ') || 'Exercise';
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

    // View Navigation Switcher Tabs
    const tabsHtml = `
        <div class="activity-view-tabs" style="display: flex; gap: 0.5rem; margin-top: 1.5rem; margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.75rem; flex-wrap: wrap;">
            <button onclick="window.switchActivityTab('${prefix}', 'all')" class="activity-tab-btn active ${prefix}-tab-btn" data-tab="all">All Details</button>
            <button onclick="window.switchActivityTab('${prefix}', 'telemetry')" class="activity-tab-btn ${prefix}-tab-btn" data-tab="telemetry">Telemetry &amp; Charts</button>
            ${zonesHtml ? `<button onclick="window.switchActivityTab('${prefix}', 'zones')" class="activity-tab-btn ${prefix}-tab-btn" data-tab="zones">Zone Distribution</button>` : ''}
            ${hasSplits ? `<button onclick="window.switchActivityTab('${prefix}', 'splits')" class="activity-tab-btn ${prefix}-tab-btn" data-tab="splits">${isCycle ? '5-Mile Splits' : 'Splits'}</button>` : ''}
        </div>
    `;

    div.innerHTML = `
        ${num ? `<h3 style="color: var(--accent-color); margin-bottom: 1rem;">Stage ${num}: ${basic.activityName}</h3>` : ''}
        ${summaryCardsHtml}
        ${tabsHtml}
        ${strengthHtml}
        
        <div id="${prefix}-telemetry-section" class="activity-section-block">
            ${pbHtml}
            <div id="${prefix}-selection-stats" class="selection-stats-bar" style="display:none; margin-top: 1.5rem; padding: 1rem; background: rgba(56, 189, 248, 0.05); border-radius: 0.75rem; border: 1px solid rgba(56, 189, 248, 0.2);">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem;">
                    <div class="stat-unit"><div class="stat-label">Time</div><div id="${prefix}-stat-time" class="stat-val">--</div></div>
                    <div class="stat-unit"><div class="stat-label">Dist</div><div id="${prefix}-stat-dist" class="stat-val">--</div></div>
                    <div class="stat-unit"><div class="stat-label">Avg Pwr</div><div id="${prefix}-stat-power" class="stat-val">--</div></div>
                    <div class="stat-unit"><div class="stat-label">Avg HR</div><div id="${prefix}-stat-hr" class="stat-val">--</div></div>
                    <div class="stat-unit"><div class="stat-label">Avg Speed</div><div id="${prefix}-stat-speed" class="stat-val">--</div></div>
                    <div class="stat-unit"><div class="stat-label">Avg RPM</div><div id="${prefix}-stat-cadence" class="stat-val">--</div></div>
                </div>
                <button onclick="window.clearSelection('${prefix}')" style="margin-top: 1rem; width: 100%; padding: 0.4rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 0.5rem; color: #94a3b8; font-size: 0.7rem; cursor: pointer;">Clear Selection</button>
            </div>

            <!-- Zoom & Scroll Controls -->
            <div class="activity-controls" style="margin-top: 2rem; display: flex; flex-direction: column; gap: 1rem; padding: 1rem; background: rgba(15, 23, 42, 0.3); border-radius: 1rem; border: 1px solid rgba(255,255,255,0.05);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.7rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em;">Visual Navigation</span>
                    <div style="display: flex; gap: 0.5rem;">
                        <button onclick="window.resetZoom('${prefix}')" class="btn-tool" title="Reset All" style="padding: 0.3rem 0.6rem; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 0.4rem; color: #f59e0b; cursor: pointer; font-size: 0.7rem; font-weight: 800;">RESET</button>
                        <div style="width: 1px; height: 16px; background: rgba(255,255,255,0.1); margin: 0 0.5rem;"></div>
                        <button onclick="window.zoomActivityCharts('${prefix}', 0.8)" class="btn-tool" title="Zoom In Charts" style="padding: 0.3rem 0.6rem; background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 0.4rem; color: var(--accent-color); cursor: pointer;">+</button>
                        <button onclick="window.zoomActivityCharts('${prefix}', 1.25)" class="btn-tool" title="Zoom Out Charts" style="padding: 0.3rem 0.6rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 0.4rem; color: white; cursor: pointer;">-</button>
                    </div>
                </div>
                <input type="range" id="${prefix}-zoom-scroll" min="0" max="100" value="50" 
                       oninput="window.scrollActivityCharts('${prefix}', this.value)"
                       style="width: 100%; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.1); outline: none; cursor: pointer;">
            </div>

            <div class="stage-charts" style="margin-top: 1rem; display: flex; flex-direction: column; gap: 2rem;">
                ${isStrength ? '' : `<div class="full-chart-container" style="height: 250px; background: rgba(15, 23, 42, 0.3); padding: 1rem; border-radius: 1rem;"><div class="chart-label">Elevation</div><canvas id="${prefix}-activityElevChart"></canvas></div>`}
                <div class="full-chart-container" style="height: 250px; background: rgba(15, 23, 42, 0.3); padding: 1rem; border-radius: 1rem;"><div class="chart-label">Heart Rate</div><canvas id="${prefix}-activityHrChart"></canvas></div>
                ${isStrength ? '' : `<div class="full-chart-container" style="height: 250px; background: rgba(15, 23, 42, 0.3); padding: 1rem; border-radius: 1rem;"><div class="chart-label">${isRun ? 'Pace' : 'Speed'}</div><canvas id="${prefix}-activitySpeedChart"></canvas></div>`}
                ${hasCadence ? `<div class="full-chart-container" style="height: 250px; background: rgba(15, 23, 42, 0.3); padding: 1rem; border-radius: 1rem;"><div class="chart-label">${isRun ? 'Cadence' : 'RPM'}</div><canvas id="${prefix}-activityCadenceChart"></canvas></div>` : ''}
                ${hasPower ? `<div class="full-chart-container" style="height: 250px; background: rgba(15, 23, 42, 0.3); padding: 1rem; border-radius: 1rem;"><div class="chart-label">Power</div><canvas id="${prefix}-activityPowerChart"></canvas></div>` : ''}
            </div>
        </div>

        ${zonesHtml}
        ${splitsHtml}
    `;
    body.appendChild(div);

    // Initializing charts
    setTimeout(() => {
        if (window.renderActivityCharts) {
            window.renderActivityCharts(data.charts, isRun, isCycle, prefix);
        }
        if (hasBests && window.renderActivityBestsChart) {
            const chartId = `${prefix}-activityBestsChart`;
            window.renderActivityBestsChart(chartId, bests, hasPowerBests);
        }
    }, 100);
};

window.switchActivityTab = function(prefix, tabName) {
    const stageEl = document.querySelector(`.${prefix}-stage-wrapper`) || document;
    const btns = stageEl.querySelectorAll(`.${prefix}-tab-btn`);
    btns.forEach(b => {
        if (b.getAttribute('data-tab') === tabName) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });

    const telemEl = document.getElementById(`${prefix}-telemetry-section`);
    const zonesEl = document.getElementById(`${prefix}-zones-section`);
    const splitsEl = document.getElementById(`${prefix}-splits-section`);

    if (tabName === 'all') {
        if (telemEl) telemEl.style.display = 'block';
        if (zonesEl) zonesEl.style.display = 'block';
        if (splitsEl) splitsEl.style.display = 'block';
    } else if (tabName === 'telemetry') {
        if (telemEl) telemEl.style.display = 'block';
        if (zonesEl) zonesEl.style.display = 'none';
        if (splitsEl) splitsEl.style.display = 'none';
    } else if (tabName === 'zones') {
        if (telemEl) telemEl.style.display = 'none';
        if (zonesEl) zonesEl.style.display = 'block';
        if (splitsEl) splitsEl.style.display = 'none';
    } else if (tabName === 'splits') {
        if (telemEl) telemEl.style.display = 'none';
        if (zonesEl) zonesEl.style.display = 'none';
        if (splitsEl) splitsEl.style.display = 'block';
    }
};

window.toggleActivityHighlight = function(el, prefix, start, end) {
    const isActive = el.classList.contains('active');
    
    // Clear all highlighting in this modal
    document.querySelectorAll('.pb-row-clickable').forEach(r => {
        r.classList.remove('active');
        r.style.background = 'rgba(15, 23, 42, 0.5)';
        r.style.borderColor = 'rgba(255,255,255,0.03)';
        r.style.boxShadow = 'none';
        r.style.transform = 'scale(1)';
    });
    window.clearChartHighlight(prefix);
    window.clearActivityHighlight();

    if (!isActive) {
        el.classList.add('active');
        el.style.background = 'rgba(245, 158, 11, 0.15)';
        el.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        el.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.1)';
        el.style.transform = 'scale(1.02)';
        
        window.highlightChartRange(prefix, start, end);
        window.highlightActivitySegment(start, end);
        
        if (window.updateSelectionStatsUI) {
            window.updateSelectionStatsUI(prefix, start, end, true);
        }
    }
};
