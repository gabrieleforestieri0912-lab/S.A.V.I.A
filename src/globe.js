const CITIES = [
  { name: 'New York', lat: 40.7128, lng: -74.0060, tz: 'America/New_York', country: 'USA' },
  { name: 'London', lat: 51.5074, lng: -0.1278, tz: 'Europe/London', country: 'UK' },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503, tz: 'Asia/Tokyo', country: 'Japan' },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093, tz: 'Australia/Sydney', country: 'Australia' },
  { name: 'Dubai', lat: 25.2048, lng: 55.2708, tz: 'Asia/Dubai', country: 'UAE' },
  { name: 'Paris', lat: 48.8566, lng: 2.3522, tz: 'Europe/Paris', country: 'France' },
  { name: 'Moscow', lat: 55.7558, lng: 37.6173, tz: 'Europe/Moscow', country: 'Russia' },
  { name: 'Rio de Janeiro', lat: -22.9068, lng: -43.1729, tz: 'America/Sao_Paulo', country: 'Brazil' },
  { name: 'Roma', lat: 41.9028, lng: 12.4964, tz: 'Europe/Rome', country: 'Italia' },
  { name: 'Berlin', lat: 52.5200, lng: 13.4050, tz: 'Europe/Berlin', country: 'Germany' },
  { name: 'Beijing', lat: 39.9042, lng: 116.4074, tz: 'Asia/Shanghai', country: 'China' },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777, tz: 'Asia/Kolkata', country: 'India' },
  { name: 'Cairo', lat: 30.0444, lng: 31.2357, tz: 'Africa/Cairo', country: 'Egypt' },
  { name: 'Cape Town', lat: -33.9249, lng: 18.4241, tz: 'Africa/Johannesburg', country: 'South Africa' },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198, tz: 'Asia/Singapore', country: 'Singapore' },

  { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, tz: 'America/Los_Angeles', country: 'USA' },
  { name: 'Mexico City', lat: 19.4326, lng: -99.1332, tz: 'America/Mexico_City', country: 'Mexico' },
  { name: 'Toronto', lat: 43.6532, lng: -79.3832, tz: 'America/Toronto', country: 'Canada' },
  { name: 'Buenos Aires', lat: -34.6037, lng: -58.3816, tz: 'America/Argentina/Buenos_Aires', country: 'Argentina' },
  { name: 'Lima', lat: -12.0464, lng: -77.0428, tz: 'America/Lima', country: 'Peru' },
  { name: 'Madrid', lat: 40.4168, lng: -3.7038, tz: 'Europe/Madrid', country: 'Spain' },
  { name: 'Amsterdam', lat: 52.3676, lng: 4.9041, tz: 'Europe/Amsterdam', country: 'Netherlands' },
  { name: 'Istanbul', lat: 41.0082, lng: 28.9784, tz: 'Europe/Istanbul', country: 'Turkey' },
  { name: 'Lagos', lat: 6.5244, lng: 3.3792, tz: 'Africa/Lagos', country: 'Nigeria' },
  { name: 'Nairobi', lat: -1.2921, lng: 36.8219, tz: 'Africa/Nairobi', country: 'Kenya' },
  { name: 'Bangkok', lat: 13.7563, lng: 100.5018, tz: 'Asia/Bangkok', country: 'Thailand' },
  { name: 'Seoul', lat: 37.5665, lng: 126.9780, tz: 'Asia/Seoul', country: 'South Korea' },
  { name: 'Jakarta', lat: -6.2088, lng: 106.8456, tz: 'Asia/Jakarta', country: 'Indonesia' },
  { name: 'Auckland', lat: -36.8485, lng: 174.7633, tz: 'Pacific/Auckland', country: 'New Zealand' },
  { name: 'Honolulu', lat: 21.3069, lng: -157.8583, tz: 'Pacific/Honolulu', country: 'USA' },
  { name: 'Reykjavik', lat: 64.1466, lng: -21.9426, tz: 'Atlantic/Reykjavik', country: 'Iceland' },
];

