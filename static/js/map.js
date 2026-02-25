/**
 * Map & Heatmap Management (Leaflet)
 */

window.globalHeatmap = null;
window.heatmapData = [];
window.heatmapPollInterval = null;
window.activityMap = null;

window.initMap = function () {
    if (window.globalHeatmap) return;
    const mapEl = document.getElementById('globalHeatmap');
    if (!mapEl) return;

    window.globalHeatmap = L.map('globalHeatmap', {
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true
    }).setView([0, 0], 2);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(window.globalHeatmap);

    window.globalLayerGroup = L.layerGroup().addTo(window.globalHeatmap);

    window.clusterLayerGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        iconCreateFunction: function (cluster) {
            return L.divIcon({
                html: '<div><span>' + cluster.getChildCount() + '</span></div>',
                className: 'marker-cluster marker-cluster-medium',
                iconSize: new L.Point(40, 40)
            });
        }
    }).addTo(window.globalHeatmap);

    window.globalHeatmap.on('zoomend', window.handleHeatmapZoom);
}

window.handleHeatmapZoom = function () {
    if (!window.globalLayerGroup || !window.globalHeatmap) return;
    const z = window.globalHeatmap.getZoom();
    const newWeight = z < 11 ? 4 : 2;
    const newOpacity = z < 11 ? 0.5 : 0.6;

    window.globalLayerGroup.eachLayer(l => {
        if (l.setStyle) l.setStyle({ weight: newWeight, opacity: newOpacity });
    });
}

/**
 * Show the loading indicator at the bottom of the heatmap
 */
function showHeatmapLoading(message) {
    const loadingEl = document.getElementById('heatmap-loading');
    const statusEl = document.getElementById('heatmap-status');
    const dot = document.getElementById('heatmap-dot');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (statusEl) statusEl.textContent = message || 'Loading...';
    if (dot) dot.style.display = 'block';
}

/**
 * Hide the loading indicator or show a final status
 */
