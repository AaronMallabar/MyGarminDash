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
        let isOffline = false;
        let bootstrapSuccess = false;

        // 1. Instant Consolidated Bootstrap Request
        try {
            const bootRes = await fetch('/api/dashboard_bootstrap');
            if (bootRes.ok) {
                const boot = await bootRes.json();
                if (!boot.error) {
                    bootstrapSuccess = true;
                    isOffline = (boot.stats || {}).offline_mode;

                    // Hydrate dashboard cards & stats
                    if (boot.stats && window.updateDashboard) {
                        window.updateDashboard(boot.stats, boot.today_1d, boot.history);
                    }

                    // Hydrate goals config & donut meters
                    if (boot.goals_config && window.updateGoalsConfig) {
                        window.updateGoalsConfig(boot.goals_config);
                    }

                    // Hydrate YTD charts
                    if (boot.ytd && window.renderYTDChart) {
                        window.renderYTDChart('ytdCyclingChart', boot.ytd.labels, boot.ytd.cycling);
                        window.renderYTDChart('ytdRunningChart', boot.ytd.labels, boot.ytd.running);
                    }

                    // Cache 1w / 1m historical data from bootstrap payload
                    const hist = boot.history || {};
                    const today1d = boot.today_1d || {};
                    const todayObj = new Date();

                    if (window.populateChartCache) {
                        if (hist.steps) window.populateChartCache('steps', '1w', todayObj, hist.steps);
                        if (hist.hr) window.populateChartCache('hr', '1w', todayObj, hist.hr);
                        if (hist.stress) window.populateChartCache('stress', '1w', todayObj, hist.stress);
                        if (hist.sleep) window.populateChartCache('sleep', '1w', todayObj, hist.sleep);
                        if (hist.weight) window.populateChartCache('weight', '1m', todayObj, hist.weight);
                        if (hist.hydration) window.populateChartCache('hydration', '1w', todayObj, hist.hydration);
                        if (hist.hrv) window.populateChartCache('hrv', '1w', todayObj, hist.hrv);
                        if (hist.intensity_minutes) window.populateChartCache('intensity_minutes', '1w', todayObj, hist.intensity_minutes);

                        // Cache 1d items
                        if (today1d.sleep) window.populateChartCache('sleep', '1d', todayObj, today1d.sleep);
                        if (today1d.hydration) window.populateChartCache('hydration', '1d', todayObj, today1d.hydration);
                        if (today1d.hrv) window.populateChartCache('hrv', '1d', todayObj, today1d.hrv);
                        if (today1d.hr) window.populateChartCache('hr', '1d', todayObj, today1d.hr);
                        if (today1d.stress) window.populateChartCache('stress', '1d', todayObj, today1d.stress);
                        if (today1d.intensity_minutes) window.populateChartCache('intensity_minutes', '1d', todayObj, today1d.intensity_minutes);
                    }

                    // Render active 1d / default views
                    if (today1d.sleep && window.renderSleepVisual) {
                        window.renderSleepVisual(today1d.sleep);
                    }
                    if (today1d.hydration && window.renderHydrationVisual) {
                        window.renderHydrationVisual(today1d.hydration);
                    }
                    if (today1d.hrv && window.renderHRVVisual) {
                        window.renderHRVVisual(today1d.hrv);
                    }
                    if (today1d.hr && window.renderHRVisual) {
                        window.renderHRVisual(today1d.hr);
                    }
                    if (today1d.stress && window.renderStressVisual) {
                        window.renderStressVisual(today1d.stress);
                    }
                    if (hist.steps && window.renderStepsVisual) {
                        window.renderStepsVisual(hist.steps);
                    }
                    if (hist.weight && window.renderWeightChart) {
                        window.renderWeightChart(hist.weight, '1m');
                    }
                    if (today1d.intensity_minutes && window.renderIntensityMinutesVisualV2) {
                        window.renderIntensityMinutesVisualV2(today1d.intensity_minutes);
                    } else if (hist.intensity_minutes && window.renderIntensityMinutesVisualV2) {
                        window.renderIntensityMinutesVisualV2(hist.intensity_minutes);
                    }

                    if (boot.ai_insights && window.renderAIInsights) {
                        window.renderAIInsights(boot.ai_insights);
                    }

                    if (window.safeSetText) {
                        if (isOffline) {
                            window.safeSetText('last-sync', 'Offline Mode');
                        } else {
                            window.safeSetText('last-sync', `Last synced: ${new Date().toLocaleTimeString()}`);
                        }
                    }

                    if (isOffline && window.showError) {
                        window.showError("⚠️ Cannot connect to Garmin Connect. Dashboard is running in Offline Cached Mode.");
                    }
                }
            }
        } catch (bootErr) {
            console.warn('Bootstrap fetch failed, falling back to modular endpoints:', bootErr);
        }

        // 2. Secondary asynchronous loaders (Calendar, Nutrition, Calorie History)
        if (bootstrapSuccess) {
            // Bootstrap already loaded & cached stats, today_1d, history, goals, and YTD.
            // Fire secondary sub-panels in background without blocking dashboard readiness.
            Promise.allSettled([
                window.fetchCalendarData ? window.fetchCalendarData() : Promise.resolve(),
                window.fetchNutritionData ? window.fetchNutritionData() : Promise.resolve(),
                window.fetchCalorieHistory ? window.fetchCalorieHistory() : Promise.resolve()
            ]).catch(err => console.warn('Secondary data fetch issue:', err));
        } else {
            // Fallback to legacy individual fetches if bootstrap did not succeed
            const fallbackPromises = [
                window.fetchCalendarData ? window.fetchCalendarData() : Promise.resolve(),
                window.fetchNutritionData ? window.fetchNutritionData() : Promise.resolve(),
                window.fetchCalorieHistory ? window.fetchCalorieHistory() : Promise.resolve(),
                window.fetchWeightHistory ? window.fetchWeightHistory() : Promise.resolve(),
                window.fetchStepsHistory ? window.fetchStepsHistory() : Promise.resolve(),
                window.fetchHRHistory ? window.fetchHRHistory() : Promise.resolve(),
                window.fetchStressHistory ? window.fetchStressHistory() : Promise.resolve(),
                window.fetchSleepHistory ? window.fetchSleepHistory() : Promise.resolve(),
                window.fetchHydrationHistory ? window.fetchHydrationHistory() : Promise.resolve(),
                window.fetchHRVHistory ? window.fetchHRVHistory() : Promise.resolve(),
                window.fetchIMHistory ? window.fetchIMHistory() : Promise.resolve()
            ];

            // Fetch basic stats
            const statsRes = await fetch('/api/stats');
            if (statsRes.ok) {
                const stats = await statsRes.json();
                if (!stats.error) {
                    isOffline = stats.offline_mode;
                    if (window.updateDashboard) window.updateDashboard(stats);
                }
            }

            const [goalsRes, ltRes, ytdRes] = await Promise.allSettled([
                fetch('/api/goals_config'),
                fetch('/api/longterm_stats'),
                fetch('/api/ytd_mileage_comparison')
            ]);

            if (goalsRes.status === 'fulfilled' && goalsRes.value.ok) {
                const goalsConfig = await goalsRes.value.json();
                if (!goalsConfig.error) {
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
                if (!ytdData.error && window.renderYTDChart) {
                    window.renderYTDChart('ytdCyclingChart', ytdData.labels, ytdData.cycling);
                    window.renderYTDChart('ytdRunningChart', ytdData.labels, ytdData.running);
                }
            }

            await Promise.allSettled(fallbackPromises);
        }

        // Background / Low-priority tasks
        if (window.fetchAIInsights) window.fetchAIInsights(false);
        if (window.fetchProactiveSuggestions) window.fetchProactiveSuggestions();

        setTimeout(() => {
            window.fetchActivityHeatmap();
            if (window.updateGlobalHeatmap) window.updateGlobalHeatmap();
        }, 1200);

    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        if (window.showError) window.showError('Failed to load dashboard data');
    }
};

