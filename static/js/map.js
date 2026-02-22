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

window.updateGlobalHeatmap = async function () {
    const rangeEl = document.getElementById('heatmap-range');
    const range = rangeEl ? rangeEl.value : 'all';
    const statusEl = document.getElementById('heatmap-status');
    const dot = document.getElementById('heatmap-dot');

    if (statusEl) statusEl.textContent = 'Fetching routes...';

    try {
        const res = await fetch(`/api/heatmap_data?range=${range}`);
        if (res.ok) {
            const data = await res.json();
            window.heatmapData = data.data || [];
            window.renderGlobalHeatmap();

            if (data.missing_count > 0) {
                if (statusEl) statusEl.textContent = `Syncing ${data.missing_count} routes...`;
                if (dot) dot.style.display = 'block';
                if (!window.heatmapPollInterval) {
                    window.heatmapPollInterval = setInterval(window.updateGlobalHeatmapSilent, 5000);
                }
            } else {
                if (statusEl) statusEl.textContent = 'All activities loaded';
                if (dot) dot.style.display = 'none';
                if (window.heatmapPollInterval) {
                    clearInterval(window.heatmapPollInterval);
                    window.heatmapPollInterval = null;
                }
            }
        }
    } catch (err) {
        console.error('Heatmap error:', err);
    }
}

window.updateGlobalHeatmapSilent = async function () {
    const rangeEl = document.getElementById('heatmap-range');
    const range = rangeEl ? rangeEl.value : 'all';
    try {
        const res = await fetch(`/api/heatmap_data?range=${range}`);
        if (res.ok) {
            const data = await res.json();
            if (data.data.length > window.heatmapData.length) {
                window.heatmapData = data.data;
                window.renderGlobalHeatmap(false);
            }
            if (data.missing_count === 0 && window.heatmapPollInterval) {
                clearInterval(window.heatmapPollInterval);
                window.heatmapPollInterval = null;
                const dot = document.getElementById('heatmap-dot');
                if (dot) dot.style.display = 'none';
            }
        }
    } catch (e) { console.error(e); }
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

    window.heatmapData.forEach(item => {
        const type = item.type.toLowerCase();
        let include = false;
        let color = '#38bdf8';

        if (type.includes('run')) {
            if (showRun) include = true;
            color = '#f97316';
        } else if (type.includes('virtual') || type.includes('indoor')) {
            if (showVirtual) include = true;
            color = '#a855f7';
        } else if (type.includes('cycle') || type.includes('ride') || type.includes('bike')) {
            if (showCycle) include = true;
            color = '#3b82f6';
        } else if (type.includes('walk') || type.includes('hike')) {
            if (showWalk) include = true;
            color = '#22c55e';
        }

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
