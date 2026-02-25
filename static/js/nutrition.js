/**
 * Nutrition & Calorie Tracking Logic
 */

// Global state for nutrition
window.customFoods = {};
window.currentNutritionLogs = [];
window.editingLogId = null;
window.activeNutritionDate = new Date();

window.shiftNutritionDate = function (dir) {
    window.activeNutritionDate.setDate(window.activeNutritionDate.getDate() + dir);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const active = new Date(window.activeNutritionDate);
    active.setHours(0, 0, 0, 0);

    if (active > today) window.activeNutritionDate = new Date();

    window.updateNutritionDateUI();
    if (window.fetchNutritionData) window.fetchNutritionData();
    window.updateFoodModalDateLabel();
}

window.resetNutritionToToday = function () {
    window.activeNutritionDate = new Date();
    window.updateNutritionDateUI();
    if (window.fetchNutritionData) window.fetchNutritionData();
    window.updateFoodModalDateLabel();
}

window.updateNutritionDateUI = function () {
    const display = document.getElementById('nutrition-date-display');
    const todayBtn = document.getElementById('nutrition-today-btn');
    const title = document.getElementById('food-list-title');

    const dateStr = window.getLocalDateStr(window.activeNutritionDate);
    const todayStr = window.getLocalDateStr(new Date());

    if (dateStr === todayStr) {
        if (display) display.textContent = 'Today';
        if (todayBtn) todayBtn.style.display = 'none';
        if (title) title.textContent = "Today's Food";
    } else {
        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        if (display) display.textContent = window.activeNutritionDate.toLocaleDateString(undefined, options);
        if (todayBtn) todayBtn.style.display = 'inline-block';
        if (title) title.textContent = `Food for ${window.activeNutritionDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    }
}

window.updateNutritionUI = function (logs, metabolicData, aiAnalysis) {
    window.currentNutritionLogs = logs;

    let outtakeTotal = 0;
    let active = 0;
    let resting = 0;

    if (typeof metabolicData === 'object' && metabolicData !== null) {
        outtakeTotal = metabolicData.total || 0;
        active = metabolicData.active || 0;
        resting = metabolicData.resting || 0;
    } else {
        outtakeTotal = Number(metabolicData) || 0;
    }

    const intake = logs.reduce((sum, log) => sum + (log.calories || 0), 0);
    const net = intake - outtakeTotal;

    window.safeSetText('intake-calories', intake.toLocaleString());

    const outtakeEl = document.getElementById('outtake-calories');
    if (outtakeEl) {
        outtakeEl.innerHTML = `
            <div style="line-height: 1;">${outtakeTotal.toLocaleString()}</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600; margin-top: 0.4rem; white-space: nowrap; opacity: 0.9;">
                ${active.toLocaleString()} Active + ${resting.toLocaleString()} Passive
            </div>
        `;
    }

    const netEl = document.getElementById('net-calories');
    const netLabel = document.getElementById('net-label');
    const pointer = document.getElementById('balance-pointer');

    if (netEl && pointer) {
        netEl.textContent = (net > 0 ? '+' : '') + Math.abs(net).toLocaleString();
        if (netLabel) netLabel.textContent = net > 0 ? 'Surplus' : 'Deficit (Burned)';

        const maxRange = 5000;
        const clampedNet = Math.max(-maxRange, Math.min(maxRange, net));
        const posPct = ((clampedNet + maxRange) / (maxRange * 2)) * 100;

        pointer.style.left = posPct + '%';

        if (net <= 0) {
            pointer.style.background = '#10b981';
            pointer.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.8)';
            netEl.style.color = '#10b981';
        } else {
            pointer.style.background = '#f87171';
            pointer.style.boxShadow = '0 0 15px rgba(248, 113, 113, 0.8)';
            netEl.style.color = '#f87171';
        }
    }

    const list = document.getElementById('food-logs-list');
    if (list) {
        if (logs.length === 0) {
            list.innerHTML = `<div style="text-align: center; color: var(--text-secondary); margin-top: 2rem;">No entries for ${window.getLocalDateStr(window.activeNutritionDate) === window.getLocalDateStr(new Date()) ? 'today' : 'this date'}.</div>`;
        } else {
            list.innerHTML = logs.slice().reverse().map(l => `
                <div class="activity-item" style="padding: 1rem; margin-bottom: 0.75rem; background: rgba(255,255,255,0.02); border-radius: 0.75rem; border: 1px solid rgba(255,255,255,0.05); align-items: center; display: flex;">
                    <div style="font-size: 1.2rem; margin-right: 1rem;">${l.calories > 500 ? '🍱' : (l.calories > 200 ? '🥪' : '🍎')}</div>
                    <div style="flex-grow: 1;">
                        <div style="font-weight: 600; font-size: 0.95rem;">${l.name}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">${window.formatTo12H(l.time)} • ${l.calories} kcal</div>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button onclick="window.editAnyMeal(${l.id})" style="background: none; border: none; color: #38bdf8; cursor: pointer; opacity: 0.5; padding: 0.5rem; font-size: 0.8rem;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5">Edit</button>
                        <button onclick="window.deleteFoodLog(${l.id})" style="background: none; border: none; color: #f87171; cursor: pointer; opacity: 0.5; padding: 0.5rem;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5">✕</button>
                    </div>
                </div>
            `).join('');
        }
    }

    const aiContainer = document.getElementById('nutrition-ai-content');
    if (aiContainer) {
        if (aiAnalysis && aiAnalysis !== "Detailed analysis available on request.") {
            window.safeSetHTML('nutrition-ai-content', aiAnalysis);
        } else {
            aiContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem;">
                    <div style="color: var(--text-secondary); font-size: 0.9rem;">Analysis available on demand.</div>
                    <button onclick="window.refreshNutritionAnalysis()" 
                        style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981; padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.85rem; font-weight: 600; transition: all 0.2s;"
                        onmouseover="this.style.background='rgba(16, 185, 129, 0.2)'"
                        onmouseout="this.style.background='rgba(16, 185, 129, 0.1)'">
                        ✨ Analyze with AI
                    </button>
                </div>
            `;
        }
    }
}

