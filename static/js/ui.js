/**
 * UI and Modal Management
 */

window.modalStates = {};

window.openModal = function (id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

window.openMetricDetail = function (metricKey) {
    const modal = document.getElementById('metricDetailModal');
    if (!modal) return;

    // Hide all metric detail panes
    document.querySelectorAll('.metric-detail-pane').forEach(pane => {
        pane.style.display = 'none';
    });

    // Show selected pane
    const targetPane = document.getElementById(`modal-pane-${metricKey}`);
    if (targetPane) {
        targetPane.style.display = 'block';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Highlight current active button for this pane
    const metricNameMap = {
        'weight': 'Weight',
        'steps': 'Steps',
        'sleep': 'Sleep',
        'stress': 'Stress',
        'hydration': 'Hydration',
        'hr': 'HR',
        'hrv': 'HRV',
        'im': 'IM'
    };
    const varName = metricNameMap[metricKey] || metricKey;
    const activeRange = window[`current${varName}Range`] || (metricKey === 'weight' ? '1m' : '1w');
    if (targetPane) {
        targetPane.querySelectorAll('.drilldown-range-btn').forEach(btn => {
            if (btn.getAttribute('onclick')?.includes(`'${activeRange}'`)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    if (window.updateMetricDatePill) {
        const endDate = window[`current${varName}EndDate`] || new Date();
        window.updateMetricDatePill(metricKey, activeRange, endDate);
    }

    // Trigger Chart reload for this metric with active range
    setTimeout(() => {
        if (metricKey === 'im' && window.updateIMRange) window.updateIMRange(window.currentIMRange || '1w');
        else if (metricKey === 'steps' && window.updateStepsRange) window.updateStepsRange(window.currentStepsRange || '1w');
        else if (metricKey === 'sleep' && window.updateSleepRange) window.updateSleepRange(window.currentSleepRange || '1w');
        else if (metricKey === 'hrv' && window.updateHRVRange) window.updateHRVRange(window.currentHRVRange || '1w');
        else if (metricKey === 'hr' && window.updateHRRange) window.updateHRRange(window.currentHRRange || '1w');
        else if (metricKey === 'stress' && window.updateStressRange) window.updateStressRange(window.currentStressRange || '1w');
        else if (metricKey === 'weight' && window.updateWeightRange) window.updateWeightRange(window.currentWeightRange || '1m');
        else if (metricKey === 'hydration' && window.updateHydrationRange) window.updateHydrationRange(window.currentHydrationRange || '1w');

        if (targetPane) {
            targetPane.querySelectorAll('canvas').forEach(cv => {
                const chart = (window.Chart && window.Chart.getChart) ? window.Chart.getChart(cv) : (cv.id && window.chartInstances ? window.chartInstances[cv.id] : null);
                if (chart && chart.ctx && chart.canvas && typeof chart.resize === 'function') {
                    try { chart.resize(); } catch (e) {}
                }
            });
        }
    }, 50);
};

window.closeModal = function (id) {
    if (!id) {
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    } else {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    }
    document.body.style.overflow = '';
}

window.showTab = function (tabId, btn) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    // Show target
    const target = document.getElementById(tabId);
    if (target) target.style.display = 'block';
    if (btn) btn.classList.add('active');
}

window.showSettingsStatus = function (message, type) {
    const status = document.getElementById('settings-status');
    if (!status) return;

    const colors = {
        success: { bg: 'rgba(74, 222, 128, 0.1)', text: '#4ade80' },
        error: { bg: 'rgba(248, 113, 113, 0.1)', text: '#f87171' },
        info: { bg: 'rgba(56, 189, 248, 0.1)', text: '#38bdf8' }
    };

    const color = colors[type] || colors.info;
    status.style.background = color.bg;
    status.style.color = color.text;
    status.style.display = 'block';
    status.textContent = message;

    setTimeout(() => {
        status.style.display = 'none';
    }, 5000);
}

// Settings and Updates
window.openSettings = async function () {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    // Initialize refresh dates (yesterday and today using local timezone)
    const today = window.getLocalDateStr ? window.getLocalDateStr() : new Date().toLocaleDateString('en-CA');
    const yesterday = window.getLocalDateStr ? window.getLocalDateStr(new Date(Date.now() - 86400000)) : new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

    document.getElementById('refresh-start').value = yesterday;
    document.getElementById('refresh-end').value = today;

    try {
        const [settingsRes, mappingRes] = await Promise.all([
            fetch('/api/settings'),
            fetch('/api/settings/muscle_mapping')
        ]);

        if (settingsRes.ok) {
            const settings = await settingsRes.json();
            window.currentSettings = settings;
            window.selectedModel = settings.ai_model;

            // Populate current version
            const versionEl = document.getElementById('current-version');
            if (versionEl && settings.app_version) {
                versionEl.textContent = settings.app_version;
            }

            // PB start year
            const yearInput = document.getElementById('setting-pb-year');
            if (yearInput) yearInput.value = settings.pb_start_year || 2025;

            // Athlete FTP
            const ftpInput = document.getElementById('setting-athlete-ftp');
            if (ftpInput) ftpInput.value = settings.athlete_ftp || 250;

            window.renderModelOptions(settings);
        }

        if (mappingRes.ok) {
            const mapping = await mappingRes.json();
            const editor = document.getElementById('muscle-mapping-editor');
            if (editor) {
                editor.value = JSON.stringify(mapping, null, 2);
            }
        }

        modal.classList.add('active');
    } catch (err) {
        console.error('Failed to load settings:', err);
        window.showSettingsStatus('Failed to load settings', 'error');
    }
}

window.refreshCacheRange = async function () {
    const start = document.getElementById('refresh-start').value;
    const end = document.getElementById('refresh-end').value;
    const scopeEl = document.getElementById('refresh-scope');
    let scope = scopeEl ? scopeEl.value : 'all';
    const btn = document.getElementById('btn-refresh-cache');
    const progressBar = document.getElementById('refresh-progress');
    const progressBarFill = document.getElementById('refresh-progress-bar');
    const inlineStatus = document.getElementById('refresh-cache-status');

    const setInlineStatus = (msg, type) => {
        if (!inlineStatus) return;
        if (!msg) {
            inlineStatus.style.display = 'none';
            inlineStatus.textContent = '';
            return;
        }
        inlineStatus.style.display = 'block';
        inlineStatus.textContent = msg;
        inlineStatus.style.color = type === 'error' ? '#ef4444' : (type === 'success' ? '#10b981' : '#38bdf8');
    };

    if (!start || !end) {
        setInlineStatus('Please select both start and end dates.', 'error');
        window.showSettingsStatus('Please select both start and end dates', 'error');
        return;
    }

    const startDt = new Date(start);
    const endDt = new Date(end);
    if (startDt > endDt) {
        setInlineStatus('Start date must be before end date.', 'error');
        window.showSettingsStatus('Start date must be before end date', 'error');
        return;
    }

    const diffDays = Math.round((endDt - startDt) / 86400000);
    // Automatically switch to Activities & Routes mode if user selected > 31 days
    if (diffDays > 31 && scope === 'all') {
        scope = 'activities';
        if (scopeEl) scopeEl.value = 'activities';
    }

    btn.disabled = true;
    btn.textContent = 'Syncing...';
    progressBar.style.display = 'block';
    progressBarFill.style.width = '25%';
    const statusMsg = scope === 'activities'
        ? `Fetching activities & routes from ${start} to ${end}...`
        : (scope === 'weight'
            ? `Fetching weight history from ${start} to ${end}...`
            : `Refreshing all metrics from ${start} to ${end}...`);
    setInlineStatus(statusMsg, 'info');

    try {
        const res = await fetch('/api/cache/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                start_date: start,
                end_date: end,
                scope: scope,
                metrics: scope === 'activities' ? ['activities'] : (scope === 'weight' ? ['weight'] : undefined)
            })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            progressBarFill.style.width = '100%';
            const msg = data.message || 'Cache refreshed successfully!';
            setInlineStatus(msg, 'success');
            window.showSettingsStatus(msg, 'success');
            if (window.updateGlobalHeatmap) window.updateGlobalHeatmap();
            setTimeout(() => {
                progressBar.style.display = 'none';
                progressBarFill.style.width = '0%';
                if (window.fetchDashboardData) window.fetchDashboardData();
            }, 2000);
        } else {
            progressBar.style.display = 'none';
            progressBarFill.style.width = '0%';
            const errMsg = data.error || 'Failed to refresh cache';
            setInlineStatus(errMsg, 'error');
            window.showSettingsStatus(errMsg, 'error');
        }
    } catch (err) {
        console.error('Cache refresh failed:', err);
        progressBar.style.display = 'none';
        progressBarFill.style.width = '0%';
        setInlineStatus('Error connecting to server.', 'error');
        window.showSettingsStatus('Error connecting to server', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Refresh Range';
    }
}

window.saveMuscleMapping = async function () {
    const editor = document.getElementById('muscle-mapping-editor');
    const btn = document.getElementById('btn-save-mapping');
    if (!editor || !btn) return;

    try {
        const mapping = JSON.parse(editor.value);
        btn.disabled = true;
        btn.textContent = 'Saving Mapping...';

        const res = await fetch('/api/settings/muscle_mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mapping)
        });

        if (res.ok) {
            window.showSettingsStatus('Muscle mapping saved successfully!', 'success');
        } else {
            window.showSettingsStatus('Failed to save mapping', 'error');
        }
    } catch (err) {
        window.showSettingsStatus('Invalid JSON format: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Mapping Configuration';
    }
}

window.closeSettings = function () {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.remove('active');
}

window.renderModelOptions = function (settings) {
    const container = document.getElementById('model-options');
    if (!container) return;

    container.innerHTML = '';
    const models = settings.available_models || [];

    models.forEach(model => {
        const isSelected = model.id === window.selectedModel;
        const optionDiv = document.createElement('div');
        optionDiv.style.cssText = `
            padding: 1rem;
            border: 2px solid ${isSelected ? 'var(--accent-color)' : 'rgba(255,255,255,0.1)'};
            border-radius: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
            background: ${isSelected ? 'rgba(56, 189, 248, 0.05)' : 'transparent'};
        `;

        optionDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 1rem;">
                <input type="radio" name="ai-model" value="${model.id}" ${isSelected ? 'checked' : ''} 
                       style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--accent-color);">
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 0.25rem;">${model.name}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">${model.description}</div>
                </div>
            </div>
        `;

        optionDiv.onclick = () => {
            window.selectedModel = model.id;
            window.renderModelOptions(settings);
        };

        container.appendChild(optionDiv);
    });
}

window.saveSettings = async function () {
    if (!window.selectedModel) {
        window.showSettingsStatus('Please select a model', 'error');
        return;
    }

    window.showSettingsStatus('Saving...', 'info');

    try {
        const body = { ai_model: window.selectedModel };
        const pbYear = document.getElementById('setting-pb-year');
        if (pbYear) body.pb_start_year = parseInt(pbYear.value);
        const ftpEl = document.getElementById('setting-athlete-ftp');
        if (ftpEl && ftpEl.value) body.athlete_ftp = parseInt(ftpEl.value);

        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.ok) {
            const result = await res.json();
            if (result.success) {
                window.showSettingsStatus('Settings saved! AI insights will be regenerated.', 'success');
                setTimeout(() => {
                    window.closeSettings();
                    if (window.fetchAIInsights) window.fetchAIInsights();
                }, 1500);
            } else {
                window.showSettingsStatus('Failed to save settings', 'error');
            }
        } else {
            window.showSettingsStatus('Failed to save settings', 'error');
        }
    } catch (err) {
        console.error('Failed to save settings:', err);
        window.showSettingsStatus('Error saving settings', 'error');
    }
}

window.checkForUpdates = async function () {
    const btn = document.getElementById('check-update-btn');
    const info = document.getElementById('update-info');
    const details = document.getElementById('update-details');
    const performBtn = document.getElementById('perform-update-btn');

    if (!btn || !info || !details) return;

    details.style.display = 'flex';
    btn.disabled = true;
    const originalBtnContent = btn.innerHTML;
    btn.innerHTML = '<svg class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>';
    info.textContent = 'Contacting GitHub...';
    info.style.color = 'var(--text-secondary)';
    performBtn.style.display = 'none';

    try {
        const res = await fetch('/api/check_update');
        const data = await res.json();

        if (data.error) {
            info.textContent = 'Error: ' + data.error;
            info.style.color = '#f87171';
        } else if (data.update_available) {
            info.innerHTML = `<span style="color: #4ade80; font-weight: 600;">Update Available!</span><br><span style="font-size: 0.7rem; opacity: 0.8;">New version: ${data.remote_sha}</span>`;
            performBtn.style.display = 'block';
        } else {
            info.textContent = 'Up to date';
            info.style.color = '#4ade80';
        }
    } catch (err) {
        console.error('Update check failed:', err);
        info.textContent = 'Fetch failed';
        info.style.color = '#f87171';
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalBtnContent;
    }
}

window.performUpdate = async function () {
    const btn = document.getElementById('perform-update-btn');
    const checkBtn = document.getElementById('check-update-btn');
    const info = document.getElementById('update-info');

    if (!confirm('This will pull the latest code and restart the dashboard. Are you sure?')) return;

    btn.disabled = true;
    checkBtn.disabled = true;
    btn.textContent = 'Updating...';
    info.textContent = 'Restarting service...';
    info.style.color = 'var(--accent-color)';

    try {
        const res = await fetch('/api/perform_update', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            info.textContent = 'Updating code & restarting service...';
            
            // Poll for server to come back up
            let attempts = 0;
            const pollInterval = setInterval(async () => {
                attempts++;
                info.textContent = `Restarting (${attempts}s)...`;
                try {
                    const ping = await fetch('/api/stats', { cache: 'no-store' });
                    if (ping.ok) {
                        clearInterval(pollInterval);
                        info.textContent = '✅ Update complete! Reloading...';
                        info.style.color = 'var(--success-color)';
                        setTimeout(() => window.location.reload(), 1200);
                    }
                } catch (e) {
                    // Server is restarting, keep waiting
                }
                if (attempts > 30) {
                    clearInterval(pollInterval);
                    info.textContent = 'Reloading now...';
                    setTimeout(() => window.location.reload(), 1500);
                }
            }, 1000);
        } else {
            info.textContent = 'Failed: ' + (data.error || 'Unknown');
            info.style.color = '#f87171';
            btn.disabled = false;
            checkBtn.disabled = false;
        }
    } catch (err) {
        console.error('Update fetch error:', err);
        info.textContent = 'Service restarting. Reconnecting...';
        setTimeout(() => window.location.reload(), 6000);
    }
}

window.downloadFile = async function (url, filename) {
    try {
        const response = await fetch(url);
        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const docUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = docUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(docUrl);
    } catch (err) {
        console.error('Download failed:', err);
        alert('Failed to download file');
    }
}


/**
 * Quick Section Shortcuts & Scroll Spy
 */
window.initDashboardShortcuts = function () {
    const bar = document.getElementById('dashboard-shortcuts');
    if (!bar) return;

    const pills = bar.querySelectorAll('.shortcut-pill[data-section]');
    const sectionIds = Array.from(pills).map(p => p.getAttribute('data-section')).filter(Boolean);
    const sections = sectionIds.map(id => document.getElementById(id)).filter(Boolean);

    if (sections.length === 0) return;

    const setActivePill = (activeId) => {
        pills.forEach(pill => {
            if (pill.getAttribute('data-section') === activeId) {
                pill.classList.add('active');
                if (typeof pill.scrollIntoView === 'function') {
                    pill.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
                }
            } else {
                pill.classList.remove('active');
            }
        });
    };

    const scrollToSection = (targetEl, targetId, updateHash = true) => {
        const barHeight = bar.offsetHeight || 56;
        const offset = barHeight + 24;
        const top = Math.max(0, targetEl.getBoundingClientRect().top + window.scrollY - offset);
        window._shortcutScrollLockUntil = Date.now() + 750;
        window.scrollTo({ top, behavior: 'smooth' });
        setActivePill(targetId);
        if (updateHash && history.replaceState) {
            history.replaceState(null, '', '#' + targetId);
        }
    };

    // Smooth click handler with exact sticky-header offset
    pills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            const targetId = pill.getAttribute('data-section');
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                e.preventDefault();
                scrollToSection(targetEl, targetId, true);
            }
        });
    });

    // Deterministic scroll spy using section top positions relative to sticky nav
    if (!window._shortcutScrollSpyBound) {
        window._shortcutScrollSpyBound = true;
        let ticking = false;
        const updateActiveOnScroll = () => {
            ticking = false;
            if (window._shortcutScrollLockUntil && Date.now() < window._shortcutScrollLockUntil) {
                return;
            }
            const barEl = document.getElementById('dashboard-shortcuts');
            const threshold = (barEl ? barEl.offsetHeight : 56) + 56;
            let activeId = sections[0].id;

            // If scrolled to the very bottom, highlight the last section
            if ((window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 40)) {
                activeId = sections[sections.length - 1].id;
            } else {
                for (const sec of sections) {
                    const rect = sec.getBoundingClientRect();
                    if (rect.top <= threshold) {
                        activeId = sec.id;
                    }
                }
            }
            setActivePill(activeId);
        };

        window.addEventListener('scroll', () => {
            if (!ticking) {
                ticking = true;
                window.requestAnimationFrame(updateActiveOnScroll);
            }
        }, { passive: true });
    }

    // Handle initial hash navigation (e.g. from home landing card)
    if (window.location.hash && window.location.hash.length > 1) {
        const hashId = window.location.hash.slice(1);
        const hashEl = document.getElementById(hashId);
        if (hashEl) {
            setTimeout(() => scrollToSection(hashEl, hashId, false), 120);
        }
    }
};

// Global Escape key and backdrop click to close active modals
if (!window._globalModalHandlersBound) {
    window._globalModalHandlersBound = true;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('foodModal')?.classList.contains('active') && window.closeFoodModal) {
                window.closeFoodModal();
            } else if (document.getElementById('libraryModal')?.classList.contains('active') && window.closeLibraryModal) {
                window.closeLibraryModal();
            } else if (window.closeModal) {
                window.closeModal();
            }
        }
    });
    document.addEventListener('click', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('modal') && e.target.classList.contains('active')) {
            if (e.target.id === 'foodModal' && window.closeFoodModal) {
                window.closeFoodModal();
            } else if (e.target.id === 'libraryModal' && window.closeLibraryModal) {
                window.closeLibraryModal();
            } else if (window.closeModal) {
                window.closeModal(e.target.id);
            }
        }
    });
}

// Auto-run if DOM already loaded or on event
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(window.initDashboardShortcuts, 50);
} else {
    document.addEventListener('DOMContentLoaded', window.initDashboardShortcuts);
}

/**
 * Mobile Swipeable Carousel Indicators (<= 768px)
 * Adds tappable dot indicators beneath horizontal card carousels on mobile.
 */
window.initMobileCarousels = function () {
    const selectors = ['.glance-grid', '.goals-grid', '.nutrition-grid', '.compare-scorecards-grid'];
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(track => {
            const cards = Array.from(track.children).filter(el => el.nodeType === 1);
            if (cards.length < 2) return;

            let dotsEl = track.nextElementSibling;
            if (!dotsEl || !dotsEl.classList.contains('mobile-carousel-dots')) {
                dotsEl = document.createElement('div');
                dotsEl.className = 'mobile-carousel-dots';
                track.insertAdjacentElement('afterend', dotsEl);
            }

            if (dotsEl.children.length !== cards.length) {
                dotsEl.innerHTML = cards.map((_, idx) =>
                    `<button type="button" class="mobile-carousel-dot ${idx === 0 ? 'active' : ''}" aria-label="Go to card ${idx + 1}"></button>`
                ).join('');

                Array.from(dotsEl.children).forEach((dot, idx) => {
                    dot.addEventListener('click', () => {
                        const target = cards[idx];
                        if (target) {
                            track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: 'smooth' });
                        }
                    });
                });
            }

            if (!track._carouselScrollBound) {
                track._carouselScrollBound = true;
                let scrollRaf = null;
                track.addEventListener('scroll', () => {
                    if (scrollRaf) return;
                    scrollRaf = window.requestAnimationFrame(() => {
                        scrollRaf = null;
                        const trackLeft = track.scrollLeft;
                        let bestIdx = 0;
                        let bestDist = Infinity;
                        cards.forEach((card, idx) => {
                            const dist = Math.abs((card.offsetLeft - track.offsetLeft) - trackLeft);
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestIdx = idx;
                            }
                        });
                        Array.from(dotsEl.children).forEach((d, idx) => {
                            d.classList.toggle('active', idx === bestIdx);
                        });
                    });
                }, { passive: true });
            }
        });
    });
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(window.initMobileCarousels, 120);
} else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(window.initMobileCarousels, 120));
}
