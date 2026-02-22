/**
 * Utility Functions for Garmin Dashboard
 */

window.parseMarkdown = function (text) {
    if (!text) return '';
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

window.getActivityIcon = function (type) {
    const t = (type || '').toLowerCase();
    if (t.includes('running')) return '🏃';
    if (t.includes('cycling') || t.includes('ride')) return '🚴';
    if (t.includes('virtual_ride')) return '🎮';
    if (t.includes('swimming')) return '🏊';
    if (t.includes('walking') || t.includes('hike')) return '🥾';
    if (t.includes('strength')) return '💪';
    if (t.includes('yoga')) return '🧘';
    return '🏁';
}

// ============================================================================
// DATE & TIME UTILITIES
// ============================================================================

/**
 * Get local date string in YYYY-MM-DD format
 * @param {Date} date - Date object (defaults to today)
 * @returns {string} Date string in YYYY-MM-DD format
 */
window.getLocalDateStr = function (date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

window.parseLocalDate = function (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

window.isDateToday = function (date) {
    const d = new Date(date);
    const today = new Date();
    return d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear();
}

window.formatDuration = function (s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
        ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
        : `${m}:${sec.toString().padStart(2, '0')}`;
}

window.formatDualDistance = function (miles) {
    const km = (miles * 1.60934).toFixed(1);
    const mi = Number(miles).toFixed(1);
    return `${mi} mi / ${km} km`;
}

window.safeSetText = function (id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

window.safeSetHTML = function (id, text) {
    const el = document.getElementById(id);
    if (el) {
        el.innerHTML = window.parseMarkdown(text || '');
    }
}

window.parseMarkdown = function (text) {
    if (!text) return '';
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

window.showError = function (msg) {
    const el = document.getElementById('error-message');
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
    }
    window.safeSetText('last-sync', 'Error');
}

window.getActivityIcon = function (type) {
    if (type.includes('running')) return '🏃';
    if (type.includes('cycling') || type.includes('ride')) return '🚴';
    if (type.includes('swimming')) return '🏊';
    if (type.includes('walking')) return '🚶';
    if (type.includes('strength')) return '💪';
    return '⚡';
}

window.getPowerZoneColor = function (power) {
    if (power >= 450) return '#a855f7';
    if (power >= 350) return '#ef4444';
    if (power >= 300) return '#f97316';
    if (power >= 250) return '#eab308';
    if (power >= 200) return '#22c55e';
    if (power >= 150) return '#3b82f6';
    return '#94a3b8';
}

window.getHRZoneColor = function (hr, zones) {
    if (hr >= zones[4]) return '#a855f7';
    if (hr >= zones[3]) return '#ef4444';
    if (hr >= zones[2]) return '#f97316';
    if (hr >= zones[1]) return '#22c55e';
    if (hr >= zones[0]) return '#3b82f6';
    return '#94a3b8';
}

window.getStressColor = function (stress) {
    if (stress < 0) return 'rgba(148, 163, 184, 0.1)';
    if (stress <= 25) return '#94a3b8';
    if (stress <= 50) return '#f97316';
    if (stress <= 75) return '#f43f5e';
    return '#ef4444';
}
window.formatModelName = function (modelName) {
    if (!modelName) return '';

    const modelMap = {
        'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
        'gemini-2.0-flash-exp': 'Gemini 2.0 Flash',
        'gemini-1.5-pro': 'Gemini 1.5 Pro',
        'gemini-1.5-flash': 'Gemini 1.5 Flash',
        'gemma-3-27b-it': 'Gemma 3 27B',
        'gemma-2-27b-it': 'Gemma 2 27B',
        'Local Logic (Fallback)': 'Local Logic'
    };

    return modelMap[modelName] || modelName;
}

window.formatTo12H = function (timeStr) {
    if (!timeStr) return '';
    const [hrs, mins] = timeStr.split(':');
    let h = parseInt(hrs);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${mins} ${ampm}`;
}