const EARTH_RADIUS = 5;
const MARKER_RADIUS = 0.08;
const LABEL_OFFSET = 0.38;
const DEFAULT_CAMERA_DISTANCE = 14;
const ZOOM_DISTANCE = 2.8;
const ANIMATION_SPEED = 0.04;
const GESTURE_ROTATION_SENSITIVITY = 8;
const GESTURE_ZOOM_SENSITIVITY = 12;
const ARC_BEND_FACTOR = 0.5;

const HOME_CITY = (CITIES.find(c => c.name === 'Roma')) || CITIES[0];
const NIGHT_ICONS = { 'fa-sun': 'fa-moon', 'fa-cloud-sun': 'fa-cloud-moon', 'fa-cloud-showers-heavy': 'fa-cloud-showers-heavy', 'fa-bolt': 'fa-bolt' };

let scene, camera, renderer, labelRenderer, controls;
let earth, atmosphere, cloudLayer;
let markers = [];
let markerObjs = [];
let cityData = {};
let raycaster, mouse;
let selectedCity = null;
let isAnimating = false;
let animTarget = null;
let autoRotate = true;
let hoverMarker = null;
let labelLodCompact = false;
let arcGroup = null;

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
  48: { icon: 'fa-smog', desc: 'Rime Fog' },
  51: { icon: 'fa-cloud-rain', desc: 'Light Drizzle' },
  53: { icon: 'fa-cloud-rain', desc: 'Drizzle' },
  55: { icon: 'fa-cloud-rain', desc: 'Dense Drizzle' },
  56: { icon: 'fa-snowflake', desc: 'Freezing Drizzle' },
  57: { icon: 'fa-snowflake', desc: 'Heavy Freezing Drizzle' },
  61: { icon: 'fa-cloud-showers-heavy', desc: 'Light Rain' },
  63: { icon: 'fa-cloud-showers-heavy', desc: 'Rain' },
  65: { icon: 'fa-cloud-showers-heavy', desc: 'Heavy Rain' },
  66: { icon: 'fa-snowflake', desc: 'Freezing Rain' },
  67: { icon: 'fa-snowflake', desc: 'Heavy Freezing Rain' },
  71: { icon: 'fa-snowflake', desc: 'Light Snow' },
  73: { icon: 'fa-snowflake', desc: 'Snow' },
  75: { icon: 'fa-snowflake', desc: 'Heavy Snow' },
  77: { icon: 'fa-snowflake', desc: 'Snow Grains' },
  80: { icon: 'fa-cloud-rain', desc: 'Rain Showers' },
  81: { icon: 'fa-cloud-rain', desc: 'Moderate Showers' },
  82: { icon: 'fa-cloud-rain', desc: 'Violent Showers' },
  85: { icon: 'fa-snowflake', desc: 'Snow Showers' },
  86: { icon: 'fa-snowflake', desc: 'Heavy Snow Showers' },
  95: { icon: 'fa-bolt', desc: 'Thunderstorm' },
  96: { icon: 'fa-bolt', desc: 'Thunderstorm w/ Hail' },
  99: { icon: 'fa-bolt', desc: 'Thunderstorm w/ Heavy Hail' },
};

function weatherIcon(code, isDay) {
  const base = WMO_CODES[code] || { icon: 'fa-globe', desc: 'Unknown' };
  const out = { icon: base.icon, desc: base.desc };
  if (isDay === 0 || isDay === false) {
    if (NIGHT_ICONS[out.icon]) out.icon = NIGHT_ICONS[out.icon];
  }
  return out;
}

function compass(deg) {
  if (deg == null) return '--';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

function timeOf(iso) {
  if (!iso) return '--:--';
  const s = String(iso);
  return s.length >= 16 ? s.slice(11, 16) : s;
}

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
  const wmo = weatherIcon(code, 1);
  const today = new Date();
  const forecast = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const fc = weatherIcon(codes[Math.floor(Math.random() * 4)], 1);
    forecast.push({
      day: d.toISOString().slice(0, 10),
      code: codes[Math.floor(Math.random() * 4)],
      icon: fc.icon,
      desc: fc.desc,
      max: Math.round(18 + Math.random() * 12),
      min: Math.round(10 + Math.random() * 6),
      prob: 0,
      precip: 0
    });
  }
  return {
    temperature: temp,
    feels: temp,
    humidity: '--',
    weathercode: code,
    icon: wmo.icon,
    description: wmo.desc,
    isDay: 1,
    windSpeed: '--',
    windDir: '--',
    pressure: '--',
    uv: '--',
    sunrise: '--:--',
    sunset: '--:--',
    forecast
  };
}