window.refreshNutritionAnalysis = async function () {
    const container = document.getElementById('nutrition-ai-content');
    if (container) {
        container.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--text-secondary);">
                <div class="loading" style="width: 16px; height: 16px;"></div>
                <span>Analyzing nutrition...</span>
            </div>
        `;
    }

    try {
        const dateStr = window.getLocalDateStr(window.activeNutritionDate);
        const res = await fetch(`/api/nutrition/analysis?date=${dateStr}`);
        if (res.ok) {
            const data = await res.json();
            window.safeSetHTML('nutrition-ai-content', data.analysis);
        }
    } catch (err) {
        console.error("Analysis error:", err);
        if (container) container.textContent = "Analysis failed. Please try again.";
    }
}

window.openFoodModal = function () {
    const modal = document.getElementById('foodModal');
    if (modal) {
        modal.classList.add('active');
        const searchInput = document.getElementById('food-chat-input');
        if (searchInput) searchInput.focus();

        const now = new Date();
        const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        const timeInput = document.getElementById('food-log-time');
        if (timeInput) timeInput.value = timeStr;

        window.updateFoodModalDateLabel();
    }
}

window.updateFoodModalDateLabel = function () {
    const label = document.getElementById('food-modal-date-label');
    if (label) {
        const todayStr = window.getLocalDateStr(new Date());
        const activeStr = window.getLocalDateStr(window.activeNutritionDate);
        if (todayStr === activeStr) {
            label.textContent = "Today";
        } else {
            label.textContent = window.activeNutritionDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
    }
}

window.closeFoodModal = function () {
    const modal = document.getElementById('foodModal');
    if (modal) modal.classList.remove('active');
}

window.onFoodSearchInput = function () {
    const input = document.getElementById('food-chat-input');
    const query = input.value.toLowerCase();
    const results = document.getElementById('food-chat-search-results');

    if (!query || query.length < 2) {
        results.style.display = 'none';
        return;
    }

    const matches = Object.keys(window.customFoods).filter(f => f.toLowerCase().includes(query));

    if (matches.length > 0) {
        results.innerHTML = matches.map(m => `
            <div style="padding: 0.75rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; transition: background 0.2s; cursor: pointer;" 
                onmouseover="this.style.background='rgba(56, 189, 248, 0.1)'" onmouseout="this.style.background='transparent'"
                onclick="window.selectFood('${m.replace(/'/g, "\\'")}')">
                <div style="flex-grow: 1;">
                    <div style="font-weight: 600; font-size: 0.9rem;">${m}</div>
                    <div style="font-size: 0.7rem; color: #10b981;">${window.customFoods[m].calories} kcal • Saved in Library</div>
                </div>
                <div style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase;">Select</div>
            </div>
        `).join('');
        results.style.display = 'block';
    } else {
        results.style.display = 'none';
    }
}

window.selectFood = function (name) {
    document.getElementById('food-chat-input').value = name;
    document.getElementById('food-chat-search-results').style.display = 'none';

    if (window.customFoods[name]) {
        window.editLibraryItem(name);
    } else {
        window.sendFoodChat();
    }
}

window.submitFoodLog = async function () {
    const name = document.getElementById('food-search-input').value;
    if (!name) return;

    const btn = document.getElementById('btn-log-food');
    const originalText = btn.textContent;
    btn.textContent = "AI Analyzing...";
    btn.disabled = true;

    try {
        const res = await fetch(`/api/nutrition/log?dry_run=true`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });

        if (res.ok) {
            const estimates = await res.json();
            if (estimates.length > 0) {
                const data = estimates[0];
                window.showCustomFoodForm();
                document.getElementById('custom-name').value = data.name;

                const list = document.getElementById('ingredient-list');
                list.innerHTML = '';
                window.addIngredientRow({
                    name: data.name,
                    qty: 1,
                    unit: 'serving',
                    calories: data.calories,
                    cholesterol_mg: data.cholesterol_mg || 0,
                    protein_g: data.protein_g || 0,
                    carbs_g: data.carbs_g || 0,
                    fat_g: data.fat_g || 0
                });
                window.updateNutrientSummary();
                document.getElementById('food-search-input').value = '';
            }
        }
    } catch (err) {
        console.error("Log food error:", err);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

window.editAnyMeal = async function (logId) {
    const log = window.currentNutritionLogs.find(l => l.id === logId);
    if (!log) return;

    window.editingLogId = logId;

    if (log.time) {
        document.getElementById('food-log-time').value = log.time;
    }

    if (window.customFoods[log.name]) {
        window.editLibraryItem(log.name);
    } else {
        window.showCustomFoodForm();
        document.getElementById('custom-name').value = log.name;
        const list = document.getElementById('ingredient-list');
        list.innerHTML = '';
        window.addIngredientRow({
            name: log.name,
            qty: log.qty || 1,
            unit: log.unit || 'serving',
            calories: log.calories,
            cholesterol_mg: log.cholesterol_mg || 0,
            protein_g: log.protein_g || 0,
            carbs_g: log.carbs_g || 0,
            fat_g: log.fat_g || 0
        });
        window.updateNutrientSummary();
    }
}

window.deleteFoodLog = async function (id) {
    if (!confirm("Remove this entry?")) return;
    try {
        await fetch('/api/nutrition/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        });
        if (window.fetchNutritionData) window.fetchNutritionData();
    } catch (err) { console.error("Delete log error:", err); }
}

let ingredientIndex = 0;

// --- Conversational & Image Logic ---
let currentFoodImageBase64 = null;

window.onFoodImageSelect = function (input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            currentFoodImageBase64 = e.target.result;
            document.getElementById('food-image-preview').src = currentFoodImageBase64;
            document.getElementById('image-preview-container').style.display = 'block';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

window.clearFoodImage = function () {
    currentFoodImageBase64 = null;
    document.getElementById('food-image-input').value = '';
    document.getElementById('image-preview-container').style.display = 'none';
}

window.addChatMessage = function (role, text) {
    const history = document.getElementById('food-chat-history');
    if (!history) return;
    const div = document.createElement('div');
    div.className = `chat-bubble ${role}`;
    div.innerHTML = window.parseMarkdown(text);
    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
}

window.sendFoodChat = async function () {
    const input = document.getElementById('food-chat-input');
    const text = input.value.trim();
    if (!text && !currentFoodImageBase64) return;

    const btn = document.getElementById('btn-send-chat');
    const originalText = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;

    try {
        const payload = {
            text: text,
            image: currentFoodImageBase64,
            date: window.getLocalDateStr(window.activeNutritionDate),
            time: document.getElementById('food-log-time').value
        };

        const res = await fetch('/api/nutrition/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (data.items && data.items.length > 0) {
            window.showCustomFoodForm();
            if (data.meal_name) document.getElementById('custom-name').value = data.meal_name;

            const list = document.getElementById('ingredient-list');
            list.innerHTML = '';
            ingredientIndex = 0;

            data.items.forEach(item => {
                window.addIngredientRow(item);
            });
            window.updateNutrientSummary();

            // Update Sidebar
            window.updateAISidebar(data);

            // Auto-open AI assistant if things are uncertain
            if (data.confidence_score < 80) {
                window.toggleAIAssistant(true);
            }
        }

        window.clearFoodImage();
        input.value = '';

    } catch (err) {
        console.error("Chat error:", err);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

window.sendClarification = async function () {
    const input = document.getElementById('clarify-input');
    const text = input.value.trim();
    if (!text) return;

    // Add user message to small chat
    window.addClarifyMessage('user', text);
    input.value = '';

    // Get current state
    const rows = document.querySelectorAll('.ingredient-row');
    const currentItems = Array.from(rows).map(row => ({
        name: row.querySelector('.ing-name').value,
        qty: row.querySelector('.ing-qty').value,
        unit: row.querySelector('.ing-unit').value,
        calories: row.querySelector('.ing-cal').value,
        protein_g: row.querySelector('.ing-pro').value,
        carbs_g: row.querySelector('.ing-carb').value,
        fat_g: row.querySelector('.ing-fat').value,
        sugar_g: row.querySelector('.ing-sugar').value,
        caffeine_mg: row.querySelector('.ing-caffeine').value,
        cholesterol_mg: row.querySelector('.ing-chol').value
    }));

    try {
        const res = await fetch('/api/nutrition/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                current_items: currentItems,
                date: window.getLocalDateStr(window.activeNutritionDate)
            })
        });

        const data = await res.json();

        // Update items table
        if (data.items && data.items.length > 0) {
            const list = document.getElementById('ingredient-list');
            list.innerHTML = '';
            ingredientIndex = 0;
            data.items.forEach(item => window.addIngredientRow(item));
            window.updateNutrientSummary();
        }

        // Update Sidebar
        window.updateAISidebar(data);

    } catch (err) {
        console.error("Clarification error:", err);
    }
}

window.updateAISidebar = function (data) {
    // Confidence Score
    const score = data.confidence_score || 0;
    const valEl = document.getElementById('confidence-value');
    const badgeEl = document.getElementById('confidence-badge');
    const barEl = document.getElementById('confidence-bar-fill');

    if (valEl) valEl.textContent = score + '%';
    if (badgeEl) badgeEl.textContent = score + '%';
    if (barEl) barEl.style.width = score + '%';

    // Health Tip
    const tipEl = document.getElementById('health-tip-content');
    if (tipEl && data.health_tip) {
        tipEl.textContent = data.health_tip;
    }

    // Clarifying Question
    if (data.clarifying_questions && data.clarifying_questions.length > 0) {
        data.clarifying_questions.forEach(q => window.addClarifyMessage('ai', q));
    } else if (data.reply) {
        window.addClarifyMessage('ai', data.reply);
    }
}

window.toggleAIAssistant = function (forceState = null) {
    const sidebar = document.querySelector('.insight-sidebar');
    const toggleBtn = document.getElementById('btn-toggle-ai');
    if (!sidebar) return;

    const isVisible = sidebar.style.display === 'flex';
    const nextState = forceState !== null ? forceState : !isVisible;

    sidebar.style.display = nextState ? 'flex' : 'none';

    if (toggleBtn) {
        if (nextState) {
            toggleBtn.style.background = '#10b981';
            toggleBtn.style.color = 'white';
        } else {
            toggleBtn.style.background = 'rgba(16, 185, 129, 0.1)';
            toggleBtn.style.color = '#10b981';
        }
    }
}

window.addClarifyMessage = function (role, text) {
    const history = document.getElementById('clarify-history');
    if (!history) return;
    const div = document.createElement('div');
    div.className = `clarify-bubble ${role}`;
    div.textContent = text;
    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
}

window.showCustomFoodForm = function () {
    document.getElementById('food-chat-view').style.display = 'none';
    document.getElementById('custom-food-form').style.display = 'flex';

    // Reset AI Sidebar
    const history = document.getElementById('clarify-history');
    if (history) history.innerHTML = '<div class="clarify-bubble ai">Tell me a bit more about the meal to improve the accuracy of my estimation!</div>';

    const confidenceVal = document.getElementById('confidence-value');
    const confidenceBar = document.getElementById('confidence-bar-fill');
    const confidenceBadge = document.getElementById('confidence-badge');
    if (confidenceVal) confidenceVal.textContent = '0%';
    if (confidenceBar) confidenceBar.style.width = '0%';
    if (confidenceBadge) confidenceBadge.textContent = '0%';

    const healthTip = document.getElementById('health-tip-content');
    if (healthTip) healthTip.textContent = 'Waiting for details to provide a personalized health tip...';

    window.toggleAIAssistant(false);
}

window.hideCustomFoodForm = function () {
    document.getElementById('food-chat-view').style.display = 'flex';
    document.getElementById('custom-food-form').style.display = 'none';
}

window.estimateAllIngredients = async function () {
    const rows = document.querySelectorAll('.ingredient-row');
    if (rows.length === 0) return;

    const btn = document.getElementById('btn-ai-scan-detailed');
    const originalText = btn.textContent;
    btn.textContent = 'AI Scanning...';
    btn.disabled = true;

    const ingredients = Array.from(rows).map(row => ({
        name: row.querySelector('.ing-name').value,
        qty: row.querySelector('.ing-qty').value,
        unit: row.querySelector('.ing-unit').value
    }));

    try {
        const res = await fetch('/api/nutrition/estimate_ingredients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredients })
        });

        if (res.ok) {
            const estimates = await res.json();
            rows.forEach((row, i) => {
                if (estimates[i]) {
                    row.querySelector('.ing-cal').value = estimates[i].calories || 0;
                    row.querySelector('.ing-chol').value = estimates[i].cholesterol_mg || 0;
                    row.querySelector('.ing-pro').value = estimates[i].protein_g || 0;
                    row.querySelector('.ing-carb').value = estimates[i].carbs_g || 0;
                    row.querySelector('.ing-sugar').value = estimates[i].sugar_g || 0;
                    row.querySelector('.ing-fat').value = estimates[i].fat_g || 0;
                    row.querySelector('.ing-caffeine').value = estimates[i].caffeine_mg || 0;
                }
            });
            window.updateNutrientSummary();
        }
    } catch (err) { console.error(err); }
    finally {
        btn.textContent = '✨ Scan Complete';
        setTimeout(() => btn.textContent = originalText, 2000);
        btn.disabled = false;
    }
}

window.addIngredientRow = function (data = null) {
    const list = document.getElementById('ingredient-list');
    const rowId = `ing-row-${ingredientIndex++}`;
    const div = document.createElement('div');
    div.id = rowId;
    div.className = 'ingredient-row ingredient-grid';
    div.style.cssText = 'background: rgba(255,255,255,0.02); padding: 0.5rem; border-radius: 0.5rem;';

    const units = ['serving', 'package', 'container', 'oz', 'grams', 'cups', 'tbsp', 'slices', 'piece', 'bowl', 'plate'];
    const unitOptions = units.map(u => `<option value="${u}" ${data?.unit === u ? 'selected' : ''}>${u.charAt(0).toUpperCase() + u.slice(1)}</option>`).join('');

    div.innerHTML = `
        <div style="min-width: 0;">
            <input type="text" class="ing-name" placeholder="Item" value="${data?.name || ''}" 
                style="width: 100%; height: 30px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 0.4rem; padding: 0 0.4rem; font-size: 0.8rem;">
        </div>
        <div>
            <input type="number" class="ing-qty" placeholder="Qty" value="${data?.qty || 1}" 
                oninput="window.onQtyChange(this)"
                style="width: 100%; height: 30px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 0.4rem; padding: 0 0.4rem; font-size: 0.8rem;">
        </div>
        <div>
            <select class="ing-unit" onchange="window.updateNutrientSummary()" style="width: 100%; height: 30px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 0.4rem; font-size: 0.75rem;">
                ${unitOptions}
            </select>
        </div>
        <div>
            <input type="number" class="ing-pro" placeholder="P" value="${data?.protein_g || 0}" oninput="window.updateNutrientSummary()"
                style="width: 100%; height: 30px; background: rgba(244, 114, 182, 0.05); border: 1px solid rgba(244, 114, 182, 0.2); color: #f472b6; border-radius: 0.4rem; padding: 0 0.3rem; font-size: 0.75rem; font-weight: 700;">
        </div>
        <div>
            <input type="number" class="ing-carb" placeholder="C" value="${data?.carbs_g || 0}" oninput="window.updateNutrientSummary()"
                style="width: 100%; height: 30px; background: rgba(234, 179, 8, 0.05); border: 1px solid rgba(234, 179, 8, 0.2); color: #eab308; border-radius: 0.4rem; padding: 0 0.3rem; font-size: 0.75rem; font-weight: 700;">
        </div>
        <div>
            <input type="number" class="ing-fat" placeholder="F" value="${data?.fat_g || 0}" oninput="window.updateNutrientSummary()"
                style="width: 100%; height: 30px; background: rgba(249, 115, 22, 0.05); border: 1px solid rgba(249, 115, 22, 0.2); color: #f97316; border-radius: 0.4rem; padding: 0 0.3rem; font-size: 0.75rem; font-weight: 700;">
        </div>
        <div>
            <input type="number" class="ing-sugar" placeholder="S" value="${data?.sugar_g || 0}" oninput="window.updateNutrientSummary()"
                style="width: 100%; height: 30px; background: rgba(96, 165, 250, 0.05); border: 1px solid rgba(96, 165, 250, 0.2); color: #60a5fa; border-radius: 0.4rem; padding: 0 0.3rem; font-size: 0.75rem; font-weight: 700;">
        </div>
        <div>
            <input type="number" class="ing-caffeine" placeholder="Caf" value="${data?.caffeine_mg || 0}" oninput="window.updateNutrientSummary()"
                style="width: 100%; height: 30px; background: rgba(167, 139, 250, 0.05); border: 1px solid rgba(167, 139, 250, 0.2); color: #a78bfa; border-radius: 0.4rem; padding: 0 0.3rem; font-size: 0.75rem; font-weight: 700;">
        </div>
        <div>
            <input type="number" class="ing-chol" placeholder="Chol" value="${data?.cholesterol_mg || 0}" oninput="window.updateNutrientSummary()"
                style="width: 100%; height: 30px; background: rgba(251, 146, 60, 0.05); border: 1px solid rgba(251, 146, 60, 0.2); color: #fb923c; border-radius: 0.4rem; padding: 0 0.3rem; font-size: 0.75rem; font-weight: 700;">
        </div>
        <div>
            <input type="number" class="ing-cal" placeholder="kcal" value="${data?.calories || 0}" 
                oninput="window.updateNutrientSummary()"
                data-base-qty="${data?.qty || 1}"
                style="width: 100%; height: 30px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981; border-radius: 0.4rem; padding: 0 0.4rem; font-size: 0.75rem; font-weight: 800;">
        </div>
        <button onclick="document.getElementById('${rowId}').remove(); window.updateNutrientSummary();" 
            style="background:none; border:none; color:#f87171; cursor:pointer; padding: 0 0.2rem;">✕</button>
    `;
    list.appendChild(div);
}

window.onQtyChange = function (input) {
    const row = input.closest('.ingredient-row');
    const calInput = row.querySelector('.ing-cal');
    const newQty = parseFloat(input.value) || 0;
    const baseQty = parseFloat(calInput.getAttribute('data-base-qty')) || 1;

    if (newQty > 0 && baseQty > 0) {
        const ratio = newQty / baseQty;

        const inputs = [
            { cls: '.ing-cal', precision: 0 },
            { cls: '.ing-pro', precision: 0 },
            { cls: '.ing-carb', precision: 0 },
            { cls: '.ing-fat', precision: 0 },
            { cls: '.ing-sugar', precision: 0 },
            { cls: '.ing-chol', precision: 0 },
            { cls: '.ing-caffeine', precision: 0 }
        ];

        inputs.forEach(item => {
            const inputEl = row.querySelector(item.cls);
            if (inputEl) {
                const val = parseFloat(inputEl.value) || 0;
                inputEl.value = Math.round(val * ratio);
            }
        });

        calInput.setAttribute('data-base-qty', newQty);
    }
    window.updateNutrientSummary();
}

window.updateNutrientSummary = function () {
    let totals = { cal: 0, chol: 0, pro: 0, carb: 0, sugar: 0, fat: 0, caffeine: 0 };
    document.querySelectorAll('.ingredient-row').forEach(row => {
        totals.cal += parseInt(row.querySelector('.ing-cal').value) || 0;
        totals.chol += parseInt(row.querySelector('.ing-chol').value) || 0;
        totals.pro += parseInt(row.querySelector('.ing-pro').value) || 0;
        totals.carb += parseInt(row.querySelector('.ing-carb').value) || 0;
        totals.sugar += parseInt(row.querySelector('.ing-sugar').value) || 0;
        totals.fat += parseInt(row.querySelector('.ing-fat').value) || 0;
        totals.caffeine += parseInt(row.querySelector('.ing-caffeine').value) || 0;
    });

    window.safeSetText('summary-cal', totals.cal);
    window.safeSetText('summary-chol', totals.chol + 'mg');
    window.safeSetText('summary-sugar', totals.sugar + 'g');
    window.safeSetText('summary-caffeine', totals.caffeine + 'mg');
}

window.saveCustomFood = async function (alsoLog = true) {
    const name = document.getElementById('custom-name').value;
    const category = document.getElementById('custom-category').value;
    if (!name) return alert("Please name your recipe.");

    const ingredients = [];
    let totalCal = 0, totalChol = 0, totalPro = 0, totalCarb = 0, totalSugar = 0, totalFat = 0, totalCaffeine = 0;

    document.querySelectorAll('.ingredient-row').forEach(row => {
        const cal = parseInt(row.querySelector('.ing-cal').value) || 0;
        const cholVal = parseInt(row.querySelector('.ing-chol').value) || 0;
        const pro = parseInt(row.querySelector('.ing-pro').value) || 0;
        const carb = parseInt(row.querySelector('.ing-carb').value) || 0;
        const sugar = parseInt(row.querySelector('.ing-sugar').value) || 0;
        const fat = parseInt(row.querySelector('.ing-fat').value) || 0;
        const caffeine = parseInt(row.querySelector('.ing-caffeine').value) || 0;

        ingredients.push({
            name: row.querySelector('.ing-name').value,
            qty: row.querySelector('.ing-qty').value,
            unit: row.querySelector('.ing-unit').value,
            calories: cal,
            cholesterol_mg: cholVal,
            protein_g: pro,
            carbs_g: carb,
            sugar_g: sugar,
            fat_g: fat,
            caffeine_mg: caffeine
        });
        totalCal += cal;
        totalChol += cholVal;
        totalPro += pro;
        totalCarb += carb;
        totalSugar += sugar;
        totalFat += fat;
        totalCaffeine += caffeine;
    });

    try {
        await fetch('/api/nutrition/custom_foods', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name, category, ingredients,
                calories: totalCal, cholesterol_mg: totalChol,
                protein_g: totalPro, carbs_g: totalCarb,
                sugar_g: totalSugar, fat_g: totalFat, caffeine_mg: totalCaffeine
            })
        });

        if (window.editingLogId) {
            await fetch('/api/nutrition/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: window.editingLogId })
            });
        }

        if (alsoLog || window.editingLogId) {
            const timeStr = document.getElementById('food-log-time').value;
            const dateStr = window.getLocalDateStr(window.activeNutritionDate);
            await fetch('/api/nutrition/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, date: dateStr, time: timeStr })
            });
        }

        window.editingLogId = null;
        window.hideCustomFoodForm();
        window.closeFoodModal();
        if (window.fetchNutritionData) window.fetchNutritionData();
    } catch (err) { console.error(err); }
}

window.openLibraryModal = function () {
    const modal = document.getElementById('libraryModal');
    if (modal) {
        modal.classList.add('active');
        window.renderLibrary();
    }
}

window.closeLibraryModal = function () {
    const modal = document.getElementById('libraryModal');
    if (modal) modal.classList.remove('active');
}

window.renderLibrary = async function () {
    const list = document.getElementById('library-list');
    try {
        const res = await fetch('/api/nutrition/custom_foods');
        const library = await res.json();

        if (Object.keys(library).length === 0) {
            list.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary);">Library is empty.</div>';
            return;
        }

        list.innerHTML = Object.entries(library).map(([name, data]) => `
            <div class="card" style="margin-bottom: 0; background: rgba(255,255,255,0.02);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.7rem; color: #10b981; font-weight: 700; text-transform: uppercase;">${data.category || 'Meal'}</span>
                    <button onclick="window.deleteLibraryItem('${name}')" style="background:none; border:none; color:#f87171; cursor:pointer; opacity: 0.5;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5">✕</button>
                </div>
                <div style="font-weight: 600; margin-bottom: 0.25rem;">${name}</div>
                <div style="font-size: 1.2rem; font-weight: 700; margin-bottom: 1rem;">${data.calories} kcal</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4;">
                    ${(data.ingredients || []).map(i => `${i.qty} ${i.unit} ${i.name}`).join(', ')}
                </div>
                <div style="display: flex; gap: 0.5rem; margin-top: 1.5rem;">
                    <button onclick="window.editLibraryItem('${name}')" class="range-btn" style="flex: 1; padding: 0.6rem; font-size: 0.8rem; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); color: #38bdf8;">Edit</button>
                    <button onclick="window.logFromLibrary('${name}')" class="range-btn active" style="flex: 2; padding: 0.6rem; font-size: 0.8rem; background: #10b981;">Log This</button>
                </div>
            </div>
        `).join('');
    } catch (err) { console.error(err); }
}

window.deleteLibraryItem = async function (name) {
    if (!confirm(`Delete "${name}" from your library?`)) return;
    await fetch('/api/nutrition/delete_library_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    window.renderLibrary();
}

window.editLibraryItem = async function (name) {
    try {
        const res = await fetch('/api/nutrition/custom_foods');
        const library = await res.json();
        const data = library[name];
        if (!data) return;

        window.closeLibraryModal();
        window.openFoodModal();
        window.showCustomFoodForm();

        document.getElementById('custom-name').value = name;
        document.getElementById('custom-category').value = data.category || 'Meal';

        const list = document.getElementById('ingredient-list');
        list.innerHTML = '';
        ingredientIndex = 0;

        (data.ingredients || []).forEach(ing => {
            window.addIngredientRow(ing);
        });

        window.updateNutrientSummary();
    } catch (err) { console.error(err); }
}

window.logFromLibrary = async function (name) {
    let timeStr;
    const timeInput = document.getElementById('food-log-time');
    if (timeInput && timeInput.value) {
        timeStr = timeInput.value;
    } else {
        const now = new Date();
        timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    }

    await fetch('/api/nutrition/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, date: window.getLocalDateStr(window.activeNutritionDate), time: timeStr })
    });
    window.closeLibraryModal();
    window.closeFoodModal();
    if (window.fetchNutritionData) window.fetchNutritionData();
}

window.importLogs = async function (input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/nutrition/import', {
            method: 'POST',
            body: formData
        });
        if (res.ok) {
            const data = await res.json();
            alert(`Successfully imported ${data.count} logs.`);
            if (window.fetchNutritionData) window.fetchNutritionData();
        } else {
            const err = await res.json();
            alert('Import failed: ' + (err.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Import error: ' + e);
    } finally {
        input.value = '';
    }
}
