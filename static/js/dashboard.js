/**
 * Dashboard Stats & Long-term Statistics Updating
 */

window.updateDashboard = function (data, today1d = {}, history = {}) {
    if (!data) return;

    // Steps
    const stepsCount = data.steps || 0;
    const stepsGoal = data.steps_goal || 10000;
    window.safeSetText('steps', stepsCount.toLocaleString());
    window.safeSetText('steps-goal-caption', `Goal: ${stepsGoal.toLocaleString()}`);
    if (window.renderGlanceDonut) {
        window.renderGlanceDonut('glance-steps-donut', stepsCount, stepsGoal, '#38bdf8');
    }
    const stepsStreak = (history.steps && history.steps.streak !== undefined) ? history.steps.streak : (data.steps_streak || 0);
    window.safeSetText('steps-streak', `${stepsStreak}d streak`);

    // Heart Rate
    const hrSummary = (today1d.hr && today1d.hr.summary) || {};
    const rhr = data.resting_hr || hrSummary.rhr || '--';
    const hrHistory = (history.hr && history.hr.history) || [];
    let hr7dAvg = rhr;
    if (hrHistory.length > 0) {
        const validRHR = hrHistory.map(d => d.rhr).filter(v => typeof v === 'number' && v > 0);
        if (validRHR.length > 0) {
            hr7dAvg = Math.round(validRHR.reduce((a, b) => a + b, 0) / validRHR.length);
        }
    }
    window.safeSetText('rhr', rhr);
    window.safeSetText('hr-7d-avg', hr7dAvg);
    window.safeSetText('hr-max-val', `Max: ${data.max_hr || hrSummary.max || '--'}`);
    if (window.renderGlanceHRSparkline) {
        const hrSamples = (today1d.hr && today1d.hr.samples) || data.hr_samples || hrHistory;
        window.renderGlanceHRSparkline(hrSamples);
    }

    // Weight & BMI
    const weightHist = (history.weight && history.weight.history) || data.weight_history || [];
    const weightSum = (history.weight && history.weight.summary) || {};
    let weightLbs = '--';
    let weightKg = '--';
    if (data.weight_grams) {
        const kg = (data.weight_grams / 1000).toFixed(1);
        weightKg = kg;
        weightLbs = (kg * 2.20462).toFixed(1);
    } else if (weightSum.latest_lbs) {
        weightLbs = weightSum.latest_lbs.toFixed(1);
        weightKg = (weightSum.latest_kg || (weightSum.latest_lbs / 2.20462)).toFixed(1);
    }
    window.safeSetText('weight', weightLbs);
    window.safeSetText('weight-dual', weightKg);
    window.safeSetText('weight-7d-avg', `${weightLbs} lbs`);
    if (data.bmi) window.safeSetText('weight-bmi-val', data.bmi);
    if (weightSum.delta_lbs !== undefined || data.weight_change_lbs !== undefined) {
        const delta = weightSum.delta_lbs !== undefined ? weightSum.delta_lbs : data.weight_change_lbs;
        const prefix = delta > 0 ? '+' : '';
        const badge = document.getElementById('weight-diff-badge');
        if (badge) {
            badge.textContent = `${prefix}${delta} lbs Change`;
            badge.style.color = delta <= 0 ? '#4ade80' : '#f87171';
        }
    }
    if (window.renderGlanceWeightSparkline) {
        window.renderGlanceWeightSparkline(weightHist);
    }

    // Intensity Minutes
    const imSum = (today1d.intensity_minutes && today1d.intensity_minutes.summary) || {};
    const imVal = imSum.weeklyTotal != null ? imSum.weeklyTotal : (data.intensity_minutes || 0);
    const imGoal = imSum.goal || data.intensity_minutes_goal || 150;
    window.safeSetText('im-val', imVal);
    window.safeSetText('im-goal-caption', `Goal: ${imGoal}`);
    if (window.renderGlanceDonut) {
        window.renderGlanceDonut('glance-im-donut', imVal, imGoal, '#4ade80');
    }

    // Hydration
    const hydSum = (today1d.hydration && today1d.hydration.summary) || {};
    const hydIntakeMl = hydSum.intake != null ? hydSum.intake : (data.hydration_ml || 0);
    const hydGoalMl = hydSum.goal != null ? hydSum.goal : (data.hydration_goal_ml || 2839);
    const hydValOz = hydIntakeMl > 0 ? Math.round(hydIntakeMl * 0.033814) : (data.hydration_oz || 0);
    const hydGoalOz = hydGoalMl > 0 ? Math.round(hydGoalMl * 0.033814) : (data.hydration_goal_oz || 96);
    window.safeSetText('hydration-val', hydValOz);
    window.safeSetText('hydration-goal-caption', `Goal: ${hydGoalOz} oz`);
    if (window.renderGlanceDonut) {
        window.renderGlanceDonut('glance-hydration-donut', hydValOz, hydGoalOz, '#06b6d4');
    }

    // Sleep
    const sleepSum = (today1d.sleep && today1d.sleep.summary) || {};
    const sleepSecs = sleepSum.total != null ? sleepSum.total : (data.sleep_seconds || 0);
    const sleepHours = sleepSecs > 0 ? (sleepSecs / 3600).toFixed(1) : '--';
    const sleepScore = sleepSum.score != null ? sleepSum.score : (data.sleep_score || '--');
    window.safeSetText('sleep', sleepHours);
    window.safeSetText('sleep-score-val', sleepScore);
    if (data.sleep_start) window.safeSetText('sleep-start-time', data.sleep_start);
    if (data.sleep_end) window.safeSetText('sleep-end-time', data.sleep_end);

    // Dynamic Sleep Stage Bars
    const sleepBarsEl = document.getElementById('glance-sleep-bars');
    if (sleepBarsEl) {
        const deep = sleepSum.deep || 0;
        const light = sleepSum.light || 0;
        const rem = sleepSum.rem || 0;
        const awake = sleepSum.awake || 0;
        const totalStages = deep + light + rem + awake;

        if (totalStages > 0) {
            const deepPct = Math.max(2, Math.round((deep / totalStages) * 100));
            const lightPct = Math.max(2, Math.round((light / totalStages) * 100));
            const remPct = Math.max(2, Math.round((rem / totalStages) * 100));
            const awakePct = Math.max(1, Math.round((awake / totalStages) * 100));
            sleepBarsEl.innerHTML = `
                <div class="sleep-stage-bar stage-deep" style="flex: ${deepPct};" title="Deep: ${(deep / 3600).toFixed(1)} hrs"></div>
                <div class="sleep-stage-bar stage-light" style="flex: ${lightPct};" title="Light: ${(light / 3600).toFixed(1)} hrs"></div>
                <div class="sleep-stage-bar stage-rem" style="flex: ${remPct};" title="REM: ${(rem / 3600).toFixed(1)} hrs"></div>
                <div class="sleep-stage-bar stage-awake" style="flex: ${awakePct};" title="Awake: ${(awake / 60).toFixed(0)} min"></div>
            `;
        } else {
            sleepBarsEl.innerHTML = `<div class="sleep-stage-bar" style="flex: 1; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>`;
        }
    }

    // Stress
    const stressSum = (today1d.stress && today1d.stress.summary) || {};
    const stressAvg = stressSum.avg != null ? stressSum.avg : (data.stress_avg || '--');
    window.safeSetText('stress', stressAvg);
    if (window.renderGlanceStressSparkline) {
        const stressSamples = (today1d.stress && today1d.stress.samples) || (history.stress && history.stress.history) || data.stress_timeline;
        window.renderGlanceStressSparkline(stressSamples);
    }

    // HRV
    const hrvPayload = (today1d.hrv && today1d.hrv.hrvSummary) || today1d.hrv || data.hrv;
    const hrvHistory = (history.hrv && history.hrv.history) || [];
    if (window.renderGlanceHRV) {
        window.renderGlanceHRV(hrvPayload, hrvHistory);
    }

    // Week streaks with real history data
    if (window.renderWeekStreak) {
        const imHistory = (history.intensity_minutes && history.intensity_minutes.history) || data.im_history || [];
        const stepsHistory = (history.steps && history.steps.history) || data.steps_history || [];
        const hydrationHistory = (history.hydration && history.hydration.history) || data.hydration_history || [];
        window.renderWeekStreak('im-streak-days', imHistory, imGoal / 7);
        window.renderWeekStreak('steps-streak-days', stepsHistory, stepsGoal);
        window.renderWeekStreak('hydration-streak-days', hydrationHistory, hydGoalOz);
    }

    const activityList = document.getElementById('activity-list');
    if (activityList) {
        activityList.innerHTML = '';
        if (data.activities && data.activities.length > 0) {
            data.activities.forEach(activity => {
                if (!activity) return;
                const el = document.createElement('div');
                el.className = 'activity-item' + (activity.is_grouped ? ' grouped-session' : '');
                el.onclick = () => window.openActivityDetail(activity.activityId, activity);

                const startTime = activity.startTimeLocal || new Date().toISOString();
                const date = new Date(startTime).toLocaleDateString([], { month: 'short', day: 'numeric' });
                const dist = activity.distance || 0;
                const distanceKm = (dist / 1000).toFixed(2);
                const distanceMi = (dist / 1609.34).toFixed(2);
                const dur = activity.duration || 0;
                const durationMin = Math.round(dur / 60);

                const typeKey = (activity.activityType && activity.activityType.typeKey) || 'other';
                const typeDisplay = (activity.activityType && activity.activityType.display) || 'Activity';
                const actName = activity.activityName || 'Activity';

                el.innerHTML = `
                    <div class="activity-info">
                        <div class="activity-icon">${window.getActivityIcon(typeKey)}</div>
                        <div class="activity-details">
                            <h3 style="display: flex; align-items: center; gap: 0.5rem;">
                                ${actName}
                                ${activity.is_grouped ? `<span class="grouped-badge">${(activity.grouped_activities || []).length} Stages</span>` : ''}
                            </h3>
                            <div class="activity-meta">${date} • ${typeDisplay}</div>
                        </div>
                    </div>
                    <div class="activity-stats">
                        <div class="stat-group">
                            <div class="stat-value">${distanceMi} <span class="unit">mi</span> / ${distanceKm} <span class="unit">km</span></div>
                            <div class="stat-value">${durationMin} <span class="unit">min</span></div>
                        </div>
                        <div class="chevron">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </div>
                    </div>
                `;
                activityList.appendChild(el);
            });
        } else {
            activityList.innerHTML = '<div class="activity-item" style="justify-content: center;">No recent activities found</div>';
        }
    }
}