/**
 * Format a cache age into a human-readable string
 */
function formatCacheAge(seconds) {
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
}

/**
 * Update the cache age badge in the AI header
 */
function updateCacheAgeBadge(data) {
    let badge = document.getElementById('ai-cache-age');
    if (!badge) {
        const header = document.querySelector('.ai-header');
        if (header) {
            badge = document.createElement('div');
            badge.id = 'ai-cache-age';
            badge.style.cssText = 'font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7; margin-left: 0.5rem;';
            header.appendChild(badge);
        }
    }
    if (badge && data.cache_age_seconds !== undefined) {
        badge.textContent = `Updated ${formatCacheAge(data.cache_age_seconds)}`;
        badge.title = data.cached_at ? `Cached at: ${new Date(data.cached_at * 1000).toLocaleString()}` : '';
    }
}

/**
 * Ensure the refresh button exists in the AI header
 */
function ensureRefreshButton() {
    if (document.getElementById('ai-refresh-btn')) return;
    const header = document.querySelector('.ai-header');
    if (!header) return;

    const btn = document.createElement('button');
    btn.id = 'ai-refresh-btn';
    btn.innerHTML = '🔄 Refresh';
    btn.title = 'Force refresh AI insights (fetches new analysis from AI)';
    btn.style.cssText = `
        background: rgba(56, 189, 248, 0.1);
        border: 1px solid rgba(56, 189, 248, 0.3);
        color: #38bdf8;
        padding: 0.3rem 0.7rem;
        border-radius: 0.5rem;
        cursor: pointer;
        font-size: 0.75rem;
        font-weight: 600;
        transition: all 0.2s;
        margin-left: auto;
    `;
    btn.onmouseover = () => { btn.style.background = 'rgba(56, 189, 248, 0.25)'; };
    btn.onmouseout = () => { btn.style.background = 'rgba(56, 189, 248, 0.1)'; };
    btn.onclick = () => {
        if (window.fetchAIInsights) window.fetchAIInsights(true);
    };
    header.appendChild(btn);
}

