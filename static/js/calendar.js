/**
 * Calendar, Activity Heatmap (Grid), and Intensity Minutes Logic
 */

window.calendarDate = new Date();
window.currentCalendarView = 'month';

window.setCalendarView = function (view) {
    window.currentCalendarView = view;
    document.querySelectorAll('.calendar-widget .range-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`cal-view-${view}`);
    if (btn) btn.classList.add('active');
    if (window.fetchCalendarData) window.fetchCalendarData();
}

window.shiftCalendarMonth = function (dir) {
    if (window.currentCalendarView === 'year') window.calendarDate.setFullYear(window.calendarDate.getFullYear() + dir);
    else if (window.currentCalendarView === 'month') window.calendarDate.setMonth(window.calendarDate.getMonth() + dir);
    else window.calendarDate.setDate(window.calendarDate.getDate() + (dir * 7));
    if (window.fetchCalendarData) window.fetchCalendarData();
}

window.resetCalendarToToday = function () {
    window.calendarDate = new Date();
    if (window.fetchCalendarData) window.fetchCalendarData();
}

window.renderDetailedCalendar = function (activities, currentYear, currentMonth) {
    const titleEl = document.getElementById('calendar-title');
    if (titleEl) {
        if (window.currentCalendarView === 'year') titleEl.textContent = currentYear;
        else if (window.currentCalendarView === 'month') titleEl.textContent = `${window.calendarDate.toLocaleString('default', { month: 'long' })} ${currentYear}`;
        else {
            const start = new Date(window.calendarDate);
            const day = window.calendarDate.getDay();
            start.setDate(window.calendarDate.getDate() - day + (day == 0 ? -6 : 1));
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            titleEl.textContent = `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${end.getFullYear()}`;
        }
    }

    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    grid.className = window.currentCalendarView === 'year' ? 'year-view-grid' : 'calendar-grid';
    grid.innerHTML = '';

    const activitiesByDate = {};
    activities.forEach(act => {
        const dateStr = act.startTimeLocal.split(' ')[0];
        if (!activitiesByDate[dateStr]) activitiesByDate[dateStr] = [];
        activitiesByDate[dateStr].push(act);
    });

    if (window.currentCalendarView === 'year') {
        window.renderYearView(grid, activitiesByDate, currentYear);
    } else if (window.currentCalendarView === 'month') {
        const first = new Date(currentYear, currentMonth, 1);
        const startPad = (first.getDay() + 6) % 7;
        const startDate = new Date(currentYear, currentMonth, 1 - startPad);
        for (let i = 0; i < 42; i++) {
            const d = new Date(startDate); d.setDate(d.getDate() + i);
            const dateStr = window.getLocalDateStr(d);
            const cell = document.createElement('div');
            cell.className = `calendar-cell ${dateStr === window.getLocalDateStr(new Date()) ? 'today' : ''} ${d.getMonth() !== currentMonth ? 'other-month' : ''}`;
            cell.innerHTML = `<div class="calendar-date">${d.getDate()}</div>`;
            if (activitiesByDate[dateStr]) {
                activitiesByDate[dateStr].forEach(act => {
                    const pill = document.createElement('div');
                    pill.className = `activity-pill ${window.getActivityPillClass(act.activityType.typeKey)}`;
                    pill.innerHTML = `<span>${window.getActivityIcon(act.activityType.typeKey)}</span> ${act.distance > 0 ? (act.distance * 0.000621371).toFixed(1) + 'mi' : Math.round(act.duration / 60) + 'm'}`;
                    cell.appendChild(pill);
                });
            }
            grid.appendChild(cell);
        }
    } else {
        const start = new Date(window.calendarDate);
        const day = window.calendarDate.getDay();
        start.setDate(window.calendarDate.getDate() - day + (day == 0 ? -6 : 1));
        for (let i = 0; i < 7; i++) {
            const d = new Date(start); d.setDate(d.getDate() + i);
            const dateStr = window.getLocalDateStr(d);
            const cell = document.createElement('div');
            cell.className = 'calendar-cell view-week';
            cell.title = dateStr;
            cell.innerHTML = `<div class="calendar-date">${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</div>`;
            if (activitiesByDate[dateStr]) {
                activitiesByDate[dateStr].forEach(act => {
                    const pill = document.createElement('div');
                    pill.className = `activity-pill ${window.getActivityPillClass(act.activityType.typeKey)}`;
                    pill.innerHTML = `<strong>${act.activityName}</strong><br>${act.distance > 0 ? (act.distance * 0.000621371).toFixed(2) + ' mi' : ''} | ${(act.duration / 60).toFixed(0)}m`;
                    cell.appendChild(pill);
                });
            }
            grid.appendChild(cell);
        }
    }
    window.updateCalendarTotals(activities, currentYear, currentMonth);
}

window.renderYearView = function (container, data, year) {
    for (let m = 0; m < 12; m++) {
        const monthDiv = document.createElement('div'); monthDiv.className = 'small-month';
        const mName = new Date(year, m, 1).toLocaleString('default', { month: 'short' });
        monthDiv.innerHTML = `<div class="small-month-title">${mName}</div>`;
        const mGrid = document.createElement('div'); mGrid.className = 'small-month-grid';
        const first = new Date(year, m, 1);
        const pad = (first.getDay() + 6) % 7;
        for (let p = 0; p < pad; p++) mGrid.appendChild(document.createElement('div'));
        const last = new Date(year, m + 1, 0).getDate();
        for (let d = 1; d <= last; d++) {
            const dateStr = window.getLocalDateStr(new Date(year, m, d));
            const dayEl = document.createElement('div'); dayEl.className = 'small-day'; dayEl.textContent = d;
            if (data[dateStr]) {
                const dot = document.createElement('div'); dot.className = 'day-dot';
                dot.style.background = window.getActivityColor(data[dateStr][0].activityType.typeKey);
                dayEl.appendChild(dot);
            }
            mGrid.appendChild(dayEl);
        }
        monthDiv.appendChild(mGrid); container.appendChild(monthDiv);
    }
}

window.getActivityPillClass = function (type) {
    const t = type.toLowerCase();
    if (t.includes('running')) return 'act-running';
    if (t.includes('virtual_ride')) return 'act-virtual-ride';
    if (t.includes('cycling') || t.includes('ride')) return 'act-cycling';
    if (t.includes('swimming')) return 'act-swimming';
    if (t.includes('walking')) return 'act-walking';
    if (t.includes('strength')) return 'act-strength';
    return 'act-other';
}

window.getActivityColor = function (type) {
    const t = type.toLowerCase();
    if (t.includes('running')) return '#3b82f6';
    if (t.includes('virtual_ride')) return '#f59e0b';
    if (t.includes('cycling') || t.includes('ride')) return '#f97316';
    if (t.includes('swimming')) return '#06b6d4';
    return '#64748b';
}

window.updateCalendarTotals = function (activities, currentYear, currentMonth) {
    const container = document.getElementById('calendar-totals');
    if (!container) return;
    container.innerHTML = '';
    let totals = { count: 0, distance: 0, duration: 0, types: {} };

    activities.forEach(act => {
        const date = window.parseLocalDate(act.startTimeLocal.split(' ')[0]);
        const inRange = (window.currentCalendarView === 'year') ||
            (window.currentCalendarView === 'month' && date.getMonth() === currentMonth) ||
            (window.currentCalendarView === 'week');

        if (inRange) {
            totals.count++;
            totals.distance += act.distance || 0;
            totals.duration += act.duration || 0;
            const type = act.activityType.typeKey;
            if (!totals.types[type]) totals.types[type] = { count: 0, distance: 0, time: 0 };
            totals.types[type].count++;
            totals.types[type].distance += act.distance || 0;
            totals.types[type].time += act.duration || 0;
        }
    });

    container.innerHTML += `
        <div class="total-card">
            <div class="total-type" style="font-size: 1.1rem; margin-bottom: 1rem;">Summary</div>
            <div class="total-value-row"><span>Activities</span><span>${totals.count}</span></div>
            <div class="total-value-row"><span>Distance</span><span>${(totals.distance * 0.000621371).toFixed(1)} mi</span></div>
            <div class="total-value-row"><span>Time</span><span>${Math.floor(totals.duration / 3600)}h ${Math.round((totals.duration % 3600) / 60)}m</span></div>
        </div>`;

    Object.keys(totals.types).forEach(type => {
        const data = totals.types[type];
        container.innerHTML += `
            <div class="total-card" style="border-left: 4px solid ${window.getActivityColor(type)};">
                <div class="total-type">${type.replace(/_/g, ' ')}</div>
                <div class="total-value-row"><span>Count</span><span>${data.count}</span></div>
                <div class="total-value-row"><span>Distance</span><span>${(data.distance * 0.000621371).toFixed(1)} mi</span></div>
            </div>`;
    });
}

/** Heatmap Cell Grid **/
window.renderActivityHeatmap = function (data) {
    const container = document.getElementById('activity-heatmap');
    if (!container) return;
    container.innerHTML = '';

    const tooltip = document.getElementById('heatmap-tooltip');
    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - 365);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

    let currentWeek = [];
    let current = new Date(start);

    while (current <= today || current.getDay() !== 1) {
        const dStr = window.getLocalDateStr(current);
        const dayActivities = data[dStr] || [];

        currentWeek.push({
            date: new Date(current),
            dateStr: dStr,
            activities: dayActivities,
            count: dayActivities.length
        });

        if (current.getDay() === 0) {
            const col = document.createElement('div');
            col.style.display = 'flex';
            col.style.flexDirection = 'column';
            col.style.gap = '4px';

            currentWeek.forEach(day => {
                const cell = document.createElement('div');
                cell.className = 'heatmap-cell';
                cell.style.width = '12px';
                cell.style.height = '12px';
                cell.style.borderRadius = '2px';

                let bg = 'rgba(255,255,255,0.05)';
                if (day.count === 1) bg = 'rgba(34, 197, 94, 0.4)';
                else if (day.count === 2) bg = 'rgba(34, 197, 94, 0.7)';
                else if (day.count >= 3) bg = '#22c55e';
                cell.style.background = bg;

                const showTooltip = (e) => {
                    if (!tooltip) return;
                    const d = day.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                    let html = `<div class="heatmap-tooltip-date">${d}</div>`;
                    if (day.activities.length > 0) {
                        day.activities.forEach(a => {
                            html += `<div class="heatmap-tooltip-activity"><span>${a.name}</span><span style="color: var(--text-secondary); white-space: nowrap;">${a.dist}mi / ${a.dur}m</span></div>`;
                        });
                    } else {
                        html += `<div style="color: var(--text-secondary); font-size: 0.75rem;">No activities</div>`;
                    }
                    tooltip.innerHTML = html;
                    tooltip.style.display = 'block';
                    tooltip.style.left = (e.clientX + 15) + 'px';
                    tooltip.style.top = (e.clientY + 15) + 'px';
                };

                cell.onmouseenter = showTooltip;
                cell.onmousemove = showTooltip;
                cell.onmouseleave = () => { if (tooltip) tooltip.style.display = 'none'; };
                col.appendChild(cell);
            });
            container.appendChild(col);
            currentWeek = [];
        }
        current.setDate(current.getDate() + 1);
    }
}
