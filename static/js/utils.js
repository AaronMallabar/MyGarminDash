/**
 * Utility Functions for Garmin Dashboard
 * Helper functions for date/time formatting, DOM manipulation, and conversions
 */

// ============================================================================
// DATE & TIME UTILITIES
// ============================================================================

/**
 * Get local date string in YYYY-MM-DD format
 * @param {Date} date - Date object (defaults to today)
 * @returns {string} Date string in YYYY-MM-DD format
 */
function getLocalDateStr(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Parse YYYY-MM-DD string to Date object
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {Date} Date object
 */
function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/**
 * Check if a date object is today
 * @param {Date} date - Date object to check
 * @returns {boolean} True if it is today
 */
function isDateToday(date) {
    const d = new Date(date);
    const today = new Date();
    return d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear();
}

/**
 * Format duration in seconds to HH:MM:SS or MM:SS
 * @param {number} s - Duration in seconds
 * @returns {string} Formatted duration string
 */
function formatDuration(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
        ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
        : `${m}:${sec.toString().padStart(2, '0')}`;
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

/**
 * Format distance in both miles and kilometers
 * @param {number} miles - Distance in miles
 * @returns {string} Formatted string with both units
 */
function formatDualDistance(miles) {
    const km = (miles * 1.60934).toFixed(1);
    const mi = Number(miles).toFixed(1);
    return `${mi} mi / ${km} km`;
}

// ============================================================================
// DOM UTILITIES
// ============================================================================

/**
 * Safely set text content of an element by ID
 * @param {string} id - Element ID
 * @param {string} text - Text content to set
 */
function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

/**
 * Show error message to user
 * @param {string} msg - Error message to display
 */
function showError(msg) {
    const el = document.getElementById('error-message');
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
    }
    safeSetText('last-sync', 'Error');
}

// ============================================================================
// ACTIVITY UTILITIES
// ============================================================================

/**
 * Get emoji icon for activity type
 * @param {string} type - Activity type key (lowercase)
 * @returns {string} Emoji icon
 */
function getActivityIcon(type) {
    if (type.includes('running')) return '🏃';
    if (type.includes('cycling') || type.includes('ride')) return '🚴';
    if (type.includes('swimming')) return '🏊';
    if (type.includes('walking')) return '🚶';
    if (type.includes('strength')) return '💪';
    return '⚡';
}

/**
 * Get power zone color based on wattage
 * @param {number} power - Power in watts
 * @returns {string} Hex color code
 */
function getPowerZoneColor(power) {
    if (power >= 450) return '#a855f7'; // Purple - Z7
    if (power >= 350) return '#ef4444'; // Red - Z6
    if (power >= 300) return '#f97316'; // Orange - Z5
    if (power >= 250) return '#eab308'; // Yellow - Z4
    if (power >= 200) return '#22c55e'; // Green - Z3
    if (power >= 150) return '#3b82f6'; // Blue - Z2
    return '#94a3b8'; // Grey - Z1
}

/**
 * Get heart rate zone color
 * @param {number} hr - Heart rate in bpm
 * @param {number[]} zones - Array of 5 HR zone thresholds
 * @returns {string} Hex color code
 */
function getHRZoneColor(hr, zones) {
    if (hr >= zones[4]) return '#a855f7'; // Z5
    if (hr >= zones[3]) return '#ef4444'; // Z4
    if (hr >= zones[2]) return '#f97316'; // Z3
    if (hr >= zones[1]) return '#22c55e'; // Z2
    if (hr >= zones[0]) return '#3b82f6'; // Z1
    return '#94a3b8'; // Resting
}

/**
 * Get stress level color
 * @param {number} stress - Stress level value
 * @returns {string} Hex color code
 */
function getStressColor(stress) {
    if (stress < 0) return 'rgba(148, 163, 184, 0.1)';
    if (stress <= 25) return '#94a3b8';
    if (stress <= 50) return '#f97316';
    if (stress <= 75) return '#f43f5e';
    return '#ef4444';
}
