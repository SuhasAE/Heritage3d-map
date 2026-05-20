// Keys are loaded from config.js (not committed to git)
// See config.example.js for the required variables
Cesium.Ion.defaultAccessToken = window.APP_CONFIG.CESIUM_TOKEN;
const ORS_KEY    = window.APP_CONFIG.ORS_KEY;
const GROQ_KEY   = window.APP_CONFIG.GROQ_KEY;
const GROQ_MODEL = window.APP_CONFIG.GROQ_MODEL;

const CATEGORY_COLORS = {
  monument: Cesium.Color.fromCssColorString('#EF9F27'),
  temple:   Cesium.Color.fromCssColorString('#5DCAA5'),
  cave:     Cesium.Color.fromCssColorString('#85B7EB'),
};

let viewer       = null;
let allEntities  = [];
let selectedSite = null;
let navInterval  = null;
let navEntity    = null;
let routeEntity  = null;
let userPosition = null;
let chatHistory  = [];
let isNavigating = false;

navigator.geolocation?.getCurrentPosition(
  pos => { userPosition = [pos.coords.longitude, pos.coords.latitude]; },
  () => {}
);

// ── Responsive helpers ───────────────────────────────
function isMobile()  { return window.innerWidth < 640; }
function isTablet()  { return window.innerWidth >= 640 && window.innerWidth < 1024; }

function applyResponsiveLayout() {
  const mobile  = isMobile();
  const tablet  = isTablet();
  const sidebar = document.getElementById('sidebar');
  const popup   = document.getElementById('popup');
  const chatP   = document.getElementById('chat-panel');
  const hud     = document.getElementById('nav-hud');

  if (mobile) {
    // Sidebar: slide-up drawer from bottom
    sidebar.style.cssText = `
      width:100%; height:50vh; top:auto; bottom:-50vh; left:0; right:0;
      transition:bottom 0.3s ease; border-right:none;
      border-top:1px solid rgba(255,255,255,0.08);
      border-radius:16px 16px 0 0;`;

    // Popup: full-width bottom sheet (preserve display value)
    Object.assign(popup.style, {left:'8px',right:'8px',top:'auto',bottom:'12px',width:'auto',maxHeight:'55vh',overflowY:'auto'});

    // Chat: full-width bottom sheet — above popup area
    Object.assign(chatP.style, {left:'8px',right:'8px',bottom:'12px',width:'auto',height:'320px'});

    // HUD: full width
    Object.assign(hud.style, {left:'8px',right:'8px',bottom:'12px',transform:'none',minWidth:'auto',width:'auto'});

    // Add FAB to toggle sidebar if not present
    if (!document.getElementById('sidebar-fab')) {
      const fab = document.createElement('button');
      fab.id = 'sidebar-fab';
      fab.innerHTML = '☰';
      fab.onclick = toggleSidebar;
      document.body.appendChild(fab);
    }
    // Start closed on mobile
    document.getElementById('sidebar').style.bottom = '-50vh';

  } else if (tablet) {
    sidebar.style.cssText = `
      width:180px; height:calc(100vh - 50px); top:50px; bottom:'';
      left:0; right:''; transition:''; border-right:1px solid rgba(255,255,255,0.06);
      border-top:none; border-radius:0;`;
    Object.assign(popup.style, {left:'',right:'12px',top:'62px',bottom:'',width:'260px',maxHeight:''});
    // Chat positioned below popup to avoid overlap
    Object.assign(chatP.style, {left:'',right:'12px',bottom:'16px',width:'260px',height:'320px'});
    Object.assign(hud.style,  {left:'50%',right:'',bottom:'24px',transform:'translateX(-50%)',minWidth:'360px',width:''});
    const fab = document.getElementById('sidebar-fab');
    if (fab) fab.remove();

  } else {
    // Desktop
    sidebar.style.cssText = `
      width:220px; height:calc(100vh - 50px); top:50px; bottom:'';
      left:0; right:''; transition:''; border-right:1px solid rgba(255,255,255,0.06);
      border-top:none; border-radius:0;`;
    Object.assign(popup.style, {left:'',right:'16px',top:'70px',bottom:'',width:'280px',maxHeight:''});
    // Chat starts below popup, no overlap — user can drag both
    Object.assign(chatP.style, {left:'',right:'16px',bottom:'20px',width:'300px',height:'380px'});
    Object.assign(hud.style,  {left:'50%',right:'',bottom:'32px',transform:'translateX(-50%)',minWidth:'420px',width:''});
    const fab = document.getElementById('sidebar-fab');
    if (fab) fab.remove();
  }
}