async function fetchWeatherForCity(city) {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lng}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,uv_index` +
      `&daily=sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum` +
      `&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('API error');
    const d = await res.json();
    const c = d.current;
    const dly = d.daily;
    const isDay = c.is_day === 1;
    const wmo = weatherIcon(c.weather_code, c.is_day);

    const forecast = (dly && dly.time || []).map((t, i) => {
      const wi = weatherIcon(dly.weather_code[i], 1);
      return {
        day: t,
        code: dly.weather_code[i],
        icon: wi.icon,
        desc: wi.desc,
        max: Math.round(dly.temperature_2m_max[i]),
        min: Math.round(dly.temperature_2m_min[i]),
        prob: dly.precipitation_probability_max ? dly.precipitation_probability_max[i] : 0,
        precip: dly.precipitation_sum ? dly.precipitation_sum[i] : 0
      };
    });

    return {
      temperature: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: Math.round(c.relative_humidity_2m) + '%',
      weathercode: c.weather_code,
      icon: wmo.icon,
      description: wmo.desc,
      isDay: isDay,
      windSpeed: Math.round(c.wind_speed_10m) + ' km/h',
      windDir: compass(c.wind_direction_10m),
      pressure: Math.round(c.surface_pressure) + ' hPa',
      uv: c.uv_index != null ? Number(c.uv_index).toFixed(1) : '--',
      sunrise: timeOf(dly && dly.sunrise && dly.sunrise[0]),
      sunset: timeOf(dly && dly.sunset && dly.sunset[0]),
      forecast
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
    } else {
      cityData[CITIES[i].name] = getDefaultWeather();
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
    let icon = weather.icon;
    if (weather.isDay === 0 || weather.isDay === false) {
      if (NIGHT_ICONS[icon]) icon = NIGHT_ICONS[icon];
    }
    iconEl.className = 'fas ' + icon;
    iconEl.style.color = '';
  }
  if (tempEl) tempEl.textContent = weather.temperature + '°C';
}

function createEarth() {
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 128, 128);
  const textureLoader = new THREE.TextureLoader();
  const material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1 });
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
        ctx.beginPath();
        ctx.ellipse(x, y, 8 + Math.random() * 26, 6 + Math.random() * 18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      earth.material.map = new THREE.CanvasTexture(canvas);
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
      function () { tryLoadTexture(index + 1); }
    );
  }
  tryLoadTexture(0);
}

function createAtmosphere() {
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.02, 48, 48);
  const material = new THREE.MeshPhongMaterial({
    color: 0x00f3ff,
    transparent: true,
    opacity: 0.14,
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
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00f3ff, side: THREE.DoubleSide, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(EARTH_RADIUS * 1.08, EARTH_RADIUS * 1.12, 80), ringMat);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);

  const ringMat2 = new THREE.MeshBasicMaterial({
    color: 0x9d4edd, side: THREE.DoubleSide, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending,
  });
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(EARTH_RADIUS * 1.08, EARTH_RADIUS * 1.12, 80), ringMat2);
  ring2.rotation.z = Math.PI / 3;
  ring2.rotation.x = Math.PI / 3;
  scene.add(ring2);
}

function createStars() {
  const starsCount = 2000;
  const positions = new Float32Array(starsCount * 3);
  for (let i = 0; i < starsCount * 3; i++) positions[i] = (Math.random() - 0.5) * 600;
  const starsGeo = new THREE.BufferGeometry();
  starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.15, transparent: true, opacity: 0.6,
  }));
  scene.add(stars);
}

