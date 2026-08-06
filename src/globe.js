const CITIES = [
  { name: 'New York', lat: 40.7128, lng: -74.0060, tz: 'America/New_York', country: 'USA' },
  { name: 'London', lat: 51.5074, lng: -0.1278, tz: 'Europe/London', country: 'UK' },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503, tz: 'Asia/Tokyo', country: 'Japan' },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093, tz: 'Australia/Sydney', country: 'Australia' },
  { name: 'Dubai', lat: 25.2048, lng: 55.2708, tz: 'Asia/Dubai', country: 'UAE' },
  { name: 'Paris', lat: 48.8566, lng: 2.3522, tz: 'Europe/Paris', country: 'France' },
  { name: 'Moscow', lat: 55.7558, lng: 37.6173, tz: 'Europe/Moscow', country: 'Russia' },
  { name: 'Rio', lat: -22.9068, lng: -43.1729, tz: 'America/Sao_Paulo', country: 'Brazil' },
  { name: 'Rome', lat: 41.9028, lng: 12.4964, tz: 'Europe/Rome', country: 'Italy' },
  { name: 'Berlin', lat: 52.5200, lng: 13.4050, tz: 'Europe/Berlin', country: 'Germany' },
  { name: 'Beijing', lat: 39.9042, lng: 116.4074, tz: 'Asia/Shanghai', country: 'China' },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777, tz: 'Asia/Kolkata', country: 'India' },
  { name: 'Cairo', lat: 30.0444, lng: 31.2357, tz: 'Africa/Cairo', country: 'Egypt' },
  { name: 'Cape Town', lat: -33.9249, lng: 18.4241, tz: 'Africa/Johannesburg', country: 'South Africa' },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198, tz: 'Asia/Singapore', country: 'Singapore' },
];

const EARTH_RADIUS = 5;
const MARKER_RADIUS = 0.08;
const LABEL_OFFSET = 0.35;
const DEFAULT_CAMERA_DISTANCE = 14;
const ZOOM_DISTANCE = 2.8;
const ANIMATION_SPEED = 0.04;
const GESTURE_ROTATION_SENSITIVITY = 8;
const GESTURE_ZOOM_SENSITIVITY = 12;

let scene, camera, renderer, labelRenderer, controls;
let earth, atmosphere, cloudLayer;
let markers = [];
let cityData = {};
let raycaster, mouse;
let selectedCity = null;
let isAnimating = false;
let animTarget = null;
let autoRotate = true;

let gestureTrackingEnabled = true;
let cameraRunning = false;
let handsModule, cameraModule;
let handDetected = false;
let lastHandPosition = null;
let gestureSelectCooldown = 0;

let weatherInterval;
let labelElements = {};
let satelliteGroup = null;
let orbitLines = [];

const WMO_CODES = {
  0: { icon: 'fa-sun', desc: 'Clear Sky' },
  1: { icon: 'fa-sun', desc: 'Mainly Clear' },
  2: { icon: 'fa-cloud-sun', desc: 'Partly Cloudy' },
  3: { icon: 'fa-cloud', desc: 'Overcast' },
  45: { icon: 'fa-smog', desc: 'Foggy' },
  48: { icon: 'fa-smog', desc: 'Depositing Rime Fog' },
  51: { icon: 'fa-cloud-rain', desc: 'Light Drizzle' },
  53: { icon: 'fa-cloud-rain', desc: 'Moderate Drizzle' },
  55: { icon: 'fa-cloud-rain', desc: 'Dense Drizzle' },
  61: { icon: 'fa-cloud-showers-heavy', desc: 'Slight Rain' },
  63: { icon: 'fa-cloud-showers-heavy', desc: 'Moderate Rain' },
  65: { icon: 'fa-cloud-showers-heavy', desc: 'Heavy Rain' },
  71: { icon: 'fa-snowflake', desc: 'Slight Snow' },
  73: { icon: 'fa-snowflake', desc: 'Moderate Snow' },
  75: { icon: 'fa-snowflake', desc: 'Heavy Snow' },
  80: { icon: 'fa-cloud-rain', desc: 'Slight Rain Showers' },
  81: { icon: 'fa-cloud-rain', desc: 'Moderate Rain Showers' },
  82: { icon: 'fa-cloud-rain', desc: 'Violent Rain Showers' },
  95: { icon: 'fa-bolt', desc: 'Thunderstorm' },
  96: { icon: 'fa-bolt', desc: 'Thunderstorm w/ Hail' },
  99: { icon: 'fa-bolt', desc: 'Thunderstorm w/ Heavy Hail' },
};