let _sidebarOpen = false;
function toggleSidebar() {
  _sidebarOpen = !_sidebarOpen;
  document.getElementById('sidebar').style.bottom = _sidebarOpen ? '0' : '-50vh';
}

// ── Viewer ────────────────────────────────────────────
async function initViewer() {  // returns promise implicitly
  viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayerPicker:      false,
    navigationHelpButton: false,
    animation:            false,
    timeline:             false,
    fullscreenButton:     false,
    homeButton:           false,
    sceneModePicker:      false,
    geocoder:             false,
    infoBox:              false,
    selectionIndicator:   false,
    shouldAnimate:        true,
  });

  try {
    viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
      requestWaterMask: true, requestVertexNormals: true,
    });
  } catch(e) { console.warn('Terrain:', e); }

  try {
    const img = await Cesium.IonImageryProvider.fromAssetId(2);
    viewer.imageryLayers.addImageryProvider(img);
  } catch(e) { console.warn('Imagery:', e); }

  // Cesium Ion Photorealistic 3D Tiles — textured, photogrammetry-based buildings
  // Asset 2275207 = Cesium OSM Buildings with photorealistic textures
  // Falls back to plain OSM if token doesn't have access
  let photorealisticTiles = null;
  try {
    photorealisticTiles = await Cesium.Cesium3DTileset.fromIonAssetId(2275207);
    viewer.scene.primitives.add(photorealisticTiles);
    console.log('Photorealistic 3D tiles loaded (2275207)');
  } catch(e) {
    console.warn('Asset 2275207 unavailable, trying 96188:', e.message);
    try {
      photorealisticTiles = await Cesium.Cesium3DTileset.fromIonAssetId(96188);
      viewer.scene.primitives.add(photorealisticTiles);
      console.log('Photorealistic 3D tiles loaded (96188)');
    } catch(e2) {
      console.warn('Photorealistic tiles unavailable, falling back to OSM:', e2.message);
      try {
        const osm = await Cesium.createOsmBuildingsAsync();
        viewer.scene.primitives.add(osm);
      } catch(e3) { console.warn('OSM buildings also unavailable:', e3.message); }
    }
  }

  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.globe.enableLighting = false; // disable to prevent dark globe
  viewer.scene.globe.baseColor = Cesium.Color.BLACK;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 2500000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    duration: 3,
  });

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(click => {
    const picked = viewer.scene.pick(click.position);
    if (Cesium.defined(picked) && picked.id?._site) showPopup(picked.id._site);
    else closePopup();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  placeMarkers();
  buildSidebar();
  applyResponsiveLayout();
  window.addEventListener('resize', applyResponsiveLayout);
}

// ── Markers ───────────────────────────────────────────
function placeMarkers() {
  HERITAGE_SITES.forEach(site => {
    const [lng, lat] = site.coordinates;
    const color = CATEGORY_COLORS[site.category] || CATEGORY_COLORS.monument;
    const entity = viewer.entities.add({
      id:       site.id,
      position: Cesium.Cartesian3.fromDegrees(lng, lat, 50),
      billboard: {
        image:           createMarkerCanvas(color, site.category),
        verticalOrigin:  Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 1,
      },
      label: {
        text:            site.name,
        font:            '12px Segoe UI',
        fillColor:       Cesium.Color.WHITE,
        outlineColor:    Cesium.Color.BLACK,
        outlineWidth:    2,
        style:           Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin:  Cesium.VerticalOrigin.BOTTOM,
        pixelOffset:     new Cesium.Cartesian2(0, -42),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        translucencyByDistance: new Cesium.NearFarScalar(300000, 1.0, 2000000, 0.0),
      },
      _site: site,
    });
    allEntities.push(entity);
  });
}

function createMarkerCanvas(color, category) {
  const canvas = document.createElement('canvas');
  canvas.width = 36; canvas.height = 46;
  const ctx = canvas.getContext('2d');
  const r = Math.round(color.red*255), g = Math.round(color.green*255), b = Math.round(color.blue*255);
  const hex = `rgb(${r},${g},${b})`;
  ctx.beginPath(); ctx.arc(18, 18, 14, 0, Math.PI*2);
  ctx.fillStyle = hex; ctx.fill();
  ctx.strokeStyle = 'white'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(11,28); ctx.lineTo(18,46); ctx.lineTo(25,28);
  ctx.fillStyle = hex; ctx.fill();
  const icons = { monument:'🏛', temple:'🛕', cave:'🪨' };
  ctx.font = '14px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(icons[category] || '📍', 18, 18);
  return canvas.toDataURL();
}

// ── Popup ─────────────────────────────────────────────
function showPopup(site) {
  selectedSite = site;
  document.getElementById('popup-category').textContent = site.category.toUpperCase();
  document.getElementById('popup-name').textContent     = site.name;
  document.getElementById('popup-meta').textContent     = `${site.dynasty} · ${site.built}`;
  document.getElementById('popup-location').textContent = `📍 ${site.city}, ${site.state}`;
  document.getElementById('popup-desc').textContent     = site.description;
  document.getElementById('popup').style.display        = 'block';
  document.getElementById('btn-navigate').onclick = () => startNavigation(site);
  document.getElementById('btn-tour').onclick     = () => window.open(`https://sanskriti-sphere-2.onrender.com/?tour=${site.virtualTourId}`, '_blank');
  document.getElementById('btn-ask').onclick      = () => { toggleChat(); askAbout(site); };

  const [lng, lat] = site.coordinates;

  // Stage 1: pull back to 50 km — see the city/region context
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, 50000),
    orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-50), roll: 0 },
    duration: 1.8,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    complete: () => {
      // Stage 2: use lookAt so the monument is always the exact target centre.
      // Camera sits 1 km above and slightly south, looking north at the monument.
      const target = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1000),
        orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-55), roll: 0 },
        duration: 2.2,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: () => {
          // Lock the camera target precisely on the monument
          viewer.camera.lookAt(
            target,
            new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(0),    // heading: north
              Cesium.Math.toRadians(-45),  // pitch: angled down
              900                          // range: 900 m from monument
            )
          );
          // Unlock so user can freely orbit afterwards
          viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        },
      });
    },
  });
}

