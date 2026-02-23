/**
 * API Layer for Garmin Dashboard
 * All API calls and data fetching logic
 */

// ============================================================================
// MAIN DATA FETCHING
// ============================================================================

// Cache for preloaded long-term data
window.preloadedData = {};
window.cachedActivityInsights = {};

window.fetchDashboardData = async function () {
    try {
        // Delay AI Insights and background preload slightly to ensure primary fetches fire instantly
        setTimeout(() => {
            if (window.fetchAIInsights) window.fetchAIInsights();
            if (typeof preloadYearlyData === 'function') preloadYearlyData();
        }, 50);

        // Fetch history data with current ranges concurrently right away
        window.fetchWeightHistory();
        window.fetchStepsHistory();
        window.fetchHRHistory();
        window.fetchStressHistory();
        window.fetchSleepHistory();
        window.fetchHydrationHistory();
        window.fetchHRVHistory();
        window.fetchIMHistory();
        window.fetchCalendarData();
        window.fetchNutritionData();
        window.fetchCalorieHistory();

        // Fetch basic stats
        const statsRes = await fetch('/api/stats');
        if (statsRes.ok) {
            const stats = await statsRes.json();
            if (!stats.error) {
                if (window.updateDashboard) window.updateDashboard(stats);
            } else {
                if (window.showError) window.showError(stats.error);
            }
        }

        // Fetch configurations and summaries
        const [goalsRes, ltRes, ytdRes] = await Promise.allSettled([
            fetch('/api/goals_config'),
            fetch('/api/longterm_stats'),
            fetch('/api/ytd_mileage_comparison')
        ]);

        if (goalsRes.status === 'fulfilled' && goalsRes.value.ok) {
            const goalsConfig = await goalsRes.value.json();
            if (!goalsConfig.error) {
                // If ltStats also loaded, attach actuals to the goalsConfig
                if (ltRes.status === 'fulfilled' && ltRes.value.ok) {
                    const ltStats = await ltRes.value.json();
                    if (!ltStats.error) {
                        goalsConfig.monthly.running_actual = (ltStats.month || {}).running || 0;
                        goalsConfig.monthly.cycling_actual = (ltStats.month || {}).cycling || 0;
                        goalsConfig.yearly.running_actual = (ltStats.year || {}).running || 0;
                        goalsConfig.yearly.cycling_actual = (ltStats.year || {}).cycling || 0;
                    }
                }
                if (window.updateGoalsConfig) window.updateGoalsConfig(goalsConfig);
            }
        }

        if (ytdRes.status === 'fulfilled' && ytdRes.value.ok) {
            const ytdData = await ytdRes.value.json();
            if (!ytdData.error) {
                if (window.renderYTDChart) {
                    window.renderYTDChart('ytdCyclingChart', ytdData.labels, ytdData.cycling);
                    window.renderYTDChart('ytdRunningChart', ytdData.labels, ytdData.running);
                }
            }
        }


        // Heavy Route Overlays (LOWEST PRIORITY)
        setTimeout(() => {
            window.fetchActivityHeatmap();
            if (window.updateGlobalHeatmap) window.updateGlobalHeatmap();
        }, 1500);

        if (window.safeSetText) window.safeSetText('last-sync', `Last synced: ${new Date().toLocaleTimeString()}`);
    } catch (error) {
        console.error('Error fetching data:', error);
        if (window.showError) window.showError('Failed to load dashboard data');
    }
}

/**
 * Fetch and render AI Insights
 */
