
window.openActivityFromHeatmap = function (id) {
    const act = (window.heatmapData || []).find(a => String(a.id) === String(id));
    if (act) {
        window.openActivityDetail(act.id, {
            activityId: act.id,
            activityName: act.name || 'Activity',
            startTimeLocal: act.date || '',
            distance: act.distance || 0,
            duration: act.duration || 0,
            activityType: { typeKey: act.type || 'unknown' }
        });
    } else {
        window.openActivityDetail(id);
    }
};

/**
 * Map & Heatmap Management (Leaflet)
 */

window.globalHeatmap = null;
window.heatmapData = [];
window.heatmapPollInterval = null;
window.activityMap = null;
window.currentMapStyle = localStorage.getItem('garmin_map_style') || 'dark';
window.showActivityClusters = localStorage.getItem('garmin_show_clusters') !== 'false';
window.heatmapVisualMode = localStorage.getItem('garmin_heatmap_mode') || 'categories'; // 'categories' | 'heat'
window.globalBaseLayer = null;
window.activityBaseLayer = null;

function createBaseTileLayer(style) {
    const mode = style || window.currentMapStyle || 'dark';

    if (mode === 'satellite') {
        const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxNativeZoom: 18,
            maxZoom: 22,
            attribution: '&copy; Esri'
        });
        const labels = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            maxNativeZoom: 18,
            maxZoom: 22,
            pane: 'overlayPane',
            opacity: 0.85
        });
        return L.layerGroup([imagery, labels]);
    }

    if (mode === 'road') {
        return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxNativeZoom: 19,
            maxZoom: 22,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
        });
    }

    if (mode === 'topo') {
        return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            maxNativeZoom: 17,
            maxZoom: 22,
            attribution: '&copy; Esri'
        });
    }

    // Default: 'dark' - Esri World Dark Gray Base + Reference (Zero API key required, with maxNativeZoom: 16 preventing "Map data not available" when zoomed up to 22)
    const darkBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 16,
        maxZoom: 22,
        attribution: '&copy; Esri, OpenStreetMap contributors'
    });
    const darkLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 16,
        maxZoom: 22,
        opacity: 0.85
    });

    return L.layerGroup([darkBase, darkLabels]);
}

function syncMapStyleButtons(style) {
    document.querySelectorAll('[data-map-style]').forEach(btn => {
        const isActive = btn.getAttribute('data-map-style') === style;
        btn.style.background = isActive ? 'var(--accent-color)' : 'transparent';
        btn.style.color = isActive ? '#0f172a' : '#cbd5e1';
        btn.style.fontWeight = isActive ? '700' : '600';
    });
}

function syncClusterButtonState() {
    const btn = document.getElementById('heatmap-toggle-clusters-btn');
    const label = document.getElementById('heatmap-clusters-label');
    if (!btn || !label) return;
    
    if (window.showActivityClusters) {
        btn.style.background = 'rgba(56, 189, 248, 0.15)';
        btn.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        btn.style.color = 'var(--accent-color)';
        label.textContent = 'Counts: ON';
    } else {
        btn.style.background = 'rgba(15, 23, 42, 0.88)';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        btn.style.color = '#94a3b8';
        label.textContent = 'Counts: OFF';
    }
}

function syncHeatmapModeButton() {
    const label = document.getElementById('heatmap-mode-label');
    const icon = document.getElementById('heatmap-mode-icon');
    if (!label) return;

    if (window.heatmapVisualMode === 'heat') {
        label.textContent = 'Heat Glow';
        if (icon) icon.textContent = '🔥';
    } else {
        label.textContent = 'Sport Colors';
        if (icon) icon.textContent = '🎨';
    }
}

window.toggleHeatmapClusters = function () {
    window.showActivityClusters = !window.showActivityClusters;
    try { localStorage.setItem('garmin_show_clusters', window.showActivityClusters); } catch (e) {}
    syncClusterButtonState();

    if (!window.globalHeatmap || !window.clusterLayerGroup) return;

    if (window.showActivityClusters) {
        if (!window.globalHeatmap.hasLayer(window.clusterLayerGroup)) {
            window.clusterLayerGroup.addTo(window.globalHeatmap);
        }
    } else {
        if (window.globalHeatmap.hasLayer(window.clusterLayerGroup)) {
            window.globalHeatmap.removeLayer(window.clusterLayerGroup);
        }
    }
};