function closePopup() {
  document.getElementById('popup').style.display = 'none';
  selectedSite = null;
}

// ── Sidebar ───────────────────────────────────────────
function buildSidebar() {
  const list = document.getElementById('sidebar-list');
  list.innerHTML = '';
  HERITAGE_SITES.forEach(site => {
    const color = CATEGORY_COLORS[site.category];
    const r = Math.round(color.red*255), g = Math.round(color.green*255), b = Math.round(color.blue*255);
    const div = document.createElement('div');
    div.className = 'sidebar-item';
    div.dataset.category = site.category;
    div.innerHTML = `
      <span class="sidebar-dot" style="background:rgb(${r},${g},${b})"></span>
      <div class="sidebar-info">
        <div class="sidebar-name">${site.name}</div>
        <div class="sidebar-city">${site.city}</div>
      </div>`;
    div.onclick = () => showPopup(site);
    list.appendChild(div);
  });
}

// ── Filters ───────────────────────────────────────────
function setFilter(category) {
  document.querySelectorAll('.filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === category));
  allEntities.forEach(e => { e.show = category === 'all' || e._site.category === category; });
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.style.display = (category === 'all' || item.dataset.category === category) ? 'flex' : 'none';
  });
}

// ── Geolocation ───────────────────────────────────────
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function findNearest() {
  const doFind = (lng, lat) => {
    const sorted = [...HERITAGE_SITES]
      .map(s => ({ ...s, dist: getDistanceKm(lat, lng, s.coordinates[1], s.coordinates[0]) }))
      .sort((a,b) => a.dist-b.dist).slice(0,3);
    document.getElementById('nearby-list').innerHTML = sorted.map(s =>
      `<div class="nearby-item" onclick="showPopup(HERITAGE_SITES.find(x=>x.id==='${s.id}'))">
        <span class="nearby-name">${s.name}</span>
        <span class="nearby-dist">${Math.round(s.dist)} km</span>
      </div>`).join('');
    document.getElementById('nearby-panel').style.display = 'block';
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, 800000),
      orientation: { pitch: Cesium.Math.toRadians(-45) }, duration: 2,
    });
  };
  if (userPosition) doFind(...userPosition);
  else navigator.geolocation.getCurrentPosition(
    pos => { userPosition=[pos.coords.longitude,pos.coords.latitude]; doFind(...userPosition); },
    () => alert('Could not get your location.')
  );
}

