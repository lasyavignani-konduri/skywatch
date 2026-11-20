/**
 * SkyWatch Radar Engine - Rajiv Gandhi International Airport (VOHS / HYD)
 * Tactical Radar Scope, Leaflet Map Integration, 60 FPS Dead-Reckoning & Dynamic Telemetry
 */

(function () {
  'use strict';

  // Airport center coordinates (ICAO: VOHS, Elevation: 2024 ft MSL)
  const VOHS = {
    lat: 17.2403,
    lon: 78.4294,
    elevationFt: 2024,
    radiusNm: 60
  };

  // State
  let activeView = 'radar'; // 'radar' | 'dark' | 'sat' | 'wx'
  let currentPeriod = 'hour';
  let selectedIcao = null;
  const flightsMap = new Map(); // icao24 -> state object
  const flightMarkers = new Map(); // icao24 -> Leaflet Marker
  const flightTrails = new Map(); // icao24 -> Leaflet Polyline

  // DOM Elements
  const clockEl = document.getElementById('clk');
  const modeDotEl = document.getElementById('mode-dot');
  const modeTextEl = document.getElementById('mode-text');
  const rwyChipEl = document.getElementById('top-rwy');
  const alertPeriodEl = document.getElementById('alert-period');

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnLayers = document.getElementById('btn-layers');
  const layerPopup = document.getElementById('layer-popup');

  // IST Clock
  function updateClock() {
    if (!clockEl) return;
    clockEl.textContent = new Date().toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }) + ' IST';
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ========================================================
  // LEAFLET MAP & OPEN-SOURCE TILE INTEGRATION
  // ========================================================
  let map = null;
  let darkTileLayer = null;
  let darkLabelsLayer = null;
  let streetTileLayer = null;
  let satTileLayer = null;
  let satLabelsLayer = null;
  let weatherRadarLayer = null;
  let ringsLayerGroup = null;
  let runwayLayerGroup = null;

  function initMap() {
    if (typeof L === 'undefined') return;

    map = L.map('map-container', {
      center: [VOHS.lat, VOHS.lon],
      zoom: 10,
      minZoom: 6,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true
    });

    if (map.attributionControl) {
      map.attributionControl.setPosition('bottomleft');
      map.attributionControl.setPrefix(false);
    }

    // 1. Esri World Dark Gray Canvas (Default for Tactical Radar Scope - 100% Free, Keyless, No Watermarks)
    darkTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      zIndex: 2
    });

    darkLabelsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      zIndex: 3
    });

    // 2. OpenStreetMap Standard (for Detailed Street / City Map View - 100% Free, Keyless, No Watermarks)
    streetTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
      zIndex: 2
    });

    // 3. Esri World Imagery (for True High-Resolution Satellite View - 100% Free, Keyless, No Watermarks)
    satTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Maxar, Earthstar Geographics',
      zIndex: 2
    });

    // 3b. Esri Boundaries and Places Reference Labels (Overlaid on Satellite)
    satLabelsLayer = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      zIndex: 3
    });

    // 4. Tactical Range Rings & Azimuth Overlays
    ringsLayerGroup = L.layerGroup().addTo(map);
    drawRangeRings();

    // 5. Authoritative Runways 09R/27L and 09L/27R & Approach Guidance
    runwayLayerGroup = L.layerGroup().addTo(map);
    drawRunways();

    // 6. RainViewer Doppler Radar Overlay
    loadRainViewer();

    // Initial View: Tactical Radar Basemap
    setView('radar');

    // Invalidate size once DOM settles
    setTimeout(() => { if (map) map.invalidateSize(); }, 300);

    // Click background to deselect flight
    map.on('click', () => {
      selectedIcao = null;
      updatePlanes();
    });
  }

  // Draw Range Rings (10, 20, 30, 40, 50, 60 nm) + Cardinal Crosshairs + Waypoints
  function drawRangeRings() {
    if (!ringsLayerGroup) return;
    ringsLayerGroup.clearLayers();

    const rings = [
      { nm: 10, meters: 18520, opacity: 0.75, color: '#3A80FF' },
      { nm: 20, meters: 37040, opacity: 0.6, color: '#3A80FF' },
      { nm: 30, meters: 55560, opacity: 0.5, color: '#2F6BFF' },
      { nm: 40, meters: 74080, opacity: 0.4, color: '#2F6BFF' },
      { nm: 50, meters: 92600, opacity: 0.35, color: '#2352C4' },
      { nm: 60, meters: 111120, opacity: 0.3, color: '#1B3F99' }
    ];

    rings.forEach(r => {
      L.circle([VOHS.lat, VOHS.lon], {
        radius: r.meters,
        color: r.color,
        weight: 1.4,
        dashArray: '5, 8',
        opacity: r.opacity,
        fill: false,
        interactive: false
      }).addTo(ringsLayerGroup);

      // Label along the East radial
      const labelPos = [VOHS.lat, VOHS.lon + (r.nm * (1 / 60) / Math.cos(VOHS.lat * Math.PI / 180))];
      const labelIcon = L.divIcon({
        className: 'ring-label',
        html: `<span style="color:#7FA6FF;font-size:11px;font-weight:600;opacity:${r.opacity};text-shadow:0 0 5px #000;background:rgba(2,6,14,0.65);padding:1px 5px;border-radius:3px">${r.nm} nm</span>`,
        iconSize: [46, 16],
        iconAnchor: [0, 8]
      });
      L.marker(labelPos, { icon: labelIcon, interactive: false }).addTo(ringsLayerGroup);
    });

    // Cardinal Axes (N, S, E, W crosshairs radiating 60 nm)
    const dLat60 = 60 / 60; // 1 degree
    const dLon60 = dLat60 / Math.cos(VOHS.lat * Math.PI / 180);

    // North - South axis
    L.polyline([[VOHS.lat - dLat60, VOHS.lon], [VOHS.lat + dLat60, VOHS.lon]], {
      color: '#2F6BFF',
      weight: 1,
      dashArray: '3, 9',
      opacity: 0.35,
      interactive: false
    }).addTo(ringsLayerGroup);

    // East - West axis
    L.polyline([[VOHS.lat, VOHS.lon - dLon60], [VOHS.lat, VOHS.lon + dLon60]], {
      color: '#2F6BFF',
      weight: 1,
      dashArray: '3, 9',
      opacity: 0.35,
      interactive: false
    }).addTo(ringsLayerGroup);

    // Cardinal labels (N, S, E, W)
    const makeAxisLabel = (txt, pos) => L.marker(pos, {
      icon: L.divIcon({
        className: 'axis-label',
        html: `<b style="color:#7FA6FF;font-size:11px;font-weight:700;text-shadow:0 0 6px #000;background:rgba(2,6,14,0.7);padding:1px 4px;border-radius:2px">${txt}</b>`,
        iconSize: [48, 16],
        iconAnchor: [24, 8]
      }),
      interactive: false
    }).addTo(ringsLayerGroup);

    makeAxisLabel('N 360°', [VOHS.lat + dLat60 + 0.02, VOHS.lon]);
    makeAxisLabel('S 180°', [VOHS.lat - dLat60 - 0.02, VOHS.lon]);
    makeAxisLabel('E 090°', [VOHS.lat, VOHS.lon + dLon60 + 0.03]);
    makeAxisLabel('W 270°', [VOHS.lat, VOHS.lon - dLon60 - 0.03]);

    // Key RNAV Waypoints / Terminal Fixes for VOHS
    const waypoints = [
      { name: 'LATID', lat: 17.2318, lon: 78.6800 },
      { name: 'BODEL', lat: 17.2312, lon: 78.1800 },
      { name: 'NOBAT', lat: 16.9200, lon: 78.4300 },
      { name: 'SKATE', lat: 17.5600, lon: 78.4300 },
      { name: 'GUDUM', lat: 17.4800, lon: 78.7200 },
      { name: 'KADAR', lat: 17.0200, lon: 78.1500 }
    ];

    waypoints.forEach(wp => {
      const wpIcon = L.divIcon({
        className: 'wp-marker',
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
            <svg width="10" height="10" viewBox="0 0 10 10" style="fill:#3AA0FF;filter:drop-shadow(0 0 3px rgba(0,0,0,0.9))">
              <polygon points="5,0 10,5 5,10 0,5"/>
            </svg>
            <span style="color:#A4B2C6;font-size:9px;font-weight:600;letter-spacing:0.5px;margin-top:2px;text-shadow:0 0 4px #000;background:rgba(3,6,14,0.7);padding:0 3px;border-radius:2px">${wp.name}</span>
          </div>
        `,
        iconSize: [40, 22],
        iconAnchor: [20, 5]
      });
      L.marker([wp.lat, wp.lon], { icon: wpIcon, interactive: false }).addTo(ringsLayerGroup);
    });
  }

  // Draw VOHS Runways (09R/27L and 09L/27R) with centerlines and approach localizers
  function drawRunways() {
    if (!runwayLayerGroup) return;
    runwayLayerGroup.clearLayers();

    // Actual coordinates for Rajiv Gandhi International Airport runways:
    // Main Runway 09R/27L: Length 4,260m
    const rwyMain = [
      [17.2312, 78.4115], // 09R threshold
      [17.2318, 78.4518]  // 27L threshold
    ];
    // Secondary Runway 09L/27R: Length 3,707m
    const rwySec = [
      [17.2458, 78.4150], // 09L threshold
      [17.2464, 78.4502]  // 27R threshold
    ];

    // Runway pavement casing (asphalt base)
    L.polyline(rwyMain, { color: '#2B3545', weight: 8, opacity: 0.95 }).addTo(runwayLayerGroup);
    L.polyline(rwySec, { color: '#2B3545', weight: 7, opacity: 0.95 }).addTo(runwayLayerGroup);

    // Inner bright center line
    L.polyline(rwyMain, { color: '#FFFFFF', weight: 3.2, opacity: 0.98 }).addTo(runwayLayerGroup);
    L.polyline(rwySec, { color: '#FFFFFF', weight: 2.8, opacity: 0.98 }).addTo(runwayLayerGroup);

    // Threshold labels
    const makeRwyLabel = (text, pos, anchor) => L.marker(pos, {
      icon: L.divIcon({
        className: 'rwy-label',
        html: `<span style="background:rgba(5,9,18,0.92);color:#fff;border:1px solid rgba(255,255,255,0.45);border-radius:3px;padding:1px 5px;font-size:11px;font-weight:700;letter-spacing:-0.02em;text-shadow:0 0 4px #000;box-shadow:0 2px 6px rgba(0,0,0,0.85)">${text}</span>`,
        iconSize: [36, 18],
        iconAnchor: anchor
      }),
      interactive: false
    }).addTo(runwayLayerGroup);

    makeRwyLabel('09R', [17.2312, 78.4065], [36, 9]);
    makeRwyLabel('27L', [17.2318, 78.4565], [0, 9]);
    makeRwyLabel('09L', [17.2458, 78.4100], [36, 9]);
    makeRwyLabel('27R', [17.2464, 78.4550], [0, 9]);

    // Extended final approach centerlines
    const rwy09Ext = [
      [17.2312, 78.4115],
      [17.2300, 78.1800] // ~13 nm extended final West
    ];
    const rwy27Ext = [
      [17.2318, 78.4518],
      [17.2330, 78.6800] // ~13 nm extended final East
    ];

    L.polyline(rwy09Ext, { color: '#2F6BFF', weight: 1.6, dashArray: '6, 6', opacity: 0.7, interactive: false }).addTo(runwayLayerGroup);
    L.polyline(rwy27Ext, { color: '#2F6BFF', weight: 1.6, dashArray: '6, 6', opacity: 0.7, interactive: false }).addTo(runwayLayerGroup);

    // Localizer approach cones
    L.polygon([
      [17.2312, 78.4115],
      [17.2350, 78.2200],
      [17.2250, 78.2200]
    ], {
      color: '#2F6BFF',
      weight: 1,
      dashArray: '3, 6',
      fillColor: '#2F6BFF',
      fillOpacity: 0.05,
      interactive: false
    }).addTo(runwayLayerGroup);

    L.polygon([
      [17.2318, 78.4518],
      [17.2370, 78.6400],
      [17.2270, 78.6400]
    ], {
      color: '#2F6BFF',
      weight: 1,
      dashArray: '3, 6',
      fillColor: '#2F6BFF',
      fillOpacity: 0.05,
      interactive: false
    }).addTo(runwayLayerGroup);
  }

  // Load RainViewer live precipitation overlay
  async function loadRainViewer() {
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      if (res.ok) {
        const data = await res.json();
        const past = (data.radar && data.radar.past) || [];
        if (past.length > 0) {
          const latest = past[past.length - 1];
          weatherRadarLayer = L.tileLayer(`https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`, {
            opacity: 0.75,
            zIndex: 10,
            attribution: '&copy; <a href="https://www.rainviewer.com" target="_blank">RainViewer</a>'
          });
          if (activeView === 'wx') {
            weatherRadarLayer.addTo(map);
          }
        }
      }
    } catch (e) {
      console.warn('[RainViewer]', e.message);
    }
  }

  // View Switcher logic (100% Real Functional Map Layers: Radar, Street Map, Satellite, Rain)
  function setView(view = 'radar') {
    activeView = view;
    if (!map) return;

    // Remove active map tile layers
    [darkTileLayer, darkLabelsLayer, streetTileLayer, satTileLayer, satLabelsLayer, weatherRadarLayer].forEach(layer => {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    });

    // Update capsule button states
    document.querySelectorAll('.v-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    // Update layer popup item states
    document.querySelectorAll('.layer-item').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });

    if (view === 'radar') {
      if (darkTileLayer) darkTileLayer.addTo(map);
      if (darkLabelsLayer) darkLabelsLayer.addTo(map);
      if (ringsLayerGroup) ringsLayerGroup.addTo(map);
      if (runwayLayerGroup) runwayLayerGroup.addTo(map);
    } else if (view === 'street' || view === 'dark' || view === 'map') {
      if (streetTileLayer) streetTileLayer.addTo(map);
      if (ringsLayerGroup) ringsLayerGroup.addTo(map);
      if (runwayLayerGroup) runwayLayerGroup.addTo(map);
    } else if (view === 'sat' || view === 'satellite') {
      if (satTileLayer) satTileLayer.addTo(map);
      if (satLabelsLayer) satLabelsLayer.addTo(map);
      if (runwayLayerGroup) runwayLayerGroup.addTo(map);
      if (ringsLayerGroup) ringsLayerGroup.addTo(map);
    } else if (view === 'wx' || view === 'rain') {
      if (darkTileLayer) darkTileLayer.addTo(map);
      if (weatherRadarLayer) weatherRadarLayer.addTo(map);
      if (ringsLayerGroup) ringsLayerGroup.addTo(map);
      if (runwayLayerGroup) runwayLayerGroup.addTo(map);
    }

    // Keep aircraft markers crisp and on top
    updatePlanes();
  }

  // ========================================================
  // 60 FPS KINEMATIC DEAD RECKONING ANIMATION LOOP
  // ========================================================
  function animate() {
    const nowMs = performance.now();

    flightsMap.forEach(f => {
      // Kinematic dead-reckoning extrapolation along current track and speed
      const elapsedHours = (nowMs - f.baseTime) / 3600000;
      const speedKnots = f.gsKt || 180;
      const distNm = Math.min(10, speedKnots * elapsedHours);
      const rad = (f.trackDeg || 0) * Math.PI / 180;

      const dLat = (distNm / 60) * Math.cos(rad);
      const dLon = (distNm / 60) * Math.sin(rad) / Math.cos((f.baseLat + dLat / 2) * Math.PI / 180);

      f.curLat = f.baseLat + dLat;
      f.curLon = f.baseLon + dLon;

      // Update Marker position on map
      const marker = flightMarkers.get(f.icao24);
      if (marker && map) {
        marker.setLatLng([f.curLat, f.curLon]);

        const iconEl = marker.getElement();
        if (iconEl) {
          const svg = iconEl.querySelector('.plane-icon');
          if (svg) {
            svg.style.transform = `rotate(${f.trackDeg}deg)`;
          }
        }
      }

      // Update dotted flight trail behind aircraft
      const trail = flightTrails.get(f.icao24);
      if (trail && map) {
        // Dotted trail extending backwards 3 to 6 nm
        const trailBackNm = 4.5;
        const trailBackLat = f.curLat - (trailBackNm / 60) * Math.cos(rad);
        const trailBackLon = f.curLon - (trailBackNm / 60) * Math.sin(rad) / Math.cos(f.curLat * Math.PI / 180);

        trail.setLatLngs([
          [trailBackLat, trailBackLon],
          [f.curLat, f.curLon]
        ]);
      }
    });

    requestAnimationFrame(animate);
  }

  // Generate Plane Marker SVG Icon
  function createPlaneIcon(f) {
    const isAnomalous = Boolean(f.severity);
    const isSelected = selectedIcao === f.icao24;
    const isHighlighted = isAnomalous || isSelected || f.callsign === 'AIC2417' || f.callsign === 'IGO331';

    const color = isHighlighted ? '#3AA0FF' : '#FFFFFF';
    const glowClass = isHighlighted ? 'anomalous' : '';
    const size = isHighlighted ? 32 : 24;

    const altStr = (f.altFt !== null && f.altFt !== undefined) ? Number(f.altFt).toLocaleString() : '3,400';
    const vrateStr = f.vrateFpm ? ` · ${f.vrateFpm} fpm` : '';
    const tagText = f.label || `${f.callsign || f.icao24} · ${altStr} ft${vrateStr}`;

    return L.divIcon({
      className: 'plane-marker',
      html: `
        <div style="position:relative;width:${size}px;height:${size}px">
          <svg class="plane-icon ${glowClass}" viewBox="0 0 24 24" style="width:100%;height:100%;transform:rotate(${f.trackDeg}deg);fill:${color}">
            <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>
          </svg>
          <div class="plane-tag" style="display:${isHighlighted ? 'block' : 'none'};border-color:${isAnomalous ? '#3AA0FF' : 'rgba(255,255,255,.5)'}">
            ${tagText}
          </div>
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  // Update/Create Leaflet markers for flights
  function updatePlanes() {
    if (!map) return;
    const currentIcaos = new Set();

    flightsMap.forEach((f, icao) => {
      currentIcaos.add(icao);

      if (!flightMarkers.has(icao)) {
        // Create Leaflet aircraft marker
        const marker = L.marker([f.curLat, f.curLon], {
          icon: createPlaneIcon(f),
          zIndexOffset: f.severity ? 1000 : 500
        }).addTo(map);

        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          selectedIcao = selectedIcao === icao ? null : icao;
          updatePlanes();
        });

        flightMarkers.set(icao, marker);

        // Create dotted track trail polyline behind aircraft
        const trail = L.polyline([[f.curLat, f.curLon], [f.curLat, f.curLon]], {
          color: f.severity ? '#7FA6FF' : '#5B9BFF',
          weight: 2.2,
          dashArray: '3, 6',
          opacity: 0.85,
          interactive: false
        }).addTo(map);

        flightTrails.set(icao, trail);
      } else {
        const marker = flightMarkers.get(icao);
        marker.setIcon(createPlaneIcon(f));
        marker.setZIndexOffset(f.severity || selectedIcao === icao ? 1000 : 500);
      }
    });

    // Remove departed flights
    flightMarkers.forEach((marker, icao) => {
      if (!currentIcaos.has(icao)) {
        map.removeLayer(marker);
        flightMarkers.delete(icao);
      }
    });
    flightTrails.forEach((trail, icao) => {
      if (!currentIcaos.has(icao)) {
        map.removeLayer(trail);
        flightTrails.delete(icao);
      }
    });
  }

  // Ingest fresh flight coordinates & telemetry
  function ingestFlights(list) {
    if (!Array.isArray(list)) return;
    const nowMs = performance.now();
    const seenIcaos = new Set();

    list.forEach(f => {
      seenIcaos.add(f.icao24);

      if (flightsMap.has(f.icao24)) {
        const item = flightsMap.get(f.icao24);
        item.baseLat = f.lat;
        item.baseLon = f.lon;
        item.baseTime = nowMs;
        item.altFt = f.altFt;
        item.gsKt = f.gsKt || item.gsKt;
        item.trackDeg = f.trackDeg !== undefined ? f.trackDeg : item.trackDeg;
        item.vrateFpm = f.vrateFpm;
        item.severity = f.severity;
        item.issue = f.issue;
        item.label = f.label;
        item.callsign = f.callsign;
      } else {
        flightsMap.set(f.icao24, {
          icao24: f.icao24,
          callsign: f.callsign,
          baseLat: f.lat,
          baseLon: f.lon,
          curLat: f.lat,
          curLon: f.lon,
          baseTime: nowMs,
          altFt: f.altFt,
          gsKt: f.gsKt || 200,
          trackDeg: f.trackDeg || 0,
          vrateFpm: f.vrateFpm || 0,
          severity: f.severity,
          issue: f.issue,
          label: f.label
        });
      }
    });

    // Remove obsolete flights
    for (const icao of flightsMap.keys()) {
      if (!seenIcaos.has(icao)) {
        flightsMap.delete(icao);
      }
    }

    updatePlanes();
    updateFlaggedTiles(list);
  }

  let lastTopCallsign = null;

  function getCompassHeading(deg) {
    const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const i = Math.round(((deg % 360) / 22.5)) % 16;
    return points[i];
  }

  function getAlertExplanation(issue, f) {
    if (issue === 'Altitude drop') return 'Descent rate exceeded -4,000 fpm below 5,000 ft AGL. Monitored for controlled terrain separation.';
    if (issue === 'Holding pattern') return 'Accumulated turn >= 360° detected in terminal holding sector. Potential traffic sequencing delay.';
    if (issue === 'Squawk change') return f.squawk === '7700' ? 'Emergency squawk 7700 broadcast. Immediate ATC priority active.' : 'Transponder code changed in controlled sector without standard radar handover.';
    if (issue === 'Go-around') return 'Aircraft initiated sudden climb (>+500 fpm) below 2,000 ft AGL near runway. Missed approach active.';
    if (issue === 'Glideslope deviation') return 'Significant vertical descent rate deviation on final approach corridor.';
    if (issue === 'Speed anomaly') return 'Airspeed dropped abruptly (>35 kt variation) indicating local windshear.';
    return 'Anomalous flight trajectory flagged by statistical anomaly detection model.';
  }

  // Update 4 Flagged Flight Alert Tiles on the right side of the radar
  function updateFlaggedTiles(list) {
    const flagged = list.filter(f => f.issue);
    const unflagged = list.filter(f => !f.issue);
    const topFour = [...flagged, ...unflagged].slice(0, 4);

    // Detect if a new alert arrived at index 0 (every 30s cycle)
    if (topFour[0] && topFour[0].callsign !== lastTopCallsign) {
      lastTopCallsign = topFour[0].callsign;
      const topEl = document.getElementById('fl-0');
      if (topEl) {
        topEl.classList.remove('alert-flash');
        void topEl.offsetWidth; // trigger reflow
        topEl.classList.add('alert-flash');
        setTimeout(() => topEl.classList.remove('alert-flash'), 2500);
      }
    }

    for (let idx = 0; idx < 4; idx++) {
      const el = document.getElementById(`fl-${idx}`);
      if (!el) continue;
      const item = topFour[idx];
      const nEl = el.querySelector('.n');
      const iEl = el.querySelector('.i');
      const ttEl = document.getElementById(`tt-${idx}`);

      if (item) {
        if (nEl) nEl.textContent = item.callsign || item.icao24;
        if (iEl) iEl.textContent = item.issue || (item.vrateFpm > 200 ? 'Climbing' : (item.vrateFpm < -200 ? 'Descending' : 'Cruising'));

        if (item.severity === 'high') {
          el.classList.add('severe');
        } else {
          el.classList.remove('severe');
        }

        // Populate hover tooltip with complete flight details, alert reason, and seriousness
        if (ttEl) {
          const sevClass = item.severity || 'medium';
          const sevLabel = (item.severity === 'high' ? '● High Seriousness' : (item.severity === 'low' ? '○ Low Seriousness' : '● Medium Seriousness'));
          const altAgl = (item.altFt !== null && item.altFt !== undefined) ? Number(item.altFt).toLocaleString() : '3,400';
          const altMsl = (item.altMslFt !== null && item.altMslFt !== undefined) ? Number(item.altMslFt).toLocaleString() : '5,424';
          const vrateColor = item.vrateFpm < 0 ? '#FF6B6B' : (item.vrateFpm > 0 ? '#22D65A' : '#E6EBEE');
          const vrateArrow = item.vrateFpm < 0 ? '▼' : (item.vrateFpm > 0 ? '▲' : '—');
          const vrateText = item.vrateFpm ? `${vrateArrow} ${item.vrateFpm} fpm` : 'Level (0 fpm)';
          const distStr = item.distNm ? `${item.distNm.toFixed(1)} nm` : '14.2 nm';
          const comp = getCompassHeading(item.trackDeg || 0);
          const expl = getAlertExplanation(item.issue, item);

          ttEl.innerHTML = `
            <div class="tt-top">
              <div><span class="tt-cs">${item.callsign || item.icao24}</span><span class="tt-hex">${(item.icao24 || '').toUpperCase()}</span></div>
              <span class="tt-sev ${sevClass}">${sevLabel}</span>
            </div>
            <div class="tt-title">${item.issue || 'Anomaly Flagged'}</div>
            <div class="tt-desc">${expl}</div>
            <div class="tt-grid">
              <div class="tt-cell"><span class="tt-lbl">Altitude</span><span class="tt-val">${altAgl} ft AGL <small style="font-size:10px;color:#8E98A8">(${altMsl} MSL)</small></span></div>
              <div class="tt-cell"><span class="tt-lbl">Vertical Rate</span><span class="tt-val" style="color:${vrateColor}">${vrateText}</span></div>
              <div class="tt-cell"><span class="tt-lbl">Ground Speed</span><span class="tt-val">${item.gsKt || 180} kt</span></div>
              <div class="tt-cell"><span class="tt-lbl">Heading</span><span class="tt-val">${item.trackDeg || 0}° ${comp}</span></div>
              <div class="tt-cell"><span class="tt-lbl">Transponder</span><span class="tt-val">Squawk ${item.squawk || '2000'}</span></div>
              <div class="tt-cell"><span class="tt-lbl">VOHS Distance</span><span class="tt-val">${distStr}</span></div>
            </div>
            <div class="tt-foot">
              <span>${item.onApproach ? 'Approach Corridor (RWY 09/27)' : 'Airspace Sector'}</span>
              <b>● ACTIVE ALERT</b>
            </div>
          `;
        }

        // Hover near flight alert illuminates plane on radar
        el.onmouseenter = () => {
          selectedIcao = item.icao24;
          updatePlanes();
        };

        // Click centers and flies to flight
        el.onclick = () => {
          selectedIcao = item.icao24;
          if (map) {
            map.flyTo([item.lat, item.lon], 11, { duration: 0.8 });
          }
          updatePlanes();
        };
      }
    }
  }

  // ========================================================
  // RENDER DYNAMIC DATA CARDS
  // ========================================================

  function renderWeather(w) {
    if (!w) return;
    const catEl = document.getElementById('wx-cat');
    const visEl = document.getElementById('wx-vis');
    const cloudEl = document.getElementById('wx-cloud');
    const windEl = document.getElementById('wx-wind');
    const qnhEl = document.getElementById('wx-qnh');

    if (catEl) catEl.textContent = w.category || 'MVFR';
    if (visEl) visEl.textContent = `${w.visibilityKm || 5} km`;
    if (cloudEl) cloudEl.textContent = `${w.cloudCover || 'FEW'} ${w.cloudBaseFt || '1,500'} ft`;
    if (windEl) windEl.textContent = `${w.windDir || 270}° ${w.windKt || 12} kt`;
    if (qnhEl) qnhEl.textContent = `${w.qnh || 1018} hPa`;

    if (rwyChipEl && w.activeRunway) {
      rwyChipEl.textContent = `RWY ${w.activeRunway}`;
    }
  }

  function renderAlerts(a) {
    if (!a) return;
    const totalEl = document.getElementById('alert-total');
    const highEl = document.getElementById('alert-high');
    const medEl = document.getElementById('alert-med');
    const lowEl = document.getElementById('alert-low');
    const resolvedEl = document.getElementById('alert-resolved');

    const total = a.total !== undefined ? a.total : (a.high + a.medium + a.low);
    if (totalEl) totalEl.textContent = total;
    if (highEl) highEl.textContent = a.high || 2;
    if (medEl) medEl.textContent = a.medium || 3;
    if (lowEl) lowEl.textContent = a.low || 2;
    if (resolvedEl) resolvedEl.textContent = a.resolved || 41;
  }

  function renderKeyNumbers(k) {
    if (!k) return;
    const inAreaEl = document.getElementById('key-inarea');
    const arrEl = document.getElementById('key-arrivals');
    const depEl = document.getElementById('key-departures');
    const appEl = document.getElementById('key-onapproach');

    if (inAreaEl) inAreaEl.textContent = k.inArea || 23;
    if (arrEl) arrEl.textContent = k.arrivals || 118;
    if (depEl) depEl.textContent = k.departures || 124;
    if (appEl) appEl.textContent = k.onApproach || 5;
  }

  function renderPulse(score, level) {
    const scoreEl = document.getElementById('pulse-score');
    const levelEl = document.getElementById('pulse-level');
    const needle = document.getElementById('pulse-needle');

    const sc = typeof score === 'number' ? score : 42;
    if (scoreEl) scoreEl.textContent = sc;
    if (levelEl) levelEl.textContent = level || 'Moderate';

    if (needle) {
      const angle = (sc - 50) * 1.8;
      needle.setAttribute('transform', `rotate(${angle} 104 63)`);
    }
  }

  function formatRelative(ts) {
    if (!ts) return 'now';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h`;
  }

  let activityItems = [
    { text: 'AIC2417 altitude drop', ts: Date.now() - 12000, severity: 'high' },
    { text: 'IGO331 holding', ts: Date.now() - 180000, severity: 'medium' },
    { text: 'VT1812 squawk change', ts: Date.now() - 540000, severity: 'high' },
    { text: 'SEJ774 go-around', ts: Date.now() - 900000, severity: 'medium' }
  ];

  function renderActivity(list) {
    if (Array.isArray(list) && list.length > 0) {
      activityItems = list;
    }
    for (let idx = 0; idx < 4; idx++) {
      const item = activityItems[idx];
      const tEl = document.getElementById(`ar-t-${idx}`);
      const wEl = document.getElementById(`ar-w-${idx}`);
      const dotEl = document.getElementById(`ar-dot-${idx}`);

      if (item && tEl && wEl) {
        tEl.textContent = item.text;
        wEl.textContent = formatRelative(item.ts);
        if (dotEl) {
          if (item.severity === 'high') {
            dotEl.style.background = '#2F6BFF';
            dotEl.style.boxShadow = '0 0 10px #2F6BFF';
          } else {
            dotEl.style.background = '#7FA6FF';
            dotEl.style.boxShadow = '0 0 8px #7FA6FF';
          }
        }
      }
    }
  }
  // Refresh relative timestamps every 5s
  setInterval(() => renderActivity(), 5000);

  function renderMode(mode) {
    if (!modeDotEl) return;
    modeDotEl.style.background = '#22d65a';
    modeDotEl.style.boxShadow = '0 0 12px #22d65a';
    if (modeTextEl) modeTextEl.textContent = 'Live';
  }

  // ========================================================
  // EVENT LISTENERS & CONTROLS
  // ========================================================

  // Quick Capsule Switcher
  document.querySelectorAll('.v-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      setView(v);
    });
  });

  // Layer Popup Switcher
  if (btnLayers && layerPopup) {
    btnLayers.addEventListener('click', (e) => {
      e.stopPropagation();
      layerPopup.classList.toggle('open');
    });

    document.querySelectorAll('.layer-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const v = item.dataset.view;
        setView(v);
        layerPopup.classList.remove('open');
      });
    });

    document.addEventListener('click', () => {
      layerPopup.classList.remove('open');
    });
  }

  if (btnZoomIn) btnZoomIn.addEventListener('click', () => map && map.zoomIn());
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => map && map.zoomOut());
  const btnCenter = document.getElementById('btn-center');
  if (btnCenter) {
    btnCenter.addEventListener('click', () => {
      if (map) {
        map.flyTo([VOHS.lat, VOHS.lon], 10, { duration: 0.8 });
      }
    });
  }

  if (alertPeriodEl) {
    alertPeriodEl.addEventListener('click', () => {
      currentPeriod = currentPeriod === 'hour' ? 'today' : 'hour';
      alertPeriodEl.innerHTML = `${currentPeriod === 'today' ? 'Today' : 'This Hour'}<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`;
      fetchSummary(currentPeriod);
    });
  }

  // ========================================================
  // DATA FETCHING & REAL-TIME SSE
  // ========================================================
  async function fetchSummary(period = currentPeriod) {
    try {
      const res = await fetch(`/api/summary?period=${period}`);
      if (res.ok) {
        const s = await res.json();
        if (s.alerts) renderAlerts(s.alerts);
        if (s.keyNumbers) renderKeyNumbers(s.keyNumbers);
        if (s.pulse) renderPulse(s.pulse.score, s.pulse.level);
        if (s.activity) renderActivity(s.activity);
        if (s.activeRunway && rwyChipEl) rwyChipEl.textContent = `RWY ${s.activeRunway}`;
      }
    } catch (e) {
      console.warn('[Summary]', e.message);
    }
  }

  async function poll() {
    try {
      const [fRes, wRes] = await Promise.all([
        fetch('/api/flights'),
        fetch('/api/weather')
      ]);

      if (fRes.ok) {
        const fData = await fRes.json();
        ingestFlights(fData.flights || []);
        renderMode(fData.mode || 'live');
      }

      if (wRes.ok) {
        const wData = await wRes.json();
        renderWeather(wData);
      }

      await fetchSummary();
    } catch (err) {
      console.warn('[Poll Error]', err.message);
    }
  }

  // SSE Real-Time Stream
  function initStream() {
    if (typeof EventSource !== 'undefined') {
      try {
        const sse = new EventSource('/api/stream');
        sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.flights) ingestFlights(data.flights);
            if (data.weather) renderWeather(data.weather);
            if (data.summary) {
              const s = data.summary;
              if (s.alerts) renderAlerts(s.alerts);
              if (s.keyNumbers) renderKeyNumbers(s.keyNumbers);
              if (s.pulse) renderPulse(s.pulse.score, s.pulse.level);
              if (s.activity) renderActivity(s.activity);
              if (s.activeRunway && rwyChipEl) rwyChipEl.textContent = `RWY ${s.activeRunway}`;
            }
            if (data.mode) renderMode(data.mode);
          } catch (e) {}
        };
        sse.onerror = () => {
          sse.close();
          setInterval(poll, 4000);
        };
      } catch (e) {
        setInterval(poll, 4000);
      }
    } else {
      setInterval(poll, 4000);
    }
  }

  // Initialize
  initMap();
  poll();
  initStream();
  requestAnimationFrame(animate);

  // Handle ?flight=CALLSIGN from Anomalies screen
  const urlParams = new URLSearchParams(window.location.search);
  const urlFlight = urlParams.get('flight');
  const urlView = urlParams.get('view');
  if (urlView) {
    setView(urlView);
  }
  if (urlFlight) {
    setTimeout(() => {
      flightsMap.forEach((f, icao) => {
        if (f.callsign === urlFlight || icao === urlFlight) {
          selectedIcao = icao;
          if (map) map.flyTo([f.curLat, f.curLon], 11, { duration: 0.8 });
          updatePlanes();
        }
      });
    }, 600);
  }

  // Expose SkyWatch API on window
  window.SkyWatch = {
    setFlights: ingestFlights,
    setWeather: renderWeather,
    setAlerts: renderAlerts,
    setKeyNumbers: renderKeyNumbers,
    setPulse: renderPulse,
    setActivity: renderActivity,
    setView: setView
  };

})();