window.toggleHeatmapMode = function () {
    window.heatmapVisualMode = window.heatmapVisualMode === 'categories' ? 'heat' : 'categories';
    try { localStorage.setItem('garmin_heatmap_mode', window.heatmapVisualMode); } catch (e) {}
    syncHeatmapModeButton();
    window.renderGlobalHeatmap(false);
};

window.setMapBaseStyle = function (style) {
    window.currentMapStyle = style || 'dark';
    try { localStorage.setItem('garmin_map_style', window.currentMapStyle); } catch (e) {}
    syncMapStyleButtons(window.currentMapStyle);

    if (window.globalHeatmap) {
        if (window.globalBaseLayer) {
            window.globalHeatmap.removeLayer(window.globalBaseLayer);
        }
        window.globalBaseLayer = createBaseTileLayer(window.currentMapStyle).addTo(window.globalHeatmap);
        if (window.globalLayerGroup && window.globalLayerGroup.bringToFront) {
            window.globalLayerGroup.eachLayer(l => { if (l.bringToFront) l.bringToFront(); });
        }
    }

    if (window.activityMap) {
        if (window.activityBaseLayer) {
            window.activityMap.removeLayer(window.activityBaseLayer);
        }
        window.activityBaseLayer = createBaseTileLayer(window.currentMapStyle).addTo(window.activityMap);
    }
};

window.resetGlobalHeatmapView = function () {
    if (!window.globalHeatmap || !window.heatmapData || window.heatmapData.length === 0) return;
    window.renderGlobalHeatmap(true);
};

window.initMap = function () {
    if (window.globalHeatmap) return;
    const mapEl = document.getElementById('globalHeatmap');
    if (!mapEl) return;

    syncMapStyleButtons(window.currentMapStyle);
    syncClusterButtonState();
    syncHeatmapModeButton();

    window.globalHeatmap = L.map('globalHeatmap', {
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
        maxZoom: 22
    }).setView([0, 0], 2);

    window.globalBaseLayer = createBaseTileLayer(window.currentMapStyle).addTo(window.globalHeatmap);
    window.globalLayerGroup = L.layerGroup().addTo(window.globalHeatmap);

    // MarkerCluster configured with smart zoom behavior and custom glassmorphic styling
    window.clusterLayerGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 40,
        disableClusteringAtZoom: 15, // Automatically disband clusters at street level for unobstructed view
        spiderfyOnMaxZoom: true,
        animate: true,
        iconCreateFunction: function (cluster) {
            const count = cluster.getChildCount();
            let size = 36;
            let glowColor = 'rgba(16, 185, 129, 0.4)';
            let borderColor = '#10b981';

            if (count >= 50) {
                size = 46;
                glowColor = 'rgba(168, 85, 247, 0.5)';
                borderColor = '#a855f7';
            } else if (count >= 15) {
                size = 40;
                glowColor = 'rgba(56, 189, 248, 0.5)';
                borderColor = '#38bdf8';
            }

            return L.divIcon({
                html: `<div class="custom-cluster-badge" style="width: ${size}px; height: ${size}px; border-radius: 50%; background: rgba(15, 23, 42, 0.92); border: 2px solid ${borderColor}; box-shadow: 0 0 14px ${glowColor}; display: flex; align-items: center; justify-content: center; color: #fff; font-family: 'Lexend', sans-serif; font-weight: 800; cursor: pointer; transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);">
                    <span style="font-size: ${size > 40 ? '0.85rem' : '0.78rem'};">${count}</span>
                </div>`,
                className: 'custom-cluster-container',
                iconSize: new L.Point(size, size)
            });
        }
    });

    if (window.showActivityClusters) {
        window.clusterLayerGroup.addTo(window.globalHeatmap);
    }

    window.globalHeatmap.on('zoomend', window.handleHeatmapZoom);
};