window.fetchAIInsights = async function () {
    const thinking = document.getElementById('ai-thinking');
    const grid = document.getElementById('ai-content-grid');
    const error = document.getElementById('ai-error');
    const modelLabel = document.getElementById('ai-model-name');
    const section = document.getElementById('ai-insights-section');

    if (section) section.style.display = 'block';
    if (thinking) thinking.style.display = 'flex';
    if (grid) grid.style.display = 'none';
    if (error) error.style.display = 'none';

    // Creative thinking messages
    const messages = [
        "Scanning metabolic history...",
        "Calculating power-to-weight trends...",
        "Analyzing recovery efficiency...",
        "Identifying training outliers...",
        "Optimizing cardiac drift profiles...",
        "Benchmarking YTD milestones...",
        "Synthesizing coach insights..."
    ];
    let msgIdx = 0;
    const msgEl = document.getElementById('ai-loading-msg');
    const interval = setInterval(() => {
        if (msgEl) {
            msgEl.style.opacity = 0;
            setTimeout(() => {
                msgEl.textContent = messages[msgIdx % messages.length];
                msgEl.style.opacity = 1;
                msgIdx++;
            }, 200);
        }
    }, 3000);

    try {
        const res = await fetch('/api/ai_insights');
        clearInterval(interval);

        if (res.ok) {
            const data = await res.json();

            if (data.error) {
                if (thinking) thinking.style.display = 'none';
                if (grid) grid.style.display = 'none';
                if (error) {
                    error.style.display = 'block';
                    const titleEl = document.getElementById('ai-err-title');
                    const detailsEl = document.getElementById('ai-err-details');

                    if (titleEl) titleEl.textContent = "Analysis Interrupted";
                    if (detailsEl) detailsEl.innerHTML = `<div style="margin-bottom: 0.5rem; font-weight: 600;">${data.error}</div><div style="font-size: 0.75rem; opacity: 0.7; font-family: monospace; background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: 0.25rem; overflow-x: auto; text-align: left;">${data.details || ''}</div>`;

                    if (data.error.toLowerCase().includes('quota') || data.error.includes('429')) {
                        if (titleEl) titleEl.textContent = "Model Capacity Reached";
                    }
                }
                return;
            }

            if (thinking) thinking.style.display = 'none';
            if (grid) grid.style.display = 'grid';

            if (window.safeSetHTML) {
                window.safeSetHTML('ai-daily-summary', data.daily_summary);
                window.safeSetHTML('ai-yesterday-summary', data.yesterday_summary);
                window.safeSetHTML('ai-suggestions', data.suggestions);
            }

            const titleEl = document.getElementById('ai-insight-title');
            if (titleEl) {
                titleEl.textContent = data.is_ai ? "AI Training Insight" : "Training Insight";
            }

            if (data.model_name) {
                window.cachedModelName = data.model_name;
                if (modelLabel && window.formatModelName) modelLabel.textContent = window.formatModelName(data.model_name);
            }

            if (data.activity_insights) {
                data.activity_insights.forEach(insight => {
                    if (insight.activity_id) window.cachedActivityInsights[insight.activity_id] = insight;
                });
            }
        } else {
            throw new Error(`Server responded with ${res.status}`);
        }
    } catch (err) {
        clearInterval(interval);
        console.error('AI insights error:', err);
        if (thinking) thinking.style.display = 'none';
        if (grid) grid.style.display = 'none';
        if (error) {
            error.style.display = 'block';
            const titleEl = document.getElementById('ai-err-title');
            const detailsEl = document.getElementById('ai-err-details');
            if (titleEl) titleEl.textContent = "Connection Terminated";
            if (detailsEl) detailsEl.textContent = err.message || "The analyst core is currently offline.";
        }
    }
}

/**
 * Fetch calendar activities
 */
window.fetchCalendarData = async function () {
    let startStr, endStr;
    const date = window.calendarDate || new Date();
    const view = window.currentCalendarView || 'month';
    const year = date.getFullYear();
    const month = date.getMonth();

    if (view === 'year') {
        startStr = `${year}-01-01`; endStr = `${year}-12-31`;
    } else if (view === 'month') {
        const first = new Date(year, month, 1);
        const last = new Date(year, month + 1, 0);
        const startPad = (first.getDay() + 6) % 7;
        const endPad = 6 - ((last.getDay() + 6) % 7);
        startStr = window.getLocalDateStr(new Date(year, month, 1 - startPad));
        endStr = window.getLocalDateStr(new Date(year, month + 1, endPad));
    } else {
        const day = date.getDay();
        const diff = date.getDate() - day + (day == 0 ? -6 : 1);
        const start = new Date(date); start.setDate(diff);
        const end = new Date(start); end.setDate(start.getDate() + 6);
        startStr = window.getLocalDateStr(start); endStr = window.getLocalDateStr(end);
    }

    try {
        const res = await fetch(`/api/calendar_activities?start_date=${startStr}&end_date=${endStr}`);
        if (res.ok) {
            const activities = await res.json();
            if (window.renderDetailedCalendar) window.renderDetailedCalendar(activities, year, month);
        }
    } catch (e) { console.error("Calendar fetch error", e); }
}

