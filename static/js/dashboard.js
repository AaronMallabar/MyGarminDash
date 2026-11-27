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
        const kgRaw = data.weight_grams / 1000;
        weightKg = kgRaw.toFixed(1);
        weightLbs = (kgRaw * 2.20462).toFixed(1);
    } else if (weightSum.latest_lbs) {
        weightLbs = weightSum.latest_lbs.toFixed(1);
        weightKg = (weightSum.latest_kg || (weightSum.latest_lbs / 2.20462)).toFixed(1);
    }
    window.safeSetText('weight', weightLbs);
    window.safeSetText('weight-dual', weightKg);
    window.safeSetText('weight-7d-avg', `${weightLbs} lbs`);
    const heightM = (data.user_height_cm || 182.88) / 100;
    const kgNum = parseFloat(weightKg);
    const calculatedBmi = data.bmi || ((!isNaN(kgNum) && kgNum > 0) ? (kgNum / (heightM * heightM)).toFixed(1) : null);
    if (calculatedBmi) window.safeSetText('weight-bmi-val', calculatedBmi);
    const todayStr = window.getEasternDateStr ? window.getEasternDateStr() : window.getLocalDateStr();
    const yesterdayDt = window.parseLocalDate ? window.parseLocalDate(todayStr) : new Date();
    yesterdayDt.setDate(yesterdayDt.getDate() - 1);
    const yesterdayStr = window.getLocalDateStr(yesterdayDt);

    const updatedEl = document.getElementById('weight-updated-date');
    if (updatedEl) {
        const wDate = weightSum.date ? String(weightSum.date).slice(0, 10) : '';
        if (!wDate) {
            updatedEl.textContent = 'No weigh-in';
        } else if (wDate === todayStr) {
            updatedEl.textContent = 'Updated Today';
        } else if (wDate === yesterdayStr) {
            updatedEl.textContent = 'Updated Yesterday';
        } else {
            const wDt = window.parseLocalDate ? window.parseLocalDate(wDate) : new Date(wDate + 'T12:00:00');
            updatedEl.textContent = 'Updated ' + wDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
    }

    const badge = document.getElementById('weight-diff-badge');
    if (badge) {
        if (weightSum.delta_lbs !== undefined || data.weight_change_lbs !== undefined) {
            const delta = weightSum.delta_lbs !== undefined ? weightSum.delta_lbs : data.weight_change_lbs;
            const prefix = delta > 0 ? '+' : '';
            badge.textContent = `${prefix}${delta} lbs Change`;
            badge.style.color = delta <= 0 ? '#4ade80' : '#f87171';
        } else {
            badge.textContent = '-- lbs Change';
            badge.style.color = 'var(--accent-color)';
        }
    }
    if (window.renderGlanceWeightSparkline) {
        window.renderGlanceWeightSparkline(weightHist);
    }

    // Intensity Minutes
    const imSum = (today1d.intensity_minutes && today1d.intensity_minutes.summary) || {};
    const imVal = imSum.weeklyTotal != null ? imSum.weeklyTotal : (data.intensity_minutes || 0);
    const imGoal = imSum.goal || data.intensity_minutes_goal || 420;
    const imMod = imSum.weeklyModerate != null ? imSum.weeklyModerate : (imSum.moderate != null ? imSum.moderate : 0);
    const imVig = imSum.weeklyVigorous != null ? imSum.weeklyVigorous : (imSum.vigorous != null ? imSum.vigorous : 0);
    window.safeSetText('im-val', imVal);
    window.safeSetText('im-goal-caption', `Goal: ${imGoal}`);
    window.safeSetText('im-glance-mod', `${imMod} min`);
    window.safeSetText('im-glance-vig', `${imVig} min`);
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
    let sleepDurationStr = '--';
    if (sleepSecs > 0) {
        const h = Math.floor(sleepSecs / 3600);
        const m = Math.round((sleepSecs % 3600) / 60);
        sleepDurationStr = `${h}h ${m}m`;
    }
    const sleepScore = (sleepSum.score != null && sleepSum.score > 0) ? sleepSum.score : ((data.sleep_score && data.sleep_score > 0) ? data.sleep_score : '--');
    const prevSleepText = document.getElementById('sleep')?.textContent?.trim();
    const prevSleepScore = document.getElementById('sleep-score-val')?.textContent?.trim();
    if (sleepDurationStr !== '--' || !prevSleepText || prevSleepText === '--') {
        window.safeSetText('sleep', sleepDurationStr);
    }
    if (sleepScore !== '--' || !prevSleepScore || prevSleepScore === '--') {
        window.safeSetText('sleep-score-val', sleepScore);
    }

    const bedTime = sleepSum.bedTime || data.sleep_start || '--';
    const wakeTime = sleepSum.wakeTime || data.sleep_end || '--';
    if (bedTime !== '--' || !document.getElementById('sleep-start-time')?.textContent?.trim()) {
        window.safeSetText('sleep-start-time', bedTime);
    }
    if (wakeTime !== '--' || !document.getElementById('sleep-end-time')?.textContent?.trim()) {
        window.safeSetText('sleep-end-time', wakeTime);
    }

    if (window.renderGlanceSleepTimeline) {
        window.renderGlanceSleepTimeline(sleepSum.sleepLevels ? sleepSum : {
            deep: sleepSum.deep,
            light: sleepSum.light,
            rem: sleepSum.rem,
            awake: sleepSum.awake,
            total: sleepSecs,
            sleepLevels: data.sleep_levels || sleepSum.sleepLevels
        });
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
        const todayStr = window.getEasternDateStr ? window.getEasternDateStr() : window.getLocalDateStr();
        const imHistory = (history.intensity_minutes && history.intensity_minutes.history) || data.im_history || [];
        const rawStepsHistory = (history.steps && history.steps.history) || data.steps_history || [];
        const stepsHistory = rawStepsHistory.map(d => ({ ...d }));
        const todayStepEntry = stepsHistory.find(d => (d.calendarDate || d.date || '').slice(0, 10) === todayStr);
        if (todayStepEntry) {
            todayStepEntry.totalSteps = Math.max(todayStepEntry.totalSteps || 0, stepsCount);
        } else if (stepsCount > 0) {
            stepsHistory.push({ calendarDate: todayStr, totalSteps: stepsCount });
        }
        const hydrationHistory = (history.hydration && history.hydration.history) || data.hydration_history || [];
        window.renderWeekStreak('im-streak-days', imHistory, imGoal / 7);
        window.renderWeekStreak('steps-streak-days', stepsHistory, stepsGoal);
        window.renderWeekStreak('hydration-streak-days', hydrationHistory, hydGoalMl);
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


window.submitHydration = async function (presetOz = null) {
    const inputEl = document.getElementById('hydration-input');
    const unitEl = document.querySelector('input[name="hydration-unit"]:checked');
    const unit = presetOz !== null ? 'oz' : (unitEl ? unitEl.value : 'oz');
    const val = presetOz !== null ? presetOz : parseFloat(inputEl ? inputEl.value : '');
    if (!val || isNaN(val) || val <= 0) return;

    const payload = unit === 'ml' ? { ml: val } : { ounces: val };
    try {
        const res = await fetch('/api/hydration/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            if (inputEl) inputEl.value = '';
            window.closeModal('hydrationModal');
            if (window.fetchDashboardData) window.fetchDashboardData();
        } else {
            const err = await res.json().catch(() => ({}));
            alert(err.message || err.error || 'Failed to log hydration');
        }
    } catch (err) {
        console.error('Log hydration error:', err);
    }
};

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