function latLngToPosition(lat, lng, radius) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lng + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function getCityTime(tz) {
  try {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const dateStr = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    return { time: timeStr, date: dateStr };
  } catch (e) {
    return { time: '--:--', date: '---' };
  }
}

function getDefaultWeather() {
  const temp = (15 + Math.random() * 20 - 10).toFixed(1);
  const codes = [0, 1, 2, 3];
  const code = codes[Math.floor(Math.random() * codes.length)];
  const wmo = WMO_CODES[code] || { icon: 'fa-globe', desc: 'Unknown' };
  return { temperature: temp, weathercode: code, icon: wmo.icon, description: wmo.desc, humidity: '--', windspeed: '--' };
}

async function fetchWeatherForCity(city) {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lng}&current_weather=true&hourly=relativehumidity_2m&timezone=auto&forecast_days=1`
    );
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const cw = data.current_weather;
    const wmo = WMO_CODES[cw.weathercode] || { icon: 'fa-globe', desc: 'Unknown' };
    let humidity = '--';
    if (data.hourly && data.hourly.relativehumidity_2m && data.hourly.relativehumidity_2m.length > 0) {
      humidity = data.hourly.relativehumidity_2m[0] + '%';
    }
    return {
      temperature: cw.temperature,
      weathercode: cw.weathercode,
      icon: wmo.icon,
      description: wmo.desc,
      humidity: humidity,
      windspeed: cw.windspeed + ' km/h',
    };
  } catch (e) {
    return null;
  }
}

async function refreshAllWeather() {
  const promises = CITIES.map(city => fetchWeatherForCity(city));
  const results = await Promise.allSettled(promises);
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      cityData[CITIES[i].name] = result.value;
    }
  });
  updateAllLabels();
  if (selectedCity) updateCityDetail(selectedCity);
}

function updateAllLabels() {
  CITIES.forEach(city => {
    const data = cityData[city.name] || getDefaultWeather();
    const timeInfo = getCityTime(city.tz);
    updateLabel(city.name, timeInfo, data);
  });
}

function createLabel(city) {
  const div = document.createElement('div');
  div.className = 'globe-marker-label';
  div.id = 'label-' + city.name.replace(/\s+/g, '-');
  div.innerHTML = `
    <div class="gml-city">${city.name}</div>
    <div class="gml-time">${getCityTime(city.tz).time}</div>
    <div class="gml-weather">
      <i class="fas fa-spinner fa-pulse"></i>
      <span class="gml-temp">--°C</span>
    </div>
  `;
  const label = new THREE.CSS2DObject(div);
  const pos = latLngToPosition(city.lat, city.lng, EARTH_RADIUS + LABEL_OFFSET);
  label.position.copy(pos);
  labelElements[city.name] = { div, label };
  return label;
}

function updateLabel(cityName, timeInfo, weather) {
  const el = labelElements[cityName];
  if (!el) return;
  const timeEl = el.div.querySelector('.gml-time');
  const iconEl = el.div.querySelector('.gml-weather i');
  const tempEl = el.div.querySelector('.gml-temp');
  if (timeEl) timeEl.textContent = timeInfo.time;
  if (iconEl) {
    iconEl.className = 'fas ' + weather.icon;
    iconEl.style.color = '';
  }
  if (tempEl) tempEl.textContent = weather.temperature + '°C';
}

function createEarth() {
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 128, 128);
  const textureLoader = new THREE.TextureLoader();
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.8,
    metalness: 0.1,
  });
  earth = new THREE.Mesh(geometry, material);
  scene.add(earth);

  const textureUrls = [
    'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
    'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
    'https://unpkg.com/three-globe/example/img/earth-night.jpg',
  ];

  function tryLoadTexture(index) {
    if (index >= textureUrls.length) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#1a3a5c');
      grad.addColorStop(0.3, '#2d5a8e');
      grad.addColorStop(0.5, '#3a7bb5');
      grad.addColorStop(0.7, '#2d5a8e');
      grad.addColorStop(1, '#1a3a5c');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = `rgba(100,180,100,${0.2 + Math.random() * 0.4})`;
        const x = Math.random() * 512;
        const y = Math.random() * 256;
        const w = 5 + Math.random() * 30;
        const h = 5 + Math.random() * 20;
        ctx.beginPath();
        ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const fallbackTexture = new THREE.CanvasTexture(canvas);
      earth.material.map = fallbackTexture;
      earth.material.color.setHex(0xffffff);
      earth.material.needsUpdate = true;
      return;
    }

    textureLoader.load(
      textureUrls[index],
      function (texture) {
        earth.material.map = texture;
        earth.material.color.setHex(0xffffff);
        earth.material.needsUpdate = true;
      },
      undefined,
      function () {
        tryLoadTexture(index + 1);
      }
    );
  }

  tryLoadTexture(0);
}

function createAtmosphere() {
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.02, 48, 48);
  const material = new THREE.MeshPhongMaterial({
    color: 0x00f3ff,
    transparent: true,
    opacity: 0.12,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
  atmosphere = new THREE.Mesh(geometry, material);
  scene.add(atmosphere);
}

function createClouds() {
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.01, 48, 48);
  const material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
  });
  cloudLayer = new THREE.Mesh(geometry, material);
  scene.add(cloudLayer);
}

function createGridRing() {
  const ringGeo = new THREE.RingGeometry(EARTH_RADIUS * 1.08, EARTH_RADIUS * 1.12, 80);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00f3ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);

  const ringGeo2 = new THREE.RingGeometry(EARTH_RADIUS * 1.08, EARTH_RADIUS * 1.12, 80);
  const ringMat2 = new THREE.MeshBasicMaterial({
    color: 0x9d4edd,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
  });
  const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
  ring2.rotation.z = Math.PI / 3;
  ring2.rotation.x = Math.PI / 3;
  scene.add(ring2);
}

function createStars() {
  const starsGeometry = new THREE.BufferGeometry();
  const starsCount = 2000;
  const positions = new Float32Array(starsCount * 3);
  for (let i = 0; i < starsCount * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 600;
  }
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.15,
    transparent: true,
    opacity: 0.6,
  });
  const stars = new THREE.Points(starsGeometry, starsMaterial);
  scene.add(stars);
}

function createSatellites() {
  satelliteGroup = new THREE.Group();
  const satGeo = new THREE.SphereGeometry(0.04, 8, 8);
  const satMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
  const satGlowGeo = new THREE.SphereGeometry(0.1, 8, 8);
  const satGlowMat = new THREE.MeshBasicMaterial({
    color: 0xff4444,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
  });

  const orbits = [
    { radius: EARTH_RADIUS * 1.35, speed: 0.008, inclination: 0.15, count: 3 },
    { radius: EARTH_RADIUS * 1.55, speed: 0.006, inclination: -0.2, count: 2 },
    { radius: EARTH_RADIUS * 1.75, speed: 0.004, inclination: 0.3, count: 2 },
    { radius: EARTH_RADIUS * 2.0, speed: 0.003, inclination: -0.1, count: 2 },
  ];

  orbits.forEach((orbit, oi) => {
    const points = [];
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle) * orbit.radius;
      const z = Math.sin(angle) * orbit.radius * Math.cos(orbit.inclination);
      const y = Math.sin(angle) * orbit.radius * Math.sin(orbit.inclination);
      points.push(new THREE.Vector3(x, y, z));
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(points);
    const orbitMat = new THREE.LineBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.08,
    });
    const orbitLine = new THREE.Line(orbitGeo, orbitMat);
    orbitLines.push(orbitLine);
    satelliteGroup.add(orbitLine);

    for (let s = 0; s < orbit.count; s++) {
      const sat = new THREE.Mesh(satGeo, satMat.clone());
      const glow = new THREE.Mesh(satGlowGeo, satGlowMat.clone());
      sat.add(glow);
      sat.userData = {
        orbitRadius: orbit.radius,
        speed: orbit.speed,
        inclination: orbit.inclination,
        angle: (Math.PI * 2 / orbit.count) * s,
        isSatellite: true,
      };
      satelliteGroup.add(sat);
    }
  });

  scene.add(satelliteGroup);
}

function updateSatellites() {
  if (!satelliteGroup) return;
  satelliteGroup.children.forEach(child => {
    if (child.userData && child.userData.isSatellite) {
      child.userData.angle += child.userData.speed;
      const a = child.userData.angle;
      const r = child.userData.orbitRadius;
      const inc = child.userData.inclination;
      child.position.set(
        Math.cos(a) * r,
        Math.sin(a) * r * Math.sin(inc),
        Math.sin(a) * r * Math.cos(inc)
      );
    }
  });
}

function initGlobe() {
  const container = document.getElementById('globe-canvas-container');
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f);

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
  camera.position.set(0, 3, DEFAULT_CAMERA_DISTANCE);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  labelRenderer = new THREE.CSS2DRenderer();
  labelRenderer.setSize(w, h);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.minDistance = 2.5;
  controls.maxDistance = 25;
  controls.target.set(0, 0, 0);

  const ambientLight = new THREE.AmbientLight(0x222244, 0.4);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(10, 15, 10);
  scene.add(dirLight);
  const dirLight2 = new THREE.DirectionalLight(0x4488ff, 0.3);
  dirLight2.position.set(-10, -5, -10);
  scene.add(dirLight2);

  createEarth();
  createAtmosphere();
  createClouds();
  createGridRing();
  createStars();
  createSatellites();

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  CITIES.forEach(city => {
    const pos = latLngToPosition(city.lat, city.lng, EARTH_RADIUS);

    const markerGeo = new THREE.SphereGeometry(MARKER_RADIUS, 12, 12);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.copy(pos);
    marker.userData = { cityName: city.name, isMarker: true };
    scene.add(marker);
    markers.push(marker);

    const glowGeo = new THREE.SphereGeometry(MARKER_RADIUS * 2.5, 12, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(pos);
    scene.add(glow);

    const pulseGeo = new THREE.SphereGeometry(MARKER_RADIUS * 4, 12, 12);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
    });
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    pulse.position.copy(pos);
    scene.add(pulse);

    const label = createLabel(city);
    scene.add(label);
  });

  renderer.domElement.style.pointerEvents = 'auto';
  renderer.domElement.addEventListener('click', onGlobeClick);

  document.getElementById('globe-loading').classList.add('hidden');

  const countEl = document.getElementById('globe-city-count');
  if (countEl) countEl.textContent = CITIES.length + ' CITIES TRACKED';

  refreshAllWeather();
  weatherInterval = setInterval(refreshAllWeather, 300000);

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  if (isAnimating) animateZoom();
  if (cloudLayer) cloudLayer.rotation.y += 0.0003;
  if (atmosphere) atmosphere.rotation.y += 0.0005;
  updateSatellites();
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
  if (labelRenderer && scene && camera) labelRenderer.render(scene, camera);
}

function onGlobeClick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(markers);
  if (intersects.length > 0) {
    const obj = intersects[0].object;
    const cityName = obj.userData.cityName;
    if (cityName) {
      const city = CITIES.find(c => c.name === cityName);
      if (city) zoomToCity(city);
    }
  } else {
    if (selectedCity) resetToGlobal();
  }
}

function zoomToCity(city) {
  if (isAnimating) return;
  selectedCity = city;
  isAnimating = true;
  controls.autoRotate = false;
  autoRotate = false;
  const btn = document.getElementById('btn-globe-rotate');
  if (btn) { btn.classList.remove('active'); const ind = btn.querySelector('.indicator'); if (ind) ind.style.background = '#555'; }
  const targetPos = latLngToPosition(city.lat, city.lng, EARTH_RADIUS);
  animTarget = {
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: targetPos.clone().multiplyScalar(ZOOM_DISTANCE / EARTH_RADIUS),
    toTarget: targetPos.clone(),
    progress: 0,
  };
  updateCityDetail(city);
}

function animateZoom() {
  if (!animTarget || !isAnimating) return;
  animTarget.progress += ANIMATION_SPEED;
  const t = Math.min(animTarget.progress, 1);
  const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  camera.position.lerpVectors(animTarget.fromPos, animTarget.toPos, ease);
  controls.target.lerpVectors(animTarget.fromTarget, animTarget.toTarget, ease);
  if (t >= 1) {
    isAnimating = false;
    animTarget = null;
  }
}

function resetToGlobal() {
  selectedCity = null;
  isAnimating = false;
  animTarget = null;
  controls.autoRotate = autoRotate;
  animTarget = {
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: new THREE.Vector3(0, 3, DEFAULT_CAMERA_DISTANCE),
    toTarget: new THREE.Vector3(0, 0, 0),
    progress: 0,
  };
  isAnimating = true;

  const defaultPanel = document.getElementById('globe-default-controls');
  const detailPanel = document.getElementById('globe-city-detail');

  if (detailPanel && !detailPanel.classList.contains('hidden')) {
    detailPanel.classList.add('collapsing');
    setTimeout(() => {
      detailPanel.classList.remove('collapsing', 'expanding');
      detailPanel.classList.add('hidden');
      if (defaultPanel) {
        defaultPanel.classList.remove('hidden');
        defaultPanel.classList.add('expanding');
        requestAnimationFrame(() => defaultPanel.classList.remove('expanding'));
      }
    }, 250);
  } else if (defaultPanel) {
    detailPanel?.classList.add('hidden');
    defaultPanel.classList.remove('hidden');
  }
}

function updateCityDetail(city) {
  const data = cityData[city.name] || getDefaultWeather();
  const timeInfo = getCityTime(city.tz);
  document.getElementById('city-detail-name').textContent = city.name + ', ' + city.country;
  document.getElementById('city-detail-time').textContent = timeInfo.time;
  document.getElementById('city-detail-icon').innerHTML = '<i class="fas ' + data.icon + '" style="font-size:32px"></i>';
  document.getElementById('city-detail-temp').textContent = data.temperature + '°C';
  document.getElementById('city-detail-desc').textContent = data.description;
  document.getElementById('city-detail-humidity').textContent = data.humidity;
  document.getElementById('city-detail-wind').textContent = data.windspeed;
  document.getElementById('city-detail-tz').textContent = city.tz;
  const latDir = city.lat >= 0 ? 'N' : 'S';
  const lngDir = city.lng >= 0 ? 'E' : 'W';
  document.getElementById('city-detail-coords').textContent = Math.abs(city.lat).toFixed(1) + '°' + latDir + ', ' + Math.abs(city.lng).toFixed(1) + '°' + lngDir;
  document.getElementById('globe-city-detail').classList.remove('hidden');
  document.getElementById('globe-default-controls').classList.add('hidden');
}

// ── MediaPipe Hand Gesture Integration ────────────────────────────────

async function initMediaPipeHands() {
  const videoElement = document.getElementById('webcam');

  handsModule = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  handsModule.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  handsModule.onResults(onHandsResults);

  cameraModule = new Camera(videoElement, {
    onFrame: async () => {
      if (gestureTrackingEnabled && cameraRunning) {
        await handsModule.send({ image: videoElement });
      }
    },
    width: 640,
    height: 480,
  });

  await cameraModule.start();
  document.getElementById('globe-status-hud').classList.remove('hidden');
}

function drawHandConnections(ctx, landmarks, image) {
  const canvas = document.getElementById('canvas-overlay');
  if (canvas.width !== image.width || canvas.height !== image.height) {
    canvas.width = image.width;
    canvas.height = image.height;
  }

  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
  ];

  ctx.strokeStyle = '#00f3ff';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';

  connections.forEach(([start, end]) => {
    const s = landmarks[start], e = landmarks[end];
    ctx.beginPath();
    ctx.moveTo(s.x * canvas.width, s.y * canvas.height);
    ctx.lineTo(e.x * canvas.width, e.y * canvas.height);
    ctx.stroke();
  });

  ctx.fillStyle = '#ff2a5f';
  landmarks.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x * canvas.width, point.y * canvas.height, 5, 0, 2 * Math.PI);
    ctx.fill();
  });

  ctx.restore();
}

function onHandsResults(results) {
  const gestureStatus = document.getElementById('globe-gesture-status');
  const canvas = document.getElementById('canvas-overlay');
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-canvas.width, 0);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    handDetected = true;
    gestureStatus.textContent = 'GESTURE SYNCED';
    gestureStatus.className = 'status-title detected';

    const landmarks = results.multiHandLandmarks[0];
    drawHandConnections(ctx, landmarks, results.image);
    if (gestureTrackingEnabled) processHandGestures(landmarks);
  } else {
    handDetected = false;
    gestureStatus.textContent = 'NO HAND';
    gestureStatus.className = 'status-title';
    resetHandInertia();
  }
}

const spherical = new THREE.Spherical();
const offset = new THREE.Vector3();
let gestureVelocityX = 0;
let gestureVelocityY = 0;

function processHandGestures(landmarks) {
  const indexTip = landmarks[8];
  const thumbTip = landmarks[4];
  const middleTip = landmarks[12];

  const handX = (indexTip.x + thumbTip.x + middleTip.x) / 3;
  const handY = (indexTip.y + thumbTip.y + middleTip.y) / 3;

  if (lastHandPosition) {
    const deltaX = handX - lastHandPosition.x;
    const deltaY = handY - lastHandPosition.y;
    gestureVelocityX = deltaX * GESTURE_ROTATION_SENSITIVITY;
    gestureVelocityY = deltaY * GESTURE_ROTATION_SENSITIVITY;

    if (gestureTrackingEnabled && controls) {
      controls.autoRotate = false;
      controls.enableDamping = true;

      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);

      spherical.theta -= deltaX * GESTURE_ROTATION_SENSITIVITY * 0.02;
      spherical.phi -= deltaY * GESTURE_ROTATION_SENSITIVITY * 0.02;
      spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));

      offset.setFromSpherical(spherical);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
    }
  }

  const currentPinch = Math.sqrt(
    Math.pow(indexTip.x - thumbTip.x, 2) + Math.pow(indexTip.y - thumbTip.y, 2)
  );

  if (lastHandPosition) {
    const prevPinch = lastHandPosition.pinch || currentPinch;
    const pinchDelta = currentPinch - prevPinch;
    if (Math.abs(pinchDelta) > 0.005) {
      const currentDist = camera.position.distanceTo(controls.target);
      const newDist = Math.max(2.5, Math.min(25, currentDist - pinchDelta * GESTURE_ZOOM_SENSITIVITY));
      offset.copy(camera.position).sub(controls.target).normalize().multiplyScalar(newDist);
      camera.position.copy(controls.target).add(offset);
    }
    lastHandPosition.pinch = currentPinch;
  }

  gestureSelectCooldown = Math.max(0, gestureSelectCooldown - 1);
  if (gestureSelectCooldown === 0) {
    const fingerRaycaster = new THREE.Raycaster();
    const fingerMouse = new THREE.Vector2(
      (indexTip.x * 2 - 1) * -1,
      -(indexTip.y * 2 - 1)
    );
    fingerRaycaster.setFromCamera(fingerMouse, camera);
    const intersects = fingerRaycaster.intersectObjects(markers);
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      const cityName = obj.userData.cityName;
      if (cityName) {
        const city = CITIES.find(c => c.name === cityName);
        if (city && city !== selectedCity) {
          zoomToCity(city);
          gestureSelectCooldown = 30;
        }
      }
    }
  }

  lastHandPosition = { x: handX, y: handY };
}

function resetHandInertia() {
  gestureVelocityX *= 0.95;
  gestureVelocityY *= 0.95;
  if (controls && !selectedCity && !isAnimating) {
    controls.autoRotate = autoRotate;
  }
}

// ── Resize ────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  const container = document.getElementById('globe-canvas-container');
  if (!container || !renderer || !labelRenderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
});

function openEditor() {
  if (window.electronAPI?.openEditor) {
    window.electronAPI.openEditor();
  }
}

// ── DOM Ready ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  setTimeout(initGlobe, 100);

  document.getElementById('btn-globe-rotate').addEventListener('click', function () {
    autoRotate = !autoRotate;
    if (!handDetected) controls.autoRotate = autoRotate;
    this.classList.toggle('active');
    const ind = this.querySelector('.indicator');
    if (ind) ind.style.background = autoRotate ? '#00ff88' : '#555';
  });

  document.getElementById('btn-view-global').addEventListener('click', function () {
    resetToGlobal();
  });

  document.getElementById('btn-city-back').addEventListener('click', function () {
    resetToGlobal();
  });

  document.getElementById('btn-globe-gestures').addEventListener('click', async function () {
    gestureTrackingEnabled = !gestureTrackingEnabled;
    this.classList.toggle('active', gestureTrackingEnabled);
    const indicator = this.querySelector('.indicator');
    indicator.style.background = gestureTrackingEnabled ? '#00ff88' : '#555';
    indicator.style.boxShadow = gestureTrackingEnabled ? '0 0 6px #00ff88' : 'none';

    const gestureStatus = document.getElementById('globe-gesture-status');
    if (!gestureTrackingEnabled) {
      gestureStatus.textContent = 'GESTURES SUSPENDED';
      gestureStatus.className = 'status-title warning';
      handDetected = false;
      if (cameraModule && cameraRunning) {
        await cameraModule.stop();
        cameraRunning = false;
      }
      addTickerEvent('globe', 'Hand gesture camera tracking suspended.');
      controls.autoRotate = autoRotate;
    } else {
      gestureStatus.textContent = 'NO HAND';
      gestureStatus.className = 'status-title';
      if (cameraModule && !cameraRunning) {
        await cameraModule.start();
        cameraRunning = true;
      } else if (!cameraModule) {
        initMediaPipeHands().then(() => { cameraRunning = true; });
      }
      addTickerEvent('globe', 'Hand gesture camera tracking restored.');
    }
  });

  setTimeout(async () => {
    addTickerEvent('globe', 'Loading MediaPipe hand tracking engine...');
    try {
      await initMediaPipeHands();
      cameraRunning = true;
      addTickerEvent('globe', 'Hand gesture tracking active.');
    } catch (err) {
      console.error('MediaPipe init error:', err);
      addTickerEvent('warn', 'MediaPipe hands failed to initialize.');
    }
  }, 500);

  // ── Local Weather Forecast ──
  initLocalForecast();
});

// ── Local Forecast ──

async function initLocalForecast() {
  try {
    const pos = await getPosition();
    const { latitude, longitude } = pos.coords;
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum,windspeed_10m_max` +
      `&timezone=auto&forecast_days=7`
    );
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    const locEl = document.getElementById('forecast-location');
    if (locEl) {
      try {
        const geoRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=it`);
        const geoData = await geoRes.json();
        locEl.textContent = `// ${geoData.city || geoData.locality || geoData.principalSubdivision || ''}`;
      } catch { locEl.textContent = `// ${latitude.toFixed(1)}°N, ${longitude.toFixed(1)}°E`; }
    }

    renderForecast(data.daily);
  } catch (e) {
    addTickerEvent('warn', `Forecast: ${e.message}`);
  }
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: false });
  });
}