/**
 * Fetch calorie history for trends chart
 */
window.fetchCalorieHistory = async function () {
    try {
        const endDate = window.currentCalorieEndDate || new Date();
        const range = window.currentCalorieRange || '1w';
        if (window.updateCalorieRange) {
            await window.updateCalorieRange(null, null);
        } else {
            const res = await fetch(`/api/calorie_history?range=${range}&end_date=${window.getLocalDateStr(endDate)}`);
            if (res.ok) {
                const data = await res.json();
                if (!data.error && window.renderCalorieChart) {
                    window.renderCalorieChart(data);
                    if (window.updateCalorieRangeLabel) window.updateCalorieRangeLabel();
                }
            }
        }
    } catch (err) {
        console.error('Calorie history error:', err);
    }
};

/**
 * Fetch nutrition data
 */
window.fetchNutritionData = async function () {
    try {
        const dateStr = window.getLocalDateStr(window.activeNutritionDate || new Date());
        const [logsRes, customRes] = await Promise.all([
            fetch(`/api/nutrition/logs?date=${dateStr}`),
            fetch('/api/nutrition/custom_foods')
        ]);

        if (logsRes.ok) {
            const logs = await logsRes.json();
            const analysisUrl = `/api/nutrition/analysis?date=${dateStr}&no_ai=true`;
            const statsRes = await fetch(analysisUrl);
            const analysisData = await statsRes.json();

            let metabolic = { total: 0, active: 0, resting: 0 };
            if (analysisData.metabolic) {
                metabolic = analysisData.metabolic;
            }

            if (window.updateNutritionUI) window.updateNutritionUI(logs, metabolic, analysisData.analysis);
        }
        if (customRes.ok) {
            window.customFoods = await customRes.json();
        }
    } catch (err) {
        console.error("Nutrition fetch error:", err);
    }
}

// ============================================================================
// ACTIVITY DATA
// ============================================================================

/**
 * Fetch activity heatmap data
 */