function closeNearby() { document.getElementById('nearby-panel').style.display = 'none'; }

// ── Navigation ────────────────────────────────────────
async function startNavigation(site) {
  closePopup();

  let fromCoords = userPosition;
  if (!fromCoords) {
    try {
      const pos = await new Promise((res,rej) => navigator.geolocation.getCurrentPosition(res,rej));
      fromCoords = [pos.coords.longitude, pos.coords.latitude];
      userPosition = fromCoords;
    } catch { alert('Location access required for navigation.'); return; }
  }

  // Show loading state
  document.getElementById('nav-text').textContent = 'Fetching route...';
  document.getElementById('nav-hud').style.display = 'flex';

  let data;
  try {
    const res = await fetch(
      `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_KEY}` +
      `&start=${fromCoords[0]},${fromCoords[1]}&end=${site.coordinates[0]},${site.coordinates[1]}`
    );
    data = await res.json();
  } catch(e) {
    alert('Failed to fetch route. Check your internet connection.');
    document.getElementById('nav-hud').style.display = 'none';
    return;
  }

  if (!data.features?.length) {
    alert('No route found between your location and this monument.');
    document.getElementById('nav-hud').style.display = 'none';
    return;
  }

  const feature   = data.features[0];
  const coords    = feature.geometry.coordinates; // [lng, lat] each
  const steps     = feature.properties.segments[0].steps;
  const totalDist = (feature.properties.summary.distance / 1000).toFixed(1);
  const totalTime = Math.round(feature.properties.summary.duration / 60);

  // Draw the route line (animated)
  drawRoute(coords);

  // Place compass marker at start
  if (navEntity) viewer.entities.remove(navEntity);
  navEntity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(fromCoords[0], fromCoords[1], 50),
    billboard: {
      image:           createUserMarkerCanvas(),
      verticalOrigin:  Cesium.VerticalOrigin.BOTTOM,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scale: 1.3,
    },
  });

  // Update HUD
  document.getElementById('nav-eta').textContent = `${totalDist} km · ~${totalTime} min`;
  showNavStep(steps, 0);

  // ── Smooth overhead camera — follows the route, never underground ──
  // First: zoom out to show the full route
  const midLng = (fromCoords[0] + site.coordinates[0]) / 2;
  const midLat = (fromCoords[1] + site.coordinates[1]) / 2;
  const routeDistKm = getDistanceKm(fromCoords[1], fromCoords[0], site.coordinates[1], site.coordinates[0]);
  const altitude = Math.max(50000, routeDistKm * 800); // scale altitude to route length

  await new Promise(resolve => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(midLng, midLat, altitude),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-55), roll: 0 },
      duration: 2.5,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: resolve,
    });
  });

  // Then simulate movement
  isNavigating = true;
  simulateNavigation(coords, steps, fromCoords);
}

function drawRoute(coords) {
  if (routeEntity) viewer.entities.remove(routeEntity);
  const positions = [];
  let i = 0;

  routeEntity = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => positions.length > 1 ? [...positions] : [], false),
      width: 7,
      material: new Cesium.PolylineOutlineMaterialProperty({
        color:        Cesium.Color.fromCssColorString('#FF3333'),
        outlineWidth: 3,
        outlineColor: Cesium.Color.fromCssColorString('#8B0000'),
      }),
      clampToGround: true,
    },
  });

  // Animate route drawing — reveal points every 15ms
  const interval = setInterval(() => {
    if (i < coords.length) {
      positions.push(Cesium.Cartesian3.fromDegrees(coords[i][0], coords[i][1]));
      i++;
    } else clearInterval(interval);
  }, 15);
}

function showNavStep(steps, index) {
  if (index >= steps.length) return;
  const step  = steps[index];
  const dist  = step.distance > 1000
    ? `${(step.distance/1000).toFixed(1)} km`
    : `${Math.round(step.distance)} m`;
  const arrows = { 0:'⬆️', 1:'↗️', 2:'➡️', 3:'↘️', 4:'⬇️', 5:'↙️', 6:'⬅️', 7:'↖️', 10:'🔄', 11:'🏁' };
  document.getElementById('nav-icon').textContent = arrows[step.type] || '⬆️';
  document.getElementById('nav-text').textContent = step.instruction;
  document.getElementById('nav-dist').textContent = dist;
}

