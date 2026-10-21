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

window.isCyclingActivity = function (actOrType) {
    if (!actOrType) return false;
    let tk = '';
    let an = '';
    if (typeof actOrType === 'object') {
        const at = actOrType.activityType;
        if (typeof at === 'object' && at !== null) {
            tk = String(at.typeKey || '').toLowerCase();
        } else {
            tk = String(at || '').toLowerCase();
        }
        an = String(actOrType.activityName || '').toLowerCase();
    } else {
        tk = String(actOrType).toLowerCase();
    }
    const cyclingKeys = ['cycling', 'cycl', 'biking', 'bike', 'ride', 'virtual', 'indoor', 'road', 'gravel', 'mountain', 'velo'];
    if (cyclingKeys.some(k => tk.includes(k))) return true;
    const nameKeys = ['zwift', 'ride', 'cycling', 'cycl', 'biking', 'bike', 'peloton', 'trainerroad', 'road biking', 'mountain biking', 'road cycling', 'gravel'];
    return nameKeys.some(k => an.includes(k));
};

window.isRunningActivity = function (actOrType) {
    if (!actOrType) return false;
    let tk = '';
    let an = '';
    if (typeof actOrType === 'object') {
        const at = actOrType.activityType;
        if (typeof at === 'object' && at !== null) {
            tk = String(at.typeKey || '').toLowerCase();
        } else {
            tk = String(at || '').toLowerCase();
        }
        an = String(actOrType.activityName || '').toLowerCase();
    } else {
        tk = String(actOrType).toLowerCase();
    }
    return tk.includes('run') || tk.includes('treadmill') || an.includes('run') || an.includes('treadmill');
};

window.getActivityIcon = function (actOrType) {
    if (window.isCyclingActivity(actOrType)) return '🚴';
    if (window.isRunningActivity(actOrType)) return '🏃';
    const t = (typeof actOrType === 'object' ? (actOrType.activityType?.typeKey || actOrType.activityType || '') : String(actOrType || '')).toLowerCase();
    if (t.includes('swimming') || t.includes('swim')) return '🏊';
    if (t.includes('walking') || t.includes('walk') || t.includes('hike')) return '🥾';
    if (t.includes('strength') || t.includes('weight')) return '💪';
    if (t.includes('yoga')) return '🧘';
    return '🏁';
};

// ============================================================================
// DATE & TIME UTILITIES
// ============================================================================

window.getEasternDateStr = function (date = new Date()) {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        return formatter.format(date);
    } catch (e) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
};