/**
 * Render structured AI Insights into Hero banner, metric pills, and briefing modal
 */
window.renderAIInsights = function (data) {
    if (!data) return;

    // 1. Daily Readiness Hero Banner
    const scoreEl = document.getElementById('ai-readiness-score');
    const gaugeCircle = document.getElementById('readiness-gauge-circle');
    const catEl = document.getElementById('ai-readiness-category');
    const headlineEl = document.getElementById('ai-headline');
    const workoutEl = document.getElementById('ai-recommended-workout');
    const prescriptionBox = document.getElementById('ai-prescription-box');
    const modelLabel = document.getElementById('ai-model-name');
    const modalModelBadge = document.getElementById('modal-ai-model-badge');

    const score = Math.round(data.readiness_score || 85);
    if (scoreEl) scoreEl.textContent = score;
    if (gaugeCircle) {
        gaugeCircle.setAttribute('stroke-dasharray', `${score}, 100`);
        if (score >= 80) {
            gaugeCircle.style.stroke = '#38bdf8';
        } else if (score >= 60) {
            gaugeCircle.style.stroke = '#4ade80';
        } else {
            gaugeCircle.style.stroke = '#fbbf24';
        }
    }

    if (catEl) {
        catEl.textContent = data.readiness_category || (score >= 80 ? 'Optimal' : (score >= 60 ? 'Good' : 'Moderate'));
        if (score >= 80) {
            catEl.style.color = '#38bdf8';
            catEl.style.borderColor = 'rgba(56, 189, 248, 0.4)';
            catEl.style.background = 'rgba(56, 189, 248, 0.15)';
        } else if (score >= 60) {
            catEl.style.color = '#4ade80';
            catEl.style.borderColor = 'rgba(74, 222, 128, 0.4)';
            catEl.style.background = 'rgba(74, 222, 128, 0.15)';
        } else {
            catEl.style.color = '#fbbf24';
            catEl.style.borderColor = 'rgba(251, 191, 36, 0.4)';
            catEl.style.background = 'rgba(251, 191, 36, 0.15)';
        }
    }

    if (headlineEl && data.headline) {
        headlineEl.textContent = data.headline;
    }

    if (workoutEl && data.recommended_workout) {
        workoutEl.textContent = data.recommended_workout;
        if (prescriptionBox) prescriptionBox.style.display = 'inline-flex';
    }

    const formattedModel = data.model_name && window.formatModelName ? window.formatModelName(data.model_name) : (data.model_name || '');
    if (modelLabel) modelLabel.textContent = formattedModel;
    if (modalModelBadge) modalModelBadge.textContent = formattedModel;

    // 2. Micro-Insights into Health Cards (Glance Blurbs)
    const glance = data.glance_insights || {};
    const mapping = {
        'steps': glance.steps,
        'sleep': glance.sleep,
        'hydration': glance.hydration,
        'hr': glance.heart_rate || glance.hr,
        'stress': glance.stress,
        'hrv': glance.hrv,
        'im': glance.intensity || glance.im || glance.intensity_minutes,
        'weight': glance.weight
    };

    for (const [key, text] of Object.entries(mapping)) {
        const blurbEl = document.getElementById(`ai-blurb-${key}`);
        const pillEl = document.getElementById(`ai-pill-${key}`);
        if (blurbEl && text) {
            blurbEl.textContent = text;
            if (pillEl) pillEl.style.display = 'flex';
        }
    }

    // 3. Full Briefing Modal Content
    if (window.safeSetHTML) {
        window.safeSetHTML('ai-daily-summary', data.daily_summary || 'No summary available.');
        window.safeSetHTML('ai-yesterday-summary', data.yesterday_summary || 'No recap available.');
        window.safeSetHTML('ai-suggestions', data.suggestions || 'No suggestions available.');
    }

    // Top highlights chips in briefing modal
    const highlightsContainer = document.getElementById('ai-top-highlights');
    if (highlightsContainer) {
        const highlights = data.top_highlights || [];
        if (highlights.length > 0) {
            highlightsContainer.innerHTML = highlights.map(h => `<span class="ai-highlight-chip">${h}</span>`).join('');
            highlightsContainer.style.display = 'flex';
        } else {
            highlightsContainer.style.display = 'none';
        }
    }

    // Cache activity insights
    if (data.activity_insights) {
        data.activity_insights.forEach(insight => {
            if (insight.activity_id) window.cachedActivityInsights[insight.activity_id] = insight;
        });
    }
};

