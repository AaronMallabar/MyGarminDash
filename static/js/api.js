/**
 * API Layer for Garmin Dashboard
 * All API calls and data fetching logic
 */

// ============================================================================
// MAIN DATA FETCHING
// ============================================================================

/**
 * Fetch all dashboard data
 */
async function fetchDashboardData() {
    try {
        // Fetch basic stats
        const statsRes = await fetch('/api/stats');
        if (statsRes.ok) {
            const stats = await statsRes.json();
            if (!stats.error) {
                updateDashboard(stats);
            } else {
                showError(stats.error);
            }
        }

        // Fetch Goals Config
        const goalsConfigRes = await fetch('/api/goals_config');
        if (goalsConfigRes.ok) {
            updateLongtermStats(await goalsConfigRes.json());
        }

        // Fetch YTD data
        const ytdRes = await fetch('/api/ytd');
        if (ytdRes.ok) {
            const ytd = await ytdRes.json();
            renderYTDCharts(ytd);
        }

        // Fetch activity heatmap
        fetchActivityHeatmap();

        // Fetch history data with current ranges
        fetchWeightHistory();
        fetchStepsHistory();
        fetchHRHistory();
        fetchStressHistory();
        fetchSleepHistory();
        fetchHydrationHistory();

        safeSetText('last-sync', `Last synced: ${new Date().toLocaleTimeString()}`);
    } catch (error) {
        console.error('Error fetching data:', error);
        showError('Failed to load dashboard data');
    }
}

// ============================================================================
// ACTIVITY DATA
// ============================================================================

/**
 * Fetch activity heatmap data
 */
async function fetchActivityHeatmap() {
    try {
        const res = await fetch('/api/activity_heatmap');
        if (res.ok) {
            renderActivityHeatmap(await res.json());
        }
    } catch (err) {
        console.error('Heatmap error:', err);
    }
}

/**
 * Fetch activity detail data
 * @param {number} id - Activity ID
 * @returns {Promise<Object>} Activity detail data
 */
async function fetchActivityDetail(id) {
    const res = await fetch(`/api/activity/${id}`);
    if (res.ok) {
        return await res.json();
    }
    throw new Error('Failed to fetch activity details');
}

// ============================================================================
// WEIGHT DATA
// ============================================================================

/**
 * Fetch weight history
 */
async function fetchWeightHistory() {
    try {
        const endDate = window.currentWeightEndDate || new Date();
        const range = window.currentWeightRange || '1m';
        const res = await fetch(`/api/weight_history?end_date=${getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                renderWeightChart(data, range);
            }
        }
    } catch (err) {
        console.error('Weight history error:', err);
    }
}

/**
 * Log weight
 * @param {number} weightLbs - Weight in pounds
 */
async function logWeight(weightLbs) {
    try {
        const res = await fetch('/api/log_weight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weight_lbs: weightLbs })
        });
        if (res.ok) {
            closeWeightModal();
            fetchWeightHistory();
        } else {
            alert('Failed to log weight');
        }
    } catch (err) {
        console.error('Error logging weight:', err);
        alert('Error logging weight');
    }
}

// ============================================================================
// STEPS DATA
// ============================================================================

/**
 * Fetch steps history
 */
async function fetchStepsHistory() {
    try {
        const endDate = window.currentStepsEndDate || new Date();
        const range = window.currentStepsRange || '1w';
        const res = await fetch(`/api/steps_history?end_date=${getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                renderStepsVisual(data);
            }
        }
    } catch (err) {
        console.error('Steps history error:', err);
    }
}

// ============================================================================
// HEART RATE DATA
// ============================================================================

/**
 * Fetch heart rate history
 */
async function fetchHRHistory() {
    try {
        const endDate = window.currentHREndDate || new Date();
        const range = window.currentHRRange || '1d';
        const res = await fetch(`/api/hr_history?end_date=${getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                renderHRVisual(data);
            }
        }
    } catch (err) {
        console.error('HR History error:', err);
    }
}

// ============================================================================
// STRESS DATA
// ============================================================================

/**
 * Fetch stress history
 */
async function fetchStressHistory() {
    try {
        const endDate = window.currentStressEndDate || new Date();
        const range = window.currentStressRange || '1d';
        const res = await fetch(`/api/stress_history?end_date=${getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                renderStressVisual(data);
            }
        }
    } catch (err) {
        console.error('Stress history error:', err);
    }
}

// ============================================================================
// SLEEP DATA
// ============================================================================

/**
 * Fetch sleep history
 */
async function fetchSleepHistory() {
    try {
        const endDate = window.currentSleepEndDate || new Date();
        const range = window.currentSleepRange || '1d';
        const res = await fetch(`/api/sleep_history?end_date=${getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                renderSleepVisual(data);
            }
        }
    } catch (err) {
        console.error('Sleep history error:', err);
    }
}

// ============================================================================
// HYDRATION DATA
// ============================================================================

/**
 * Fetch hydration history
 */
async function fetchHydrationHistory() {
    try {
        const date = window.currentHydrationDate || new Date();
        const res = await fetch(`/api/hydration?date=${getLocalDateStr(date)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                window.currentHydrationData = data;
                renderHydrationVisual();
            }
        }
    } catch (err) {
        console.error('Hydration error:', err);
    }
}
