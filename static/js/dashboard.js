/**
 * Dashboard Stats & Long-term Statistics Updating
 */

window.updateDashboard = function (data) {
    window.safeSetText('steps', data.steps ? data.steps.toLocaleString() : '0');
    window.safeSetText('rhr', data.resting_hr || '--');
    window.safeSetText('stress', data.stress_avg || '--');

    if (data.weight_grams) {
        const kg = (data.weight_grams / 1000).toFixed(1);
        const lbs = (kg * 2.20462).toFixed(1);
        window.safeSetText('weight', lbs);
        window.safeSetText('weight-dual', kg);
    }

    const sleepHours = data.sleep_seconds ? (data.sleep_seconds / 3600).toFixed(1) : '--';
    window.safeSetText('sleep', sleepHours);
    window.safeSetText('sleep-score-val', data.sleep_score || '--');

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