/**
 * Fetch and render AI Insights
 * @param {boolean} forceRefresh - If true, bypass cache and regenerate from AI
 */
window.fetchAIInsights = async function (forceRefresh = false) {
    const headlineEl = document.getElementById('ai-headline');
    const refreshBtn = document.getElementById('ai-refresh-btn');

    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.style.opacity = '0.5';
    }

    if (forceRefresh && headlineEl) {
        headlineEl.textContent = "Connecting to AI analyst & synthesizing fresh biometrics...";
    }

    try {
        const url = forceRefresh ? '/api/ai_insights?force_refresh=true' : '/api/ai_insights';
        const res = await fetch(url);

        if (res.ok) {
            const data = await res.json();

            if (data.error) {
                if (headlineEl) {
                    headlineEl.textContent = `Analysis notice: ${data.error}`;
                }
                return;
            }

            // Render all components
            window.renderAIInsights(data);
        } else {
            throw new Error(`Server responded with ${res.status}`);
        }
    } catch (err) {
        console.error('AI insights error:', err);
        if (headlineEl) {
            headlineEl.textContent = "Athlete Intelligence is currently in offline mode.";
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
        }
    }
};

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
        const endDate = window.currentHydrationEndDate || new Date();
        const range = window.currentHydrationRange || '1d';

        if (range === '1y' && window.isDateToday(endDate) && window.preloadedData['hydration']) {
            if (window.renderHydrationVisual) await window.renderHydrationVisual(window.preloadedData['hydration']);
            return;
        }

        const res = await fetch(`/api/hydration_history?end_date=${window.getLocalDateStr(endDate)}&range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.error) {
                if (window.renderHydrationVisual) await window.renderHydrationVisual(data);
            }
        }
    } catch (err) {
        console.error('Hydration history error:', err);
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
 * Preload 1-year data for all metrics lazily in the background
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

    // Stagger one-by-one so background preloading never competes with user actions
    for (const ep of endpoints) {
        try {
            await new Promise(r => setTimeout(r, 600));
            const res = await fetch(ep.url);
            if (res.ok) {
                const data = await res.json();
                if (data && !data.error) {
                    preloadedData[ep.key] = data;
                }
            }
        } catch (err) {
            // Silently ignore background preloading errors
        }
    }
}