window.handleHeatmapZoom = function () {
    if (!window.globalLayerGroup || !window.globalHeatmap) return;
    const z = window.globalHeatmap.getZoom();
    
    // Adaptive weight and opacity for vibrant, glowing heat lines
    let newWeight = 3;
    let newOpacity = 0.65;
    
    if (z <= 8) {
        newWeight = 2.5;
        newOpacity = 0.45;
    } else if (z <= 12) {
        newWeight = 3.5;
        newOpacity = 0.65;
    } else {
        newWeight = 4.5;
        newOpacity = 0.85;
    }

    window.globalLayerGroup.eachLayer(l => {
        if (l.setStyle) {
            l.setStyle({ weight: newWeight, opacity: newOpacity });
        }
    });
};

function showHeatmapLoading(message) {
    const loadingEl = document.getElementById('heatmap-loading');
    const statusEl = document.getElementById('heatmap-status');
    const dot = document.getElementById('heatmap-dot');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (statusEl) statusEl.textContent = message || 'Loading...';
    if (dot) dot.style.display = 'block';
}

function hideHeatmapLoading(message) {
    const loadingEl = document.getElementById('heatmap-loading');
    const statusEl = document.getElementById('heatmap-status');
    const dot = document.getElementById('heatmap-dot');
    if (dot) dot.style.display = 'none';
    if (message) {
        if (statusEl) statusEl.textContent = message;
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

    window._heatmapStallCount = 0;
    window._heatmapLastMissing = null;
    window._heatmapLastLoaded = null;
    window._heatmapLastTotal = null;

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

            window._heatmapLastMissing = missing;
            window._heatmapLastLoaded = loaded;
            window._heatmapLastTotal = total;

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
};

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
            const routes = data.data || [];

            const prevLen = (window.heatmapData || []).length;
            const nowMs = Date.now();
            if (routes.length !== prevLen && (missing === 0 || !window._lastHeatmapRenderMs || (nowMs - window._lastHeatmapRenderMs >= 9000))) {
                window.heatmapData = routes;
                window.renderGlobalHeatmap(false);
                window._lastHeatmapRenderMs = nowMs;
            }

            if (missing > 0) {
                if (missing === window._heatmapLastMissing && loaded === window._heatmapLastLoaded && total === window._heatmapLastTotal) {
                    window._heatmapStallCount = (window._heatmapStallCount || 0) + 1;
                } else {
                    window._heatmapStallCount = 0;
                    window._heatmapLastMissing = missing;
                    window._heatmapLastLoaded = loaded;
                    window._heatmapLastTotal = total;
                }

                if (window._heatmapStallCount >= 15) {
                    if (window.heatmapPollInterval) {
                        clearInterval(window.heatmapPollInterval);
                        window.heatmapPollInterval = null;
                    }
                    window.heatmapData = routes;
                    window.renderGlobalHeatmap(false);
                    hideHeatmapLoading(`${loaded} routes loaded`);
                    return;
                }

                const statusEl = document.getElementById('heatmap-status');
                if (statusEl) statusEl.textContent = `Syncing ${missing} routes... (${loaded}/${total} loaded)`;
            } else {
                if (window.heatmapPollInterval) {
                    clearInterval(window.heatmapPollInterval);
                    window.heatmapPollInterval = null;
                }
                window.heatmapData = routes;
                window.renderGlobalHeatmap(false);
                hideHeatmapLoading(`${loaded} routes loaded`);
            }
        }
    } catch (e) { console.error(e); }
};

function classifyActivityType(typeStr) {
    if (!typeStr) return { category: 'other', color: '#eab308', display: 'Other' };
    const t = typeStr.toLowerCase();

    if (t.includes('virtual') || t.includes('indoor') || t.includes('treadmill')) {
        return { category: 'virtual', color: '#a855f7', display: 'Virtual' };
    }
    if (t.includes('swim')) {
        return { category: 'swim', color: '#06b6d4', display: 'Swim' };
    }
    if (t.includes('run')) {
        return { category: 'run', color: '#f97316', display: 'Run' };
    }
    if (t.includes('cycl') || t.includes('ride') || t.includes('bik')) {
        return { category: 'cycle', color: '#38bdf8', display: 'Cycling' };
    }
    if (t.includes('walk') || t.includes('hik') || t.includes('snow_shoe') || t.includes('mountaineer')) {
        return { category: 'walk', color: '#22c55e', display: 'Walk/Hike' };
    }
    return { category: 'other', color: '#eab308', display: 'Other' };
}