const WMO_ICONS = {
  0: { icon: 'fa-sun', desc: 'Sereno' },
  1: { icon: 'fa-sun', desc: 'Prevalentemente sereno' },
  2: { icon: 'fa-cloud-sun', desc: 'Parzialmente nuvoloso' },
  3: { icon: 'fa-cloud', desc: 'Coperto' },
  45: { icon: 'fa-smog', desc: 'Nebbia' },
  48: { icon: 'fa-smog', desc: 'Nebbia con ghiaccio' },
  51: { icon: 'fa-cloud-rain', desc: 'Pioggia leggera' },
  53: { icon: 'fa-cloud-rain', desc: 'Pioggia moderata' },
  55: { icon: 'fa-cloud-showers-heavy', desc: 'Pioggia intensa' },
  56: { icon: 'fa-snowflake', desc: 'Pioggia gelata' },
  57: { icon: 'fa-snowflake', desc: 'Pioggia gelata intensa' },
  61: { icon: 'fa-cloud-rain', desc: 'Pioggia leggera' },
  63: { icon: 'fa-cloud-rain', desc: 'Pioggia moderata' },
  65: { icon: 'fa-cloud-showers-heavy', desc: 'Pioggia intensa' },
  66: { icon: 'fa-snowflake', desc: 'Pioggia gelata' },
  67: { icon: 'fa-snowflake', desc: 'Pioggia gelata intensa' },
  71: { icon: 'fa-snowflake', desc: 'Neve leggera' },
  73: { icon: 'fa-snowflake', desc: 'Neve moderata' },
  75: { icon: 'fa-snowflake', desc: 'Neve intensa' },
  77: { icon: 'fa-snowflake', desc: 'Granelli di neve' },
  80: { icon: 'fa-cloud-showers-heavy', desc: 'Rovesci leggeri' },
  81: { icon: 'fa-cloud-showers-heavy', desc: 'Rovesci moderati' },
  82: { icon: 'fa-cloud-showers-heavy', desc: 'Rovesci violenti' },
  85: { icon: 'fa-snowflake', desc: 'Neve debole' },
  86: { icon: 'fa-snowflake', desc: 'Neve forte' },
  95: { icon: 'fa-bolt', desc: 'Temporale' },
  96: { icon: 'fa-bolt', desc: 'Temporale con grandine' },
  99: { icon: 'fa-bolt', desc: 'Temporale forte' },
};

