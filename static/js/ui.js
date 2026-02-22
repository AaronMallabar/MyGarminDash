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

    try {
        const res = await fetch('/api/settings');
        if (res.ok) {
            const settings = await res.json();
            window.currentSettings = settings;
            window.selectedModel = settings.ai_model;

            // Populate current version
            const versionEl = document.getElementById('current-version');
            if (versionEl && settings.app_version) {
                versionEl.textContent = settings.app_version;
            }

            window.renderModelOptions(settings);
            modal.classList.add('active');
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
        window.showSettingsStatus('Failed to load settings', 'error');
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
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ai_model: window.selectedModel })
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
            info.textContent = 'Reloading in 10s...';
            setTimeout(() => {
                window.location.reload();
            }, 10000);
        } else {
            info.textContent = 'Failed: ' + (data.error || 'Unknown');
            info.style.color = '#f87171';
            btn.disabled = false;
            checkBtn.disabled = false;
        }
    } catch (err) {
        console.error('Update failed:', err);
        info.textContent = 'Reconnecting...';
        setTimeout(() => {
            window.location.reload();
        }, 5000);
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