window.updateLongtermStats = function (data) {
    if (!data) return;
    const items = [
        { id: 'lt-total-activities', val: data.total_activities },
        { id: 'lt-total-distance', val: (data.total_distance_mi || 0).toLocaleString() + ' mi' },
        { id: 'lt-total-climb', val: (data.total_elevation_gain_ft || 0).toLocaleString() + ' ft' },
        { id: 'lt-best-pace', val: data.best_pace || '--' },
        { id: 'lt-max-hr', val: data.max_hr_ever || '--' }
    ];
    items.forEach(item => window.safeSetText(item.id, item.val));

    const breakdown = document.getElementById('lt-breakdown');
    if (breakdown && data.type_breakdown) {
        breakdown.innerHTML = '';
        Object.entries(data.type_breakdown).forEach(([type, count]) => {
            const div = document.createElement('div');
            div.className = 'type-stat';
            div.innerHTML = `<span class="type-name">${type.replace(/_/g, ' ')}</span><span class="type-count">${count}</span>`;
            breakdown.appendChild(div);
        });
    }
}

window.updateGoalsConfig = function (data) {
    if (!data) return;
    const m = data.monthly || {};
    const y = data.yearly || {};

    function setGoalDonut(valId, percentId, chartId, goalId, value, goal) {
        const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
        window.safeSetText(valId, window.formatDualDistance ? window.formatDualDistance(value) : value);
        window.safeSetText(percentId, pct + '%');
        window.safeSetText(goalId, window.formatDualDistance ? window.formatDualDistance(goal) : goal);
        const chartEl = document.getElementById(chartId);
        if (chartEl) chartEl.style.background = `conic-gradient(var(--accent-color) 0% ${pct}%, rgba(255,255,255,0.1) ${pct}% 100%)`;
    }

    setGoalDonut('month-run', 'month-run-percent', 'month-run-chart', 'month-run-goal', m.running_actual || 0, m.running || 20);
    setGoalDonut('month-cycle', 'month-cycle-percent', 'month-cycle-chart', 'month-cycle-goal', m.cycling_actual || 0, m.cycling || 200);
    setGoalDonut('year-run', 'year-run-percent', 'year-run-chart', 'year-run-goal', y.running_actual || 0, y.running || 600);
    setGoalDonut('year-cycle', 'year-cycle-percent', 'year-cycle-chart', 'year-cycle-goal', y.cycling_actual || 0, y.cycling || 2400);
}


window.submitWeight = async function () {
    const val = parseFloat(document.getElementById('weight-input').value);
    const unit = document.querySelector('input[name="weight-unit"]:checked').value;
    if (!val) return;
    try {
        const res = await fetch('/api/add_weight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weight: unit === 'lbs' ? val / 2.20462 : val })
        });
        if (res.ok) {
            window.closeModal('weightModal');
            if (window.fetchDashboardData) window.fetchDashboardData();
        }
    } catch (err) { console.error('Add weight error:', err); }
}