window.fetchActivityHeatmap = async function fetchActivityHeatmap() {
    try {
        const res = await fetch('/api/activity_heatmap');
        if (res.ok) {
            if (window.renderActivityHeatmap) window.renderActivityHeatmap(await res.json());
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
window.fetchWeightHistory = async function () {
    try {
        const endDate = window.currentWeightEndDate || new Date();
        const range = window.currentWeightRange || '1m';

        // Check cache for 1y
        if (range === '1y' && window.isDateToday(endDate) && window.preloadedData['weight']) {
            if (window.renderWeightChart) window.renderWeightChart(window.preloadedData['weight'], range);
            return;
        }

        const res = await fetch(`/api/weight_history?end_date=${window.getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                if (window.renderWeightChart) window.renderWeightChart(data, range);
            }
        }
    } catch (err) {
        console.error('Weight history error:', err);
    }
}


// ============================================================================
// STEPS DATA
// ============================================================================

/**
 * Fetch steps history
 */
window.fetchStepsHistory = async function () {
    try {
        const endDate = window.currentStepsEndDate || new Date();
        const range = window.currentStepsRange || '1w';

        if (range === '1y' && window.isDateToday(endDate) && window.preloadedData['steps']) {
            if (window.renderStepsVisual) window.renderStepsVisual(window.preloadedData['steps']);
            return;
        }

        const res = await fetch(`/api/steps_history?end_date=${window.getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                if (window.renderStepsVisual) window.renderStepsVisual(data);
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
window.fetchHRHistory = async function () {
    try {
        const endDate = window.currentHREndDate || new Date();
        const range = window.currentHRRange || '1d';

        if (range === '1y' && window.isDateToday(endDate) && window.preloadedData['hr']) {
            if (window.renderHRVisual) window.renderHRVisual(window.preloadedData['hr']);
            return;
        }

        const res = await fetch(`/api/hr_history?end_date=${window.getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                if (window.renderHRVisual) window.renderHRVisual(data);
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
window.fetchStressHistory = async function () {
    try {
        const endDate = window.currentStressEndDate || new Date();
        const range = window.currentStressRange || '1d';

        if (range === '1y' && window.isDateToday(endDate) && window.preloadedData['stress']) {
            if (window.renderStressVisual) window.renderStressVisual(window.preloadedData['stress']);
            return;
        }

        const res = await fetch(`/api/stress_history?end_date=${window.getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                if (window.renderStressVisual) window.renderStressVisual(data);
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
window.fetchSleepHistory = async function () {
    try {
        const endDate = window.currentSleepEndDate || new Date();
        const range = window.currentSleepRange || '1d';

        if (range === '1y' && window.isDateToday(endDate) && window.preloadedData['sleep']) {
            if (window.renderSleepVisual) window.renderSleepVisual(window.preloadedData['sleep']);
            return;
        }

        const res = await fetch(`/api/sleep_history?end_date=${window.getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                if (window.renderSleepVisual) window.renderSleepVisual(data);
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
window.fetchHydrationHistory = async function () {
    try {
        const date = window.currentHydrationDate || new Date();
        const res = await fetch(`/api/hydration?date=${window.getLocalDateStr(date)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                window.currentHydrationData = data;
                if (window.renderHydrationVisual) window.renderHydrationVisual();
            }
        }
    } catch (err) {
        console.error('Hydration error:', err);
    }
}

// ============================================================================
// HRV DATA
// ============================================================================

/**
 * Fetch HRV data
 */
window.fetchHRVHistory = async function () {
    try {
        const endDate = window.currentHRVEndDate || new Date();
        const range = window.currentHRVRange || '1d';

        if (range === '1y' && window.isDateToday(endDate) && window.preloadedData['hrv']) {
            if (window.renderHRVVisual) window.renderHRVVisual(window.preloadedData['hrv']);
            return;
        }

        const res = await fetch(`/api/hrv?end_date=${window.getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                if (window.renderHRVVisual) window.renderHRVVisual(data);
            }
        }
    } catch (err) {
        console.error('HRV history error:', err);
    }
}

window.fetchIMHistory = async function () {
    try {
        const endDate = window.currentIMEndDate || new Date();
        const range = window.currentIMRange || '1w';

        const res = await fetch(`/api/intensity_minutes_history?range=${range}&end_date=${window.getLocalDateStr(endDate)}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error && window.renderIntensityMinutesVisualV2) {
                window.renderIntensityMinutesVisualV2(data);
            }
        }
    } catch (err) {
        console.error('IM history error:', err);
    }
}


/**
 * Preload 1-year data for all metrics
 */
async function preloadYearlyData() {
    const todayStr = window.getLocalDateStr(new Date());
    const endpoints = [
        { key: 'steps', url: `/api/steps_history?end_date=${todayStr}&range=1y` },
        { key: 'weight', url: `/api/weight_history?end_date=${todayStr}&range=1y` },
        { key: 'hr', url: `/api/hr_history?end_date=${todayStr}&range=1y` },
        { key: 'stress', url: `/api/stress_history?end_date=${todayStr}&range=1y` },
        { key: 'sleep', url: `/api/sleep_history?end_date=${todayStr}&range=1y` },
        { key: 'hydration', url: `/api/hydration_history?end_date=${todayStr}&range=1y` },
        { key: 'hrv', url: `/api/hrv?end_date=${todayStr}&range=1y` }
    ];



    // Fetch all in parallel
    // We don't await this function itself, but we handle promises here
    Promise.all(endpoints.map(ep =>
        fetch(ep.url)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && !data.error) {
                    preloadedData[ep.key] = data;
                    // console.log(`Preloaded ${ep.key} 1y data`);
                }
            })
            .catch(err => console.error(`Failed to preload ${ep.key}:`, err))
    ));
}