window.getEasternTime12H = function (date = new Date()) {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        return formatter.format(date);
    } catch (e) {
        let h = date.getHours();
        const m = date.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${m} ${ampm}`;
    }
};

window.getEasternTime24H = function (date = new Date()) {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        });
        return formatter.format(date);
    } catch (e) {
        return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
    }
};

window.getEasternHour = function (date = new Date()) {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            hourCycle: 'h23'
        });
        return parseInt(formatter.format(date), 10);
    } catch (e) {
        return date.getHours();
    }
};

/**
 * Get date string in YYYY-MM-DD format.
 * If date is omitted, returns today in Eastern Time.
 * If a Date object is provided, formats its local year, month, and day components without timezone drift.
 * @param {Date} [date] - Date object (defaults to today in Eastern Time)
 * @returns {string} Date string in YYYY-MM-DD format
 */
window.getLocalDateStr = function (date) {
    if (!date) {
        return window.getEasternDateStr();
    }
    if (typeof date === 'string') {
        return date.slice(0, 10);
    }
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        try {
            date = new Date(date);
            if (isNaN(date.getTime())) return window.getEasternDateStr();
        } catch (e) {
            return window.getEasternDateStr();
        }
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

window.parseLocalDate = function (dateStr) {
    if (!dateStr) return new Date();
    if (dateStr instanceof Date) return dateStr;
    const cleanStr = String(dateStr).split('T')[0].split(' ')[0];
    const [y, m, d] = cleanStr.split('-').map(Number);
    if (!y || !m || !d || isNaN(y) || isNaN(m) || isNaN(d)) {
        return new Date(cleanStr);
    }
    return new Date(y, m - 1, d);
};

window.isDateToday = function (date) {
    const d = new Date(date);
    const today = new Date();
    return d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear();
}

window.destroyChartIfExists = function (canvasIdOrEl) {
    if (!canvasIdOrEl) return;
    const canvas = typeof canvasIdOrEl === 'string' ? document.getElementById(canvasIdOrEl) : canvasIdOrEl;
    const id = typeof canvasIdOrEl === 'string' ? canvasIdOrEl : (canvas ? canvas.id : null);
    if (window.Chart && canvas) {
        try {
            const chart = window.Chart.getChart(canvas);
            if (chart) chart.destroy();
        } catch (e) {}
        try {
            if (window.Chart.instances) {
                Object.values(window.Chart.instances).forEach(c => {
                    if (c && (c.canvas === canvas || (id && c.canvas && c.canvas.id === id))) {
                        c.destroy();
                    }
                });
            }
        } catch (e) {}
    }
    if (id && window.chartInstances && window.chartInstances[id]) {
        try {
            window.chartInstances[id].destroy();
        } catch (e) {}
        delete window.chartInstances[id];
    }
    if (canvas) {
        canvas.style.display = 'block';
    }
};

window.getCleanCanvas = function (canvasIdOrEl) {
    if (!canvasIdOrEl) return null;
    const oldCanvas = typeof canvasIdOrEl === 'string' ? document.getElementById(canvasIdOrEl) : canvasIdOrEl;
    if (!oldCanvas) return null;
    const canvasId = oldCanvas.id;

    // 1. Destroy all chart instances attached to this canvas
    window.destroyChartIfExists(oldCanvas);

    // 2. Replace with a brand-new pristine canvas element to eliminate all residual dimensions, scales, and state
    const newCanvas = document.createElement('canvas');
    if (canvasId) newCanvas.id = canvasId;
    if (oldCanvas.className) newCanvas.className = oldCanvas.className;
    newCanvas.style.display = 'block';
    newCanvas.style.width = '100%';
    newCanvas.style.height = '100%';

    const parent = oldCanvas.parentNode;
    if (parent) {
        parent.replaceChild(newCanvas, oldCanvas);
    }
    return newCanvas;
};


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

window.showError = function (msg) {
    const el = document.getElementById('error-message');
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
    }
    window.safeSetText('last-sync', 'Error');
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

window.normalizeTo12H = function (str) {
    if (!str || typeof str !== 'string') return '';
    str = str.trim();
    if (!str) return '';

    // Check 12-hour with am/pm: "8:30 AM", "1:15pm", "12:00 PM"
    const match12 = str.match(/^([0-1]?[0-9])(?::([0-5][0-9]))?\s*([ap]\.?m\.?)$/i);
    if (match12) {
        let h = parseInt(match12[1], 10);
        const m = match12[2] ? match12[2].padStart(2, '0') : '00';
        const mer = match12[3].toLowerCase().startsWith('p') ? 'PM' : 'AM';
        if (h === 0) h = 12;
        if (h > 12) h = h % 12 || 12;
        return `${h}:${m} ${mer}`;
    }

    // Check 24-hour: "14:30", "08:15", "00:30"
    const match24 = str.match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/);
    if (match24) {
        let h = parseInt(match24[1], 10);
        const m = match24[2];
        const mer = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${m} ${mer}`;
    }

    // Check single number with am/pm: "8am", "7pm"
    const matchSimple = str.match(/^([0-1]?[0-9])\s*([ap]\.?m\.?)$/i);
    if (matchSimple) {
        let h = parseInt(matchSimple[1], 10);
        const mer = matchSimple[2].toLowerCase().startsWith('p') ? 'PM' : 'AM';
        if (h === 0) h = 12;
        if (h > 12) h = h % 12 || 12;
        return `${h}:00 ${mer}`;
    }

    // Single number e.g. "8" or "14"
    const matchNum = str.match(/^([0-1]?[0-9]|2[0-3])$/);
    if (matchNum) {
        let h = parseInt(matchNum[1], 10);
        if (h >= 12) {
            return `${h % 12 || 12}:00 PM`;
        } else if (h >= 7) {
            return `${h}:00 AM`;
        } else if (h >= 1) {
            return `${h}:00 PM`;
        }
        return `12:00 AM`;
    }

    return str;
};

window.formatTo12H = function (timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return '';
    timeStr = timeStr.trim();
    if (!timeStr) return '';
    if (timeStr.toLowerCase().includes('am') || timeStr.toLowerCase().includes('pm')) {
        return window.normalizeTo12H(timeStr);
    }
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    let h = parseInt(parts[0], 10);
    const mins = parts[1].slice(0, 2).padStart(2, '0');
    if (isNaN(h)) return timeStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${mins} ${ampm}`;
};
