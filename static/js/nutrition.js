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
}

window.resetNutritionToToday = function () {
    window.activeNutritionDate = new Date();
    window.updateNutritionDateUI();
    if (window.fetchNutritionData) window.fetchNutritionData();
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
        const searchInput = document.getElementById('food-search-input');
        if (searchInput) searchInput.focus();

        const now = new Date();
        const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        const timeInput = document.getElementById('food-log-time');
        if (timeInput) timeInput.value = timeStr;
    }
}

window.closeFoodModal = function () {
    const modal = document.getElementById('foodModal');
    if (modal) modal.classList.remove('active');
}

window.onFoodSearchInput = function () {
    const query = document.getElementById('food-search-input').value.toLowerCase();
    const results = document.getElementById('food-search-results');

    if (!query) {
        results.style.display = 'none';
        return;
    }

    const matches = Object.keys(window.customFoods).filter(f => f.toLowerCase().includes(query));

    if (matches.length > 0) {
        results.innerHTML = matches.map(m => `
            <div style="padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                <div onclick="window.selectFood('${m}')" style="flex-grow: 1; cursor: pointer;">
                    <div style="font-weight: 600;">${m}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">${window.customFoods[m].calories} kcal • Saved Recipe</div>
                </div>
                <button onclick="window.editLibraryItem('${m}')" style="background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 0.4rem 0.8rem; border-radius: 0.4rem; font-size: 0.75rem; cursor: pointer; font-weight: 600;">Edit Recipe</button>
            </div>
        `).join('');
        results.style.display = 'block';
    } else {
        results.style.display = 'none';
    }
}