window.renderGlobalHeatmap = function (resetView = true) {
    if (!window.globalHeatmap) window.initMap();
    if (!window.globalHeatmap) return;

    window.globalLayerGroup.clearLayers();
    window.clusterLayerGroup.clearLayers();

    const showRun = document.getElementById('heatmap-run')?.checked ?? true;
    const showCycle = document.getElementById('heatmap-cycle')?.checked ?? true;
    const showWalk = document.getElementById('heatmap-walk')?.checked ?? true;
    const showSwim = document.getElementById('heatmap-swim')?.checked ?? true;
    const showVirtual = document.getElementById('heatmap-virtual')?.checked ?? true;
    const showOther = document.getElementById('heatmap-other')?.checked ?? true;

    const boundsArr = [];
    if (!window.globalCanvasRenderer) {
        window.globalCanvasRenderer = L.canvas({ padding: 0.5 });
    }
    const renderer = window.globalCanvasRenderer;
    const markersBatch = [];
    const isHeatGlow = window.heatmapVisualMode === 'heat';
    const currentZoom = window.globalHeatmap.getZoom();

    let baseWeight = 3;
    let baseOpacity = 0.65;
    if (currentZoom <= 8) {
        baseWeight = 2.5;
        baseOpacity = 0.45;
    } else if (currentZoom >= 13) {
        baseWeight = 4.5;
        baseOpacity = 0.85;
    }

    window.heatmapData.forEach(item => {
        const { category, color, display } = classifyActivityType(item.type);

        let include = false;
        if (category === 'run' && showRun) include = true;
        else if (category === 'cycle' && showCycle) include = true;
        else if (category === 'walk' && showWalk) include = true;
        else if (category === 'swim' && showSwim) include = true;
        else if (category === 'virtual' && showVirtual) include = true;
        else if (category === 'other' && showOther) include = true;

        if (include && Array.isArray(item.poly) && item.poly.length > 1) {
            try {
                const rawLatlngs = Array.isArray(item.poly[0]) ? item.poly : item.poly.map(p => p ? [p.lat, p.lon] : null);
                const latlngs = rawLatlngs.filter(pt =>
                    Array.isArray(pt) &&
                    pt.length >= 2 &&
                    pt[0] !== null && pt[1] !== null &&
                    Number.isFinite(Number(pt[0])) &&
                    Number.isFinite(Number(pt[1]))
                );
                if (latlngs.length < 2) return;

                const routeColor = isHeatGlow ? '#fb923c' : color;
                const distMi = item.distance ? (item.distance / 1609.34).toFixed(1) + ' mi' : '';
                const durMin = item.duration ? Math.round(item.duration / 60) + ' min' : '';
                const dateStr = item.date ? new Date(item.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';

                // Create sleek, clickable start pinpoint for clusters / unclustered markers
                const pinIcon = L.divIcon({
                    html: `<div style="width: 14px; height: 14px; border-radius: 50%; background: ${color}; border: 2px solid #0f172a; box-shadow: 0 0 10px ${color}; cursor: pointer; transition: transform 0.2s;"></div>`,
                    className: 'activity-hub-pin',
                    iconSize: [14, 14],
                    iconAnchor: [7, 7]
                });

                const marker = L.marker(latlngs[0], { icon: pinIcon });
                const popupContent = `
                    <div style="font-family: var(--font-family); color: #fff; padding: 0.35rem; min-width: 190px;">
                        <div style="font-size: 0.68rem; font-weight: 800; color: ${color}; text-transform: uppercase; letter-spacing: 0.05em;">${display}</div>
                        <div style="font-size: 0.95rem; font-weight: 800; color: #fff; margin: 0.25rem 0;">${item.name || 'Activity'}</div>
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 0.75rem;">
                            ${dateStr}${distMi ? ' • ' + distMi : ''}${durMin ? ' • ' + durMin : ''}
                        </div>
                        <button onclick="window.openActivityFromHeatmap(${item.id})" class="range-btn active" style="width: 100%; padding: 0.45rem 0.8rem; font-size: 0.75rem; font-weight: 700; border-radius: 0.5rem; background: var(--accent-color); color: #0f172a; border: none; cursor: pointer;">
                            View Details ➔
                        </button>
                    </div>
                `;
                marker.bindPopup(popupContent, { className: 'dark-map-popup', maxWidth: 280 });
                markersBatch.push(marker);

                // Interactive route polyline with hover tooltips and click-to-open
                const polyline = L.polyline(latlngs, {
                    color: routeColor,
                    weight: baseWeight,
                    opacity: baseOpacity,
                    smoothFactor: 1.2,
                    lineCap: 'round',
                    lineJoin: 'round',
                    renderer: renderer,
                    interactive: true
                }).addTo(window.globalLayerGroup);

                const tooltipText = `${item.name || 'Activity'}${distMi ? ' (' + distMi + ')' : ''}${dateStr ? ' • ' + dateStr : ''}`;
                polyline.bindTooltip(tooltipText, {
                    sticky: true,
                    className: 'dark-route-tooltip',
                    direction: 'top',
                    opacity: 0.95
                });

                polyline.on('mouseover', function () {
                    polyline.setStyle({ weight: baseWeight + 2.5, opacity: 1.0 });
                    if (polyline.bringToFront) polyline.bringToFront();
                });

                polyline.on('mouseout', function () {
                    polyline.setStyle({ weight: baseWeight, opacity: baseOpacity });
                });

                polyline.on('click', function () {
                    if (item.id) {
                        window.openActivityFromHeatmap(item.id);
                    }
                });

                if (resetView) {
                    boundsArr.push(latlngs[0]);
                    boundsArr.push(latlngs[Math.floor(latlngs.length / 2)]);
                    boundsArr.push(latlngs[latlngs.length - 1]);
                }
            } catch (routeErr) {
                console.warn('Skipping malformed route in heatmap:', item.id, routeErr);
            }
        }
    });

    if (markersBatch.length > 0) {
        window.clusterLayerGroup.addLayers(markersBatch);
    }

    if (resetView && boundsArr.length > 0) {
        window.globalHeatmap.fitBounds(L.latLngBounds(boundsArr), { padding: [25, 25] });
    }
};

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

    window.currentActivityPoints = polylineData.map(p => (p && p[0] != null) ? [p[0], p[1]] : null);
    const displayPoints = window.currentActivityPoints.filter(p => p !== null);

    syncMapStyleButtons(window.currentMapStyle);

    // Activity modal map configured with maxZoom 22 for deep street-level zooming
    window.activityMap = L.map('activityMap', {
        zoomControl: false,
        attributionControl: false,
        maxZoom: 22
    });

    window.activityBaseLayer = createBaseTileLayer(window.currentMapStyle).addTo(window.activityMap);

    if (displayPoints.length > 1) {
        const path = L.polyline(displayPoints, {
            color: '#38bdf8', weight: 4.5, opacity: 0.85, lineJoin: 'round', lineCap: 'round'
        }).addTo(window.activityMap);

        window.activityMap.fitBounds(path.getBounds(), { padding: [25, 25] });
    }

    setTimeout(() => { if (window.activityMap) window.activityMap.invalidateSize(); }, 200);
};

window.highlightActivitySegment = function (startIdx, endIdx) {
    if (!window.activityMap || !window.currentActivityPoints) return;

    if (window.activityHighlightLayer) {
        window.activityMap.removeLayer(window.activityHighlightLayer);
    }

    const rawSegment = window.currentActivityPoints.slice(startIdx, endIdx + 1);
    const segment = rawSegment.filter(p => p !== null);

    if (segment.length < 2) return;

    window.activityHighlightLayer = L.polyline(segment, {
        color: '#f59e0b', weight: 8, opacity: 0.95, lineJoin: 'round', lineCap: 'round', className: 'pulse-segment'
    }).addTo(window.activityMap);
};

window.zoomActivityMap = function (factor) {
    if (!window.activityMap) return;
    const currentZoom = window.activityMap.getZoom();
    const nextZoom = currentZoom + factor;
    if (nextZoom >= 1 && nextZoom <= 22) {
        window.activityMap.setZoom(nextZoom);
    }
};

window.clearActivityHighlight = function () {
    if (window.activityMap && window.activityHighlightLayer) {
        window.activityMap.removeLayer(window.activityHighlightLayer);
        window.activityHighlightLayer = null;
    }
};