function createSatellites() {
  satelliteGroup = new THREE.Group();
  const satGeo = new THREE.SphereGeometry(0.04, 8, 8);
  const satMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
  const satGlowMat = new THREE.MeshBasicMaterial({
    color: 0xff4444, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending,
  });

  const orbits = [
    { radius: EARTH_RADIUS * 1.35, speed: 0.008, inclination: 0.15, count: 3 },
    { radius: EARTH_RADIUS * 1.55, speed: 0.006, inclination: -0.2, count: 2 },
    { radius: EARTH_RADIUS * 1.75, speed: 0.004, inclination: 0.3, count: 2 },
    { radius: EARTH_RADIUS * 2.0, speed: 0.003, inclination: -0.1, count: 2 },
  ];

  orbits.forEach((orbit) => {
    const points = [];
    for (let i = 0; i <= 128; i++) {
      const angle = (i / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * orbit.radius,
        Math.sin(angle) * orbit.radius * Math.sin(orbit.inclination),
        Math.sin(angle) * orbit.radius * Math.cos(orbit.inclination)
      ));
    }
    const orbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.08 })
    );
    orbitLines.push(orbitLine);
    satelliteGroup.add(orbitLine);

    for (let s = 0; s < orbit.count; s++) {
      const sat = new THREE.Mesh(satGeo, satMat.clone());
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), satGlowMat.clone());
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

function buildCityArcs(hub) {
  removeCityArcs();
  arcGroup = new THREE.Group();
  const baseMat = new THREE.LineBasicMaterial({
    color: 0x00f3ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending,
  });

  CITIES.forEach(city => {
    if (city.name === hub.name) return;
    const a = latLngToPosition(hub.lat, hub.lng, EARTH_RADIUS);
    const b = latLngToPosition(city.lat, city.lng, EARTH_RADIUS);
    const bend = EARTH_RADIUS + Math.min(a.distanceTo(b) * ARC_BEND_FACTOR, 2.6);
    const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(bend);
    const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(56);
    const mat = baseMat.clone();
    mat.opacity = 0.08 + Math.random() * 0.12;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    line.userData = { isCityArc: true, phase: Math.random() * Math.PI * 2, baseOpacity: mat.opacity };
    arcGroup.add(line);
  });

  scene.add(arcGroup);
}

function removeCityArcs() {
  if (arcGroup) {
    scene.remove(arcGroup);
    if (arcGroup.children) arcGroup.children.length = 0;
    arcGroup = null;
  }
}

function updateCityArcsPulse(t) {
  if (!arcGroup) return;
  arcGroup.children.forEach(line => {
    if (!line.userData || !line.userData.isCityArc || !line.material) return;
    line.material.opacity = line.userData.baseOpacity * (0.6 + 0.4 * Math.sin(t * 1.4 + line.userData.phase));
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
  buildCityArcs(HOME_CITY);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  CITIES.forEach(city => {
    const pos = latLngToPosition(city.lat, city.lng, EARTH_RADIUS);

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(MARKER_RADIUS, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00f3ff })
    );
    marker.position.copy(pos);
    marker.userData = { cityName: city.name, isMarker: true };
    scene.add(marker);
    markers.push(marker);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(MARKER_RADIUS * 2.5, 12, 12), glowMat);
    glow.position.copy(pos);
    scene.add(glow);

    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending,
    });
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(MARKER_RADIUS * 4, 12, 12), pulseMat);
    pulse.position.copy(pos);
    scene.add(pulse);

    markerObjs.push({ city, marker, glow, glowMat, pulse, pulseMat });
    scene.add(createLabel(city));
  });

  renderer.domElement.style.pointerEvents = 'auto';
  renderer.domElement.addEventListener('click', onGlobeClick);
  renderer.domElement.addEventListener('mousemove', onGlobeMove);
  renderer.domElement.addEventListener('mouseleave', () => { hoverMarker = null; });

  document.getElementById('globe-loading').classList.add('hidden');

  const countEl = document.getElementById('globe-city-count');
  if (countEl) countEl.textContent = CITIES.length + ' CITIES TRACKED';

  const dbCountEl = document.getElementById('globe-db-count');
  if (dbCountEl) dbCountEl.textContent = CITIES.length + ' CITIES';

  refreshAllWeather();
  weatherInterval = setInterval(refreshAllWeather, 300000);

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now() / 1000;
  if (isAnimating) animateZoom();
  if (cloudLayer) cloudLayer.rotation.y += 0.0003;
  if (atmosphere) atmosphere.rotation.y += 0.0005;
  updateSatellites();
  updateCityArcsPulse(now);
  animateMarkers(now);
  updateLabelLod();
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
  if (labelRenderer && scene && camera) labelRenderer.render(scene, camera);
}