window.selectFood = function (name) {
    document.getElementById('food-search-input').value = name;
    document.getElementById('food-search-results').style.display = 'none';

    if (window.customFoods[name]) {
        window.editLibraryItem(name);
    } else {
        window.submitFoodLog();
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

window.showCustomFoodForm = function () {
    document.getElementById('food-main-view').style.display = 'none';
    document.getElementById('custom-food-form').style.display = 'block';
    document.getElementById('ingredient-list').innerHTML = '';
    ingredientIndex = 0;
    window.addIngredientRow();
}

window.hideCustomFoodForm = function () {
    document.getElementById('food-main-view').style.display = 'block';
    document.getElementById('custom-food-form').style.display = 'none';
}

window.addIngredientRow = function (data = null) {
    const list = document.getElementById('ingredient-list');
    const rowId = `ing-row-${ingredientIndex++}`;
    const div = document.createElement('div');
    div.id = rowId;
    div.className = 'ingredient-row';
    div.style.cssText = 'display: grid; grid-template-columns: 2fr 1fr 1fr 1.2fr auto; gap: 0.5rem; align-items: end; background: rgba(255,255,255,0.02); padding: 0.5rem; border-radius: 0.5rem;';

    div.innerHTML = `
        <div>
            <input type="text" class="ing-name" placeholder="Item" value="${data?.name || ''}" 
                style="width: 100%; height: 32px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 0.4rem; padding: 0 0.5rem; font-size: 0.85rem;">
        </div>
        <div>
            <input type="number" class="ing-qty" placeholder="Qty" value="${data?.qty || 1}" 
                oninput="window.onQtyChange(this)"
                style="width: 100%; height: 32px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 0.4rem; padding: 0 0.5rem; font-size: 0.85rem;">
        </div>
        <div>
            <select class="ing-unit" style="width: 100%; height: 32px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 0.4rem; font-size: 0.8rem;">
                <option value="slices" ${data?.unit === 'slices' ? 'selected' : ''}>Slices</option>
                <option value="oz" ${data?.unit === 'oz' ? 'selected' : ''}>Oz</option>
                <option value="cups" ${data?.unit === 'cups' ? 'selected' : ''}>Cups</option>
                <option value="grams" ${data?.unit === 'grams' ? 'selected' : ''}>Grams</option>
                <option value="tbsp" ${data?.unit === 'tbsp' ? 'selected' : ''}>Tbsp</option>
                <option value="pieces" ${data?.unit === 'pieces' ? 'selected' : ''}>Pcs</option>
            </select>
        </div>
        <div style="position: relative;">
            <input type="number" class="ing-cal" placeholder="kcal" value="${data?.calories || 0}" 
                oninput="window.updateNutrientSummary()"
                data-pro="${data?.protein_g || 0}" data-carb="${data?.carbs_g || 0}" data-fat="${data?.fat_g || 0}"
                data-base-qty="${data?.qty || 1}"
                style="width: 100%; height: 32px; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); color: #10b981; border-radius: 0.4rem; padding: 0 0.5rem; font-size: 0.85rem; font-weight: 700;">
            <input type="hidden" class="ing-chol" value="${data?.cholesterol_mg || 0}">
        </div>
        <button onclick="document.getElementById('${rowId}').remove(); window.updateNutrientSummary();" 
            style="background:none; border:none; color:#f87171; cursor:pointer; padding: 0 0.5rem;">✕</button>
    `;
    list.appendChild(div);
}

window.estimateAllIngredients = async function () {
    const rows = document.querySelectorAll('.ingredient-row');
    if (rows.length === 0) return;

    const btn = document.getElementById('btn-ai-scan');
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
                    const calInput = row.querySelector('.ing-cal');
                    calInput.value = estimates[i].calories;
                    row.querySelector('.ing-chol').value = estimates[i].cholesterol_mg || 0;
                    calInput.setAttribute('data-pro', estimates[i].protein_g || 0);
                    calInput.setAttribute('data-carb', estimates[i].carbs_g || 0);
                    calInput.setAttribute('data-fat', estimates[i].fat_g || 0);
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

window.onQtyChange = function (input) {
    const row = input.closest('.ingredient-row');
    const calInput = row.querySelector('.ing-cal');
    const newQty = parseFloat(input.value) || 0;
    const baseQty = parseFloat(calInput.getAttribute('data-base-qty')) || 1;

    if (newQty > 0 && baseQty > 0) {
        const ratio = newQty / baseQty;
        const currentCal = parseFloat(calInput.value) || 0;
        calInput.value = Math.round(currentCal * ratio);

        const macros = ['pro', 'carb', 'fat'];
        macros.forEach(m => {
            const val = parseFloat(calInput.getAttribute(`data-${m}`)) || 0;
            calInput.setAttribute(`data-${m}`, Math.round(val * ratio));
        });

        const chol = row.querySelector('.ing-chol');
        chol.value = Math.round((parseInt(chol.value) || 0) * ratio);
        calInput.setAttribute('data-base-qty', newQty);
    }
    window.updateNutrientSummary();
}

window.updateNutrientSummary = function () {
    let totalCal = 0;
    let totalChol = 0;
    document.querySelectorAll('.ingredient-row').forEach(row => {
        totalCal += parseInt(row.querySelector('.ing-cal').value) || 0;
        totalChol += parseInt(row.querySelector('.ing-chol').value) || 0;
    });
    window.safeSetText('summary-cal', totalCal);
    window.safeSetText('summary-chol', totalChol + 'mg');
}

window.saveCustomFood = async function (alsoLog = true) {
    const name = document.getElementById('custom-name').value;
    const category = document.getElementById('custom-category').value;
    if (!name) return alert("Please name your recipe.");

    const ingredients = [];
    let totalCal = 0;
    let totalChol = 0;
    let totalPro = 0, totalCarb = 0, totalFat = 0;

    document.querySelectorAll('.ingredient-row').forEach(row => {
        const calInput = row.querySelector('.ing-cal');
        const cal = parseInt(calInput.value) || 0;
        const cholVal = parseInt(row.querySelector('.ing-chol').value) || 0;
        const pro = parseInt(calInput.getAttribute('data-pro')) || 0;
        const carb = parseInt(calInput.getAttribute('data-carb')) || 0;
        const fat = parseInt(calInput.getAttribute('data-fat')) || 0;

        ingredients.push({
            name: row.querySelector('.ing-name').value,
            qty: row.querySelector('.ing-qty').value,
            unit: row.querySelector('.ing-unit').value,
            calories: cal,
            cholesterol_mg: cholVal,
            protein_g: pro,
            carbs_g: carb,
            fat_g: fat
        });
        totalCal += cal;
        totalChol += cholVal;
        totalPro += pro;
        totalCarb += carb;
        totalFat += fat;
    });

    try {
        await fetch('/api/nutrition/custom_foods', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name, category, ingredients,
                calories: totalCal, cholesterol_mg: totalChol,
                protein_g: totalPro, carbs_g: totalCarb, fat_g: totalFat
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