function simulateNavigation(coords, steps, fromCoords) {
  // Real GPS tracking — watch user's actual position and update HUD + camera
  const stepTriggers = steps.map(s => s.way_points[0]);
  let stepIndex = 0;
  let nearestIdx = 0;

  navInterval = navigator.geolocation.watchPosition(
    pos => {
      if (!isNavigating) { navigator.geolocation.clearWatch(navInterval); return; }

      const lng = pos.coords.longitude;
      const lat = pos.coords.latitude;

      // Move marker to real user position
      if (navEntity) navEntity.position = Cesium.Cartesian3.fromDegrees(lng, lat, 50);

      // Find nearest point on route ahead of current position
      let minDist = Infinity;
      const searchEnd = Math.min(nearestIdx + 80, coords.length);
      for (let i = nearestIdx; i < searchEnd; i++) {
        const d = getDistanceKm(lat, lng, coords[i][1], coords[i][0]);
        if (d < minDist) { minDist = d; nearestIdx = i; }
      }

      // Advance turn instructions
      while (stepIndex < steps.length - 1 && nearestIdx >= stepTriggers[stepIndex + 1]) {
        stepIndex++;
        showNavStep(steps, stepIndex);
      }

      // Remaining distance to destination
      let remaining = 0;
      for (let i = nearestIdx; i < coords.length - 1; i++) {
        remaining += getDistanceKm(coords[i][1], coords[i][0], coords[i+1][1], coords[i+1][0]);
      }
      document.getElementById('nav-dist').textContent =
        remaining > 1 ? `${remaining.toFixed(1)} km` : `${Math.round(remaining * 1000)} m`;

      // Arrived check (within 50 m of destination)
      const dest = coords[coords.length - 1];
      const destDist = getDistanceKm(lat, lng, dest[1], dest[0]);
      if (destDist < 0.05) {
        navigator.geolocation.clearWatch(navInterval);
        isNavigating = false;
        document.getElementById('nav-icon').textContent = '🏁';
        document.getElementById('nav-text').textContent = 'You have arrived!';
        document.getElementById('nav-dist').textContent = '0 m';
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(dest[0], dest[1], 3000),
          orientation: { pitch: Cesium.Math.toRadians(-40) },
          duration: 3, easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        });
        return;
      }

      // Camera follows user — look ahead along route for heading
      const ahead = Math.min(nearestIdx + 10, coords.length - 1);
      const heading = Math.atan2(coords[ahead][0] - lng, coords[ahead][1] - lat);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1500),
        orientation: { heading, pitch: Cesium.Math.toRadians(-30), roll: 0 },
        duration: 1.5, easingFunction: Cesium.EasingFunction.LINEAR_NONE,
      });
    },
    err => {
      console.warn('GPS error during navigation:', err);
      document.getElementById('nav-text').textContent = 'GPS signal lost — move to open area';
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

// ── Recenter to user GPS ─────────────────────────────
function recenterToUser() {
  const btn = document.getElementById('recenter-btn');
  if (btn) { btn.textContent = '📍'; btn.disabled = true; }

  const doFly = (lng, lat) => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1500),
      orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-45), roll: 0 },
      duration: 2,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: () => { if (btn) { btn.textContent = '🎯'; btn.disabled = false; } },
    });
  };

  if (userPosition) {
    doFly(...userPosition);
  } else {
    navigator.geolocation.getCurrentPosition(
      pos => {
        userPosition = [pos.coords.longitude, pos.coords.latitude];
        doFly(...userPosition);
      },
      () => {
        alert('Could not get your location.');
        if (btn) { btn.textContent = '🎯'; btn.disabled = false; }
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
}

function stopNavigation() {
  isNavigating = false;
  if (navInterval != null) { navigator.geolocation.clearWatch(navInterval); navInterval = null; }
  if (navEntity)   { viewer.entities.remove(navEntity);   navEntity   = null; }
  if (routeEntity) { viewer.entities.remove(routeEntity); routeEntity = null; }
  document.getElementById('nav-hud').style.display = 'none';
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 2500000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    duration: 3,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

function createUserMarkerCanvas() {
  const c = document.createElement('canvas');
  c.width = 36; c.height = 36;
  const ctx = c.getContext('2d');
  ctx.beginPath(); ctx.arc(18,18,14,0,Math.PI*2);
  ctx.fillStyle = '#4A90E2'; ctx.fill();
  ctx.strokeStyle = 'white'; ctx.lineWidth = 3; ctx.stroke();
  ctx.font = '16px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('🧭', 18, 18);
  return c.toDataURL();
}

// ── Chatbot ───────────────────────────────────────────
const SYSTEM_PROMPT = `You are a heritage guide for Sanskriti Sphere, an Indian cultural heritage platform.
Monuments: ${JSON.stringify(HERITAGE_SITES.map(s=>({name:s.name,city:s.city,dynasty:s.dynasty,built:s.built,description:s.description})))}.
Answer questions about Indian heritage, history, best time to visit, architecture, legends.
Be warm and concise — under 80 words.`;

function toggleChat() {
  const p = document.getElementById('chat-panel');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
  if (p.style.display === 'flex') document.getElementById('chat-input').focus();
}

function askAbout(site) {
  document.getElementById('chat-panel').style.display = 'flex';
  document.getElementById('chat-input').value = `Tell me about ${site.name}`;
  sendMessage();
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  appendMsg(text, 'user');
  chatHistory.push({ role: 'user', content: text });
  const typing = appendMsg('...', 'ai typing');
  try {
    // Build system prompt at call time (not module level) so HERITAGE_SITES is
    // definitely loaded, and use only ASCII-safe fields to avoid JSON corruption
    const systemPrompt = 'You are a heritage guide for Sanskriti Sphere, an Indian cultural heritage platform. ' +
      'You know about these monuments: ' +
      HERITAGE_SITES.map(s => s.name + ' in ' + s.city + ' (' + s.state + '), built ' + s.built + ' by ' + s.dynasty + '. ' + s.description).join(' | ') +
      ' Answer questions about Indian heritage, history, best time to visit, architecture, and legends. Be warm and concise, under 80 words.';

    const payload = {
      model: GROQ_MODEL,
      max_tokens: 200,
      messages: [{ role: 'system', content: systemPrompt }, ...chatHistory],
    };

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Groq error:', res.status, data);
      typing.textContent = 'Error ' + res.status + ': ' + (data.error?.message || 'Unknown error');
      typing.classList.remove('typing');
      return;
    }
    const reply = data.choices?.[0]?.message?.content || 'Sorry, could not get a response.';
    typing.textContent = reply;
    typing.classList.remove('typing');
    chatHistory.push({ role: 'assistant', content: reply });
  } catch(err) {
    console.error('Chat fetch error:', err);
    typing.textContent = 'Connection error. Please try again.';
    typing.classList.remove('typing');
  }
}

function appendMsg(text, type) {
  const msgs = document.getElementById('chat-messages');
  const el   = document.createElement('div');
  el.className = `msg ${type}`; el.textContent = text;
  msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
  return el;
}

// ── Draggable panels ─────────────────────────────────
function makeDraggable(el) {
  // Don't make draggable on mobile — panels are bottom sheets there
  if (isMobile()) return;
  let startX, startY, origLeft, origTop;

  const handle = el.querySelector('[data-drag-handle]') || el;
  handle.style.cursor = 'grab';

  handle.addEventListener('mousedown', e => {
    // Don't drag if clicking a button/input inside
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    handle.style.cursor = 'grabbing';

    const rect = el.getBoundingClientRect();
    startX  = e.clientX;
    startY  = e.clientY;
    origLeft = rect.left;
    origTop  = rect.top;

    // Switch from right/bottom anchoring to left/top so drag works
    el.style.right  = 'auto';
    el.style.bottom = 'auto';
    el.style.left   = origLeft + 'px';
    el.style.top    = origTop  + 'px';

    function onMove(e) {
      el.style.left = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  origLeft + e.clientX - startX)) + 'px';
      el.style.top  = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, origTop  + e.clientY - startY)) + 'px';
    }
    function onUp() {
      handle.style.cursor = 'grab';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  });
}

// ── Start ─────────────────────────────────────────────
initViewer().then(() => {
  makeDraggable(document.getElementById('popup'));
  makeDraggable(document.getElementById('chat-panel'));
});