function hideHeatmapLoading(message) {
    const loadingEl = document.getElementById('heatmap-loading');
    const statusEl = document.getElementById('heatmap-status');
    const dot = document.getElementById('heatmap-dot');
    if (dot) dot.style.display = 'none';
    if (message) {
        if (statusEl) statusEl.textContent = message;
        // Fade out after 3 seconds
        setTimeout(() => {
            if (loadingEl) loadingEl.style.display = 'none';
        }, 3000);
    } else {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

window.updateGlobalHeatmap = async function () {
    const rangeEl = document.getElementById('heatmap-range');
    const range = rangeEl ? rangeEl.value : 'all';

    showHeatmapLoading('Fetching routes...');

    try {
        const res = await fetch(`/api/heatmap_data?range=${range}`);
        if (res.ok) {
            const data = await res.json();
            window.heatmapData = data.data || [];
            window.renderGlobalHeatmap();

            const loaded = data.count || 0;
            const total = data.total_activities || 0;
            const missing = data.missing_count || 0;

            if (missing > 0) {
                showHeatmapLoading(`Syncing ${missing} routes... (${loaded}/${total} loaded)`);
                if (!window.heatmapPollInterval) {
                    window.heatmapPollInterval = setInterval(window.updateGlobalHeatmapSilent, 3000);
                }
            } else {
                hideHeatmapLoading(`${loaded} routes loaded`);
                if (window.heatmapPollInterval) {
                    clearInterval(window.heatmapPollInterval);
                    window.heatmapPollInterval = null;
                }
            }
        }
    } catch (err) {
        console.error('Heatmap error:', err);
        hideHeatmapLoading('Error loading routes');
    }
}

window.updateGlobalHeatmapSilent = async function () {
    const rangeEl = document.getElementById('heatmap-range');
    const range = rangeEl ? rangeEl.value : 'all';
    try {
        const res = await fetch(`/api/heatmap_data?range=${range}`);
        if (res.ok) {
            const data = await res.json();
            const loaded = data.count || 0;
            const total = data.total_activities || 0;
            const missing = data.missing_count || 0;

            if (data.data.length > window.heatmapData.length) {
                window.heatmapData = data.data;
                window.renderGlobalHeatmap(false);
            }

            // Update status text live during syncing
            const statusEl = document.getElementById('heatmap-status');
            if (missing > 0) {
                if (statusEl) statusEl.textContent = `Syncing ${missing} routes... (${loaded}/${total} loaded)`;
            }

            if (missing === 0) {
                if (window.heatmapPollInterval) {
                    clearInterval(window.heatmapPollInterval);
                    window.heatmapPollInterval = null;
                }
                // Final update with all data
                window.heatmapData = data.data;
                window.renderGlobalHeatmap(false);
                hideHeatmapLoading(`${loaded} routes loaded`);
            }
        }
    } catch (e) { console.error(e); }
}

/**
 * Classify an activity type string into a category.
 * Returns { category: 'run'|'cycle'|'walk'|'virtual'|'other', color: string }
 */
function classifyActivityType(typeStr) {
    if (!typeStr) return { category: 'other', color: '#94a3b8' };
    const t = typeStr.toLowerCase();

    // Virtual / indoor first (before cycling check, since 'indoor_cycling' contains 'cycling')
    if (t.includes('virtual') || t.includes('indoor')) {
        return { category: 'virtual', color: '#a855f7' };
    }
    // Running
    if (t.includes('run')) {
        return { category: 'run', color: '#f97316' };
    }
    // Cycling — check all Garmin variants: cycling, road_biking, mountain_biking, gravel_cycling, etc.
    if (t.includes('cycl') || t.includes('ride') || t.includes('bik')) {
        return { category: 'cycle', color: '#3b82f6' };
    }
    // Walking / Hiking
    if (t.includes('walk') || t.includes('hik')) {
        return { category: 'walk', color: '#22c55e' };
    }
    // Fallback — still show it as a generic activity
    return { category: 'other', color: '#94a3b8' };
}

window.renderGlobalHeatmap = function (resetView = true) {
    if (!window.globalHeatmap) window.initMap();
    if (!window.globalHeatmap) return;

    window.globalLayerGroup.clearLayers();
    window.clusterLayerGroup.clearLayers();

    const showRun = document.getElementById('heatmap-run')?.checked ?? true;
    const showCycle = document.getElementById('heatmap-cycle')?.checked ?? true;
    const showWalk = document.getElementById('heatmap-walk')?.checked ?? true;
    const showVirtual = document.getElementById('heatmap-virtual')?.checked ?? true;

    const boundsArr = [];
    const renderer = L.canvas({ padding: 0.5 });
    let routeCount = 0;

    window.heatmapData.forEach(item => {
        const { category, color } = classifyActivityType(item.type);

        // Filter based on checkbox state
        let include = false;
        if (category === 'run' && showRun) include = true;
        else if (category === 'cycle' && showCycle) include = true;
        else if (category === 'walk' && showWalk) include = true;
        else if (category === 'virtual' && showVirtual) include = true;
        else if (category === 'other') include = true; // Always show uncategorized

        if (include && item.poly && item.poly.length > 1) {
            const latlngs = Array.isArray(item.poly[0]) ? item.poly : item.poly.map(p => [p.lat, p.lon]);

            const marker = L.marker(latlngs[0], {
                icon: L.divIcon({ className: 'hidden-marker', html: '', iconSize: [0, 0] })
            });
            window.clusterLayerGroup.addLayer(marker);

            L.polyline(latlngs, {
                color: color,
                weight: 3,
                opacity: 0.6,
                renderer: renderer,
                interactive: false
            }).addTo(window.globalLayerGroup);

            routeCount++;

            if (resetView) {
                boundsArr.push(latlngs[0]);
                boundsArr.push(latlngs[Math.floor(latlngs.length / 2)]);
                boundsArr.push(latlngs[latlngs.length - 1]);
            }
        }
    });

    if (resetView && boundsArr.length > 0) {
        window.globalHeatmap.fitBounds(L.latLngBounds(boundsArr), { padding: [20, 20] });
    }
}

window.renderActivityMap = function (polylineData) {
    const container = document.getElementById('activity-map-container');
    const mapEl = document.getElementById('activityMap');
    if (!container || !mapEl) return;

    if (window.activityMap) {
        window.activityMap.remove();
        window.activityMap = null;
    }

    if (!polylineData || polylineData.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    const latlngs = Array.isArray(polylineData[0]) ? polylineData : polylineData.map(p => [p.lat, p.lon]);

    window.activityMap = L.map('activityMap', {
        zoomControl: false,
        attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(window.activityMap);

    const path = L.polyline(latlngs, {
        color: '#38bdf8',
        weight: 4,
        opacity: 0.8,
        lineJoin: 'round'
    }).addTo(window.activityMap);

    window.activityMap.fitBounds(path.getBounds(), { padding: [20, 20] });
    setTimeout(() => { if (window.activityMap) window.activityMap.invalidateSize(); }, 200);
}