function animateMarkers(t) {
  markerObjs.forEach((m, i) => {
    const wave = Math.sin(t * 1.6 + i * 0.35);
    m.pulse.scale.setScalar(1 + 0.6 * wave);
    m.pulseMat.opacity = 0.05 + 0.05 * (1 + wave) / 2;

    const isActive = m.marker === hoverMarker || (selectedCity && selectedCity.name === m.city.name);
    if (isActive) {
      m.glow.scale.setScalar(1.7);
      m.glowMat.opacity = 0.35;
      m.marker.material.color.setHex(selectedCity && selectedCity.name === m.city.name ? 0x9d4edd : 0xffffff);
    } else {
      m.glow.scale.setScalar(1);
      m.glowMat.opacity = 0.2;
      m.marker.material.color.setHex(0x00f3ff);
    }
  });
}

function updateLabelLod() {
  if (!camera) return;
  const compact = camera.position.length() > 9;
  if (compact === labelLodCompact) return;
  labelLodCompact = compact;
  CITIES.forEach(city => {
    const el = labelElements[city.name];
    if (el && el.div) el.div.classList.toggle('compact', compact);
  });
}

function onGlobeMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(markers);
  if (intersects.length > 0) {
    renderer.domElement.style.cursor = 'pointer';
    hoverMarker = intersects[0].object;
  } else {
    renderer.domElement.style.cursor = 'grab';
    hoverMarker = null;
  }
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
  } else if (selectedCity) {
    resetToGlobal();
  }
}

function zoomToCity(city) {
  selectedCity = city;
  controls.autoRotate = false;
  const btn = document.getElementById('btn-globe-rotate');
  if (btn) { btn.classList.remove('active'); const ind = btn.querySelector('.indicator'); if (ind) ind.style.background = '#555'; }
  buildCityArcs(city);
  const targetPos = latLngToPosition(city.lat, city.lng, EARTH_RADIUS);
  animTarget = {
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: targetPos.clone().multiplyScalar(ZOOM_DISTANCE / EARTH_RADIUS),
    toTarget: targetPos.clone(),
    progress: 0,
  };
  isAnimating = true;
  updateCityDetail(city);
}

function animateZoom() {
  if (!animTarget || !isAnimating) return;
  animTarget.progress += ANIMATION_SPEED;
  const t = Math.min(animTarget.progress, 1);
  const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  camera.position.lerpVectors(animTarget.fromPos, animTarget.toPos, ease);
  controls.target.lerpVectors(animTarget.fromTarget, animTarget.toTarget, ease);
  if (t >= 1) { isAnimating = false; animTarget = null; }
}

function resetToGlobal() {
  selectedCity = null;
  isAnimating = false;
  animTarget = null;
  controls.autoRotate = autoRotate;
  buildCityArcs(HOME_CITY);
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
    if (detailPanel) detailPanel.classList.add('hidden');
    defaultPanel.classList.remove('hidden');
  }

  const searchInput = document.getElementById('globe-city-search');
  if (searchInput) searchInput.value = '';
  renderCitySearchResults('');
}