function renderForecast(daily) {
  const container = document.getElementById('forecast-days');
  if (!container) return;
  container.innerHTML = '';
  const today = new Date().toLocaleDateString('it-IT', { weekday: 'short' });

  for (let i = 0; i < daily.time.length; i++) {
    const date = new Date(daily.time[i] + 'T12:00:00');
    const dayName = i === 0 ? 'OGGI' : date.toLocaleDateString('it-IT', { weekday: 'short' }).toUpperCase();
    const wmo = WMO_ICONS[daily.weathercode[i]] || { icon: 'fa-globe', desc: '' };
    const maxT = Math.round(daily.temperature_2m_max[i]);
    const minT = Math.round(daily.temperature_2m_min[i]);
    const precip = daily.precipitation_sum[i] || 0;

    const el = document.createElement('div');
    el.className = 'forecast-day';
    el.innerHTML = `
      <span class="fw-day">${dayName}</span>
      <span class="fw-icon"><i class="fas ${wmo.icon}"></i></span>
      <span class="fw-temps">
        <span class="fw-max">${maxT}°</span>
        <span class="fw-min">${minT}°</span>
      </span>
      <span class="fw-precip">${precip > 0 ? `<i class="fas fa-tint"></i> ${precip}mm` : ''}</span>
    `;
    container.appendChild(el);
  }
}
