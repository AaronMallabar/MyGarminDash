let pbData = null;
let currentPbSport = 'bike';
let currentPbPeriod = 'lifetime'; // 'lifetime', 'year', 'month'

document.addEventListener('DOMContentLoaded', () => {
    checkPbSyncStatus();
    fetchPBs();
});



async function fetchPBs() {
    try {
        const res = await fetch('/api/personal_bests');
        pbData = await res.json();
        renderPBs();
    } catch (e) {
        console.error("PB Load Error:", e);
    }
}

function setPbSport(sport, btn) {
    currentPbSport = sport;
    const parent = btn.parentElement;
    parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    document.getElementById('pb-bike-view').style.display = sport === 'bike' ? 'block' : 'none';
    document.getElementById('pb-run-view').style.display = sport === 'run' ? 'block' : 'none';
    
    renderPBs();
}

function setPbPeriod(period, btn) {
    currentPbPeriod = period;
    const parent = btn.parentElement;
    parent.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPBs();
}

function renderPBs() {
    if (!pbData) return;
    const data = pbData[currentPbPeriod];
    if (!data) return;
    
    if (currentPbSport === 'bike') {
        document.getElementById('pb-bike-longest').innerHTML = data.bike.longest_ride > 0 ? `${data.bike.longest_ride.toFixed(1)} mi` : '--';
        document.getElementById('pb-bike-speed').innerHTML = data.bike.max_speed > 0 ? `${data.bike.max_speed.toFixed(1)} mph` : '--';
        document.getElementById('pb-bike-climb').innerHTML = data.bike.highest_climb > 0 ? `${data.bike.highest_climb.toFixed(0)} ft` : '--';
        
        const powers = data.bike.power_curve;
        let gridHtml = '';
        const labels = {'5': '5 Sec', '30': '30 Sec', '60': '1 Min', '120': '2 Min', '300': '5 Min', '600': '10 Min', '1200': '20 Min', '1800': '30 Min', '3600': '60 Min'};
        for (let k of ['5', '30', '60', '120', '300', '600', '1200', '1800', '3600']) {
            if (powers[k]) {
                const val = powers[k].val;
                gridHtml += `
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 0.8rem; border-radius: 0.5rem; text-align: center; cursor: pointer;" ${powers[k].id ? `onclick="openActivityModal('${powers[k].id}')"` : ''}>
                        <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 0.2rem;">${labels[k]}</div>
                        <div style="font-size: 1.2rem; font-weight: bold; color: ${val > 0 ? 'white' : 'gray'};">${val > 0 ? val+' W' : '--'}</div>
                    </div>
                `;
            }
        }
        document.getElementById('pb-power-grid').innerHTML = gridHtml;
        
    } else {
        document.getElementById('pb-run-longest').innerHTML = data.run.longest_run > 0 ? `${data.run.longest_run.toFixed(1)} mi` : '--';
        
        let gridHtml = '';
        const map = {'fastest_1mi': '1 Mile', 'fastest_5k': '5K', 'fastest_5mi': '5 Mile'};
        for (let [k, label] of Object.entries(map)) {
            const val = data.run[k]; // in seconds
            let paceStr = '--';
            if (val > 0) {
              const mins = Math.floor(val / 60);
              const secs = val % 60;
              paceStr = `${mins}:${secs.toString().padStart(2, '0')}`;
            }
            gridHtml += `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 0.8rem; border-radius: 0.5rem; text-align: center; cursor: pointer;" ${data.run[k+'_id'] ? `onclick="openActivityModal('${data.run[k+'_id']}')"` : ''}>
                    <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 0.2rem;">${label}</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: ${val > 0 ? 'white' : 'gray'};">${paceStr}</div>
                </div>
            `;
        }
        document.getElementById('pb-pace-grid').innerHTML = gridHtml;
    }
}

async function checkPbSyncStatus() {
    try {
        const res = await fetch('/api/pb_sync_status');
        const data = await res.json();
        const btn = document.getElementById('pb-sync-btn');
        if (data.active) {
            btn.innerHTML = 'Syncing...';
            btn.style.opacity = '0.5';
            btn.disabled = true;
            setTimeout(checkPbSyncStatus, 5000);
        } else {
            btn.innerHTML = 'Sync Past Bests (2025+)';
            btn.style.opacity = '1';
            btn.disabled = false;
        }
    } catch(e) {}
}

async function triggerPBSync() {
    try {
        const btn = document.getElementById('pb-sync-btn');
        btn.innerHTML = 'Starting...';
        btn.disabled = true;
        await fetch('/api/trigger_pb_sync', { method: 'POST' });
        checkPbSyncStatus();
    } catch(e) {
        console.error(e);
    }
}