function setStat(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateCityDetail(city) {
  const data = cityData[city.name] || getDefaultWeather();
  const timeInfo = getCityTime(city.tz);

  setStat('city-detail-name', city.name + ', ' + city.country);
  setStat('city-detail-date', timeInfo.date);
  setStat('city-detail-time', timeInfo.time);

  let icon = data.icon;
  let dayNightLabel = 'DAYTIME';
  if (data.isDay === 0 || data.isDay === false) {
    dayNightLabel = 'NIGHT';
    if (NIGHT_ICONS[icon]) icon = NIGHT_ICONS[icon];
  }
  const iconEl = document.getElementById('city-detail-icon');
  if (iconEl) iconEl.innerHTML = '<i class="fas ' + icon + '" style="font-size:32px"></i>';
  setStat('city-detail-temp', data.temperature + '°C');
  setStat('city-detail-desc', data.description);
  setStat('city-detail-dn', dayNightLabel);
  setStat('city-detail-feels', (data.feels != null ? data.feels : '--') + '°C');
  setStat('city-detail-humidity', data.humidity);
  setStat('city-detail-wind', (data.windSpeed != null ? data.windSpeed : '--') + (data.windDir && data.windDir !== '--' ? ' · ' + data.windDir : ''));
  setStat('city-detail-pressure', data.pressure || '--');
  setStat('city-detail-uv', data.uv || '--');
  setStat('city-detail-sunrise', data.sunrise || '--:--');
  setStat('city-detail-sunset', data.sunset || '--:--');
  setStat('city-detail-tz', city.tz);
  const latDir = city.lat >= 0 ? 'N' : 'S';
  const lngDir = city.lng >= 0 ? 'E' : 'W';
  setStat('city-detail-coords', Math.abs(city.lat).toFixed(1) + '°' + latDir + ', ' + Math.abs(city.lng).toFixed(1) + '°' + lngDir);

  renderCityMiniForecast(data.forecast);

  const detailPanel = document.getElementById('globe-city-detail');
  const defaultPanel = document.getElementById('globe-default-controls');
  if (detailPanel && defaultPanel) {
    detailPanel.classList.remove('hidden', 'collapsing', 'expanding');
    defaultPanel.classList.add('hidden');
    const searchInput = document.getElementById('globe-city-search');
    if (searchInput) searchInput.value = city.name;
    renderCitySearchResults('');
  }
}

function cardDay(index, timeStr) {
  if (index === 0) return 'OGGI';
  const d = new Date(String(timeStr) + 'T12:00:00');
  if (isNaN(d.getTime())) return 'G' + (index + 1);
  return d.toLocaleDateString('it-IT', { weekday: 'short' }).toUpperCase();
}

function renderCityMiniForecast(forecast) {
  const container = document.getElementById('city-forecast');
  if (!container) return;
  container.innerHTML = '';
  const list = (forecast && Array.isArray(forecast)) ? forecast : [];
  if (list.length === 0) {
    container.innerHTML = '<div style="padding:6px 8px;font-size:9px;color:rgba(255,255,255,0.3);">FORECAST: LOADING...</div>';
    return;
  }
  list.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'forecast-day';
    el.innerHTML = `
      <span class="fw-day">${cardDay(i, f.day)}</span>
      <span class="fw-icon"><i class="fas ${f.icon}"></i></span>
      <span class="fw-temps">
        <span class="fw-max">${f.max}°</span>
        <span class="fw-min">${f.min}°</span>
      </span>
      <span class="fw-precip">${f.prob > 0 ? '<i class="fas fa-tint"></i> ' + f.prob + '%' : ''}</span>
    `;
    container.appendChild(el);
  });
}

function renderCitySearchResults(query) {
  const resultsEl = document.getElementById('globe-city-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  const q = (query || '').trim().toLowerCase();
  if (!q) { resultsEl.classList.add('hidden'); return; }
  const matches = CITIES.filter(c => (c.name + ' ' + c.country).toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) {
    resultsEl.classList.remove('hidden');
    const empty = document.createElement('div');
    empty.className = 'globe-city-result empty';
    empty.textContent = 'NO MATCH';
    resultsEl.appendChild(empty);
    return;
  }
  resultsEl.classList.remove('hidden');
  matches.forEach(c => {
    const item = document.createElement('div');
    item.className = 'globe-city-result';
    item.innerHTML = `<span class="gcr-name">${c.name}</span><span class="gcr-country">${c.country}</span>`;
    item.addEventListener('click', () => {
      zoomToCity(c);
      const si = document.getElementById('globe-city-search');
      if (si) si.value = c.name;
      renderCitySearchResults('');
    });
    resultsEl.appendChild(item);
  });
}

async function initMediaPipeHands() {
  const videoElement = document.getElementById('webcam');
  handsModule = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  handsModule.setOptions({
    maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6,
  });
  handsModule.onResults(onHandsResults);
  cameraModule = new Camera(videoElement, {
    onFrame: async () => { if (gestureTrackingEnabled && cameraRunning) await handsModule.send({ image: videoElement }); },
    width: 640, height: 480,
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
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17],
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
    const fingerMouse = new THREE.Vector2((indexTip.x * 2 - 1) * -1, -(indexTip.y * 2 - 1));
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
  if (controls && !selectedCity && !isAnimating) controls.autoRotate = autoRotate;
}

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
  if (window.electronAPI?.openEditor) window.electronAPI.openEditor();
}

document.addEventListener('DOMContentLoaded', function () {
  setTimeout(initGlobe, 100);

  document.getElementById('btn-globe-rotate').addEventListener('click', function () {
    autoRotate = !autoRotate;
    if (!handDetected) controls.autoRotate = autoRotate;
    this.classList.toggle('active');
    const ind = this.querySelector('.indicator');
    if (ind) ind.style.background = autoRotate ? '#00ff88' : '#555';
  });

  document.getElementById('btn-view-global').addEventListener('click', resetToGlobal);
  document.getElementById('btn-city-back').addEventListener('click', resetToGlobal);

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
      if (cameraModule && cameraRunning) { await cameraModule.stop(); cameraRunning = false; }
      addTickerEvent('globe', 'Hand gesture camera tracking suspended.');
      controls.autoRotate = autoRotate;
    } else {
      gestureStatus.textContent = 'NO HAND';
      gestureStatus.className = 'status-title';
      if (cameraModule && !cameraRunning) { await cameraModule.start(); cameraRunning = true; }
      else if (!cameraModule) { initMediaPipeHands().then(() => { cameraRunning = true; }); }
      addTickerEvent('globe', 'Hand gesture camera tracking restored.');
    }
  });

  const searchEl = document.getElementById('globe-city-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => renderCitySearchResults(searchEl.value));
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = searchEl.value.trim().toLowerCase();
        const match = CITIES.find(c => (c.name + ' ' + c.country).toLowerCase().includes(q));
        if (match) { zoomToCity(match); searchEl.value = match.name; renderCitySearchResults(''); }
      }
      if (e.key === 'Escape') { searchEl.value = ''; renderCitySearchResults(''); }
    });
    document.addEventListener('click', (e) => {
      const resultsEl = document.getElementById('globe-city-results');
      if (resultsEl && !searchEl.contains(e.target) && !resultsEl.contains(e.target)) {
        renderCitySearchResults('');
      }
    });
  }

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

  initLocalForecast();
});

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
  61: { icon: 'fa-cloud-rain', desc: 'Pioggia leggera' },
  63: { icon: 'fa-cloud-rain', desc: 'Pioggia moderata' },
  65: { icon: 'fa-cloud-showers-heavy', desc: 'Pioggia intensa' },
  71: { icon: 'fa-snowflake', desc: 'Neve leggera' },
  73: { icon: 'fa-snowflake', desc: 'Neve moderata' },
  75: { icon: 'fa-snowflake', desc: 'Neve intensa' },
  80: { icon: 'fa-cloud-showers-heavy', desc: 'Rovesci leggeri' },
  81: { icon: 'fa-cloud-showers-heavy', desc: 'Rovesci moderati' },
  82: { icon: 'fa-cloud-showers-heavy', desc: 'Rovesci violenti' },
  95: { icon: 'fa-bolt', desc: 'Temporale' },
  96: { icon: 'fa-bolt', desc: 'Temporale con grandine' },
  99: { icon: 'fa-bolt', desc: 'Temporale forte' },
};

function renderForecast(daily) {
  const container = document.getElementById('forecast-days');
  if (!container) return;
  container.innerHTML = '';
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