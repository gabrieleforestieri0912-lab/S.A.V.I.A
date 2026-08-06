/**
 * S.A.V.I.A - Neural Particles 3D Engine & MediaPipe Gesture Module
 */

let scene, camera, renderer, particles;
let handsModule, cameraModule;
let handDetected = false;
let lastHandPosition = null;
let pinchDistance = 0;
let rotationSpeed = { x: 0, y: 0 };
let scale = 1;
let velocity = 0;
let particlesInitialized = false;
let gestureTrackingEnabled = true;
let cameraRunning = false;

const particleSettings = {
  particleCount: 2000,
  particleSize: 0.02,
  baseColor: '#9d4edd',
  accentColor: '#00f3ff',
  rotationSensitivity: 5,
  scaleSensitivity: 15,
  autoRotate: true,
  shape: 'sphere'
};

let autoRotateEnabled = true;

async function startParticlesEngine() {
  try {
    initThreeScene();
    await initMediaPipeHands();
    setupParticleUIListeners();
    particlesInitialized = true;
    cameraRunning = true;
    addTickerEvent("[SYS] Particles Creator successfully active.");
  } catch (err) {
    console.error("Particles startup failure:", err);
    addTickerEvent("[SYS_ERR] Failed to start Particles hand engine.");
  }
}

function initThreeScene() {
  const container = document.getElementById('particles-canvas-container');
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.z = 5;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  createParticlesGeometry();

  window.addEventListener('resize', () => {
    if (!particlesInitialized) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  animateParticles();
}

function createParticlesGeometry() {
  if (particles) scene.remove(particles);

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleSettings.particleCount * 3);
  const colors = new Float32Array(particleSettings.particleCount * 3);

  const baseCol = new THREE.Color(particleSettings.baseColor);
  const accentCol = new THREE.Color(particleSettings.accentColor);

  for (let i = 0; i < particleSettings.particleCount; i++) {
    const i3 = i * 3;
    let x, y, z;

    if (particleSettings.shape === 'sphere') {
      const radius = 2 + Math.random() * 0.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      x = radius * Math.sin(phi) * Math.cos(theta);
      y = radius * Math.sin(phi) * Math.sin(theta);
      z = radius * Math.cos(phi);
    } else if (particleSettings.shape === 'box') {
      x = (Math.random() - 0.5) * 4;
      y = (Math.random() - 0.5) * 4;
      z = (Math.random() - 0.5) * 4;
    } else {
      const radius = Math.random() * 3;
      const spinAngle = radius * 5;
      const branchAngle = (i % 3) * ((Math.PI * 2) / 3);
      x = Math.cos(spinAngle + branchAngle) * radius + (Math.random() - 0.5) * 0.5;
      y = (Math.random() - 0.5) * 0.5;
      z = Math.sin(spinAngle + branchAngle) * radius + (Math.random() - 0.5) * 0.5;
    }

    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    const lerpFactor = (x + 2) / 4;
    const mixedColor = baseCol.clone().lerp(accentCol, lerpFactor);
    colors[i3] = mixedColor.r;
    colors[i3 + 1] = mixedColor.g;
    colors[i3 + 2] = mixedColor.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: particleSettings.particleSize,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });

  particles = new THREE.Points(geometry, material);
  scene.add(particles);
}

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
  document.getElementById('particles-loading-spinner').classList.add('hidden');
  document.getElementById('particles-status-hud').classList.remove('hidden');
}

function onHandsResults(results) {
  const gestureStatus = document.getElementById('particles-gesture-status');
  const canvas = document.getElementById('canvas-overlay');
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-canvas.width, 0);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    handDetected = true;
    gestureStatus.textContent = "GESTURE SYNCED";
    gestureStatus.className = "status-title detected";

    const landmarks = results.multiHandLandmarks[0];
    drawHandConnections(ctx, landmarks, results.image);
    if (gestureTrackingEnabled) processHandGestures(landmarks);
  } else {
    handDetected = false;
    gestureStatus.textContent = "NO HAND";
    gestureStatus.className = "status-title";
    resetRotation();
  }
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
    [5, 9], [9, 13], [13, 17]
  ];

  ctx.strokeStyle = particleSettings.accentColor;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";

  connections.forEach(([start, end]) => {
    const s = landmarks[start], e = landmarks[end];
    ctx.beginPath();
    ctx.moveTo(s.x * canvas.width, s.y * canvas.height);
    ctx.lineTo(e.x * canvas.width, e.y * canvas.height);
    ctx.stroke();
  });

  ctx.fillStyle = "#ff2a5f";
  landmarks.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x * canvas.width, point.y * canvas.height, 5, 0, 2 * Math.PI);
    ctx.fill();
  });

  ctx.restore();
}

function processHandGestures(landmarks) {
  const indexTip = landmarks[8];
  const thumbTip = landmarks[4];
  const middleTip = landmarks[12];

  const handX = (indexTip.x + thumbTip.x + middleTip.x) / 3;
  const handY = (indexTip.y + thumbTip.y + middleTip.y) / 3;

  if (lastHandPosition) {
    const deltaX = handX - lastHandPosition.x;
    const deltaY = handY - lastHandPosition.y;
    rotationSpeed.x = deltaY * particleSettings.rotationSensitivity;
    rotationSpeed.y = deltaX * particleSettings.rotationSensitivity;
    velocity = Math.sqrt(deltaX*deltaX + deltaY*deltaY);
  }

  const distance = Math.sqrt(
    Math.pow(indexTip.x - thumbTip.x, 2) + Math.pow(indexTip.y - thumbTip.y, 2)
  );

  if (pinchDistance === 0) {
    pinchDistance = distance;
  } else {
    const scaleChange = (distance - pinchDistance) * particleSettings.scaleSensitivity;
    scale = Math.max(0.2, Math.min(5, scale + scaleChange * 0.02));
    pinchDistance = distance;
  }

  if (lastHandPosition) {
    const movement = Math.abs(handX - lastHandPosition.x) + Math.abs(handY - lastHandPosition.y);
    if (movement > 0.15) {
      playAudio(audioBeep);
      resetSphere();
      addTickerEvent("[SYS] Dynamic gesture flick: Particle sphere reset.");
    }
  }

  lastHandPosition = { x: handX, y: handY };
}

function resetRotation() {
  rotationSpeed.x *= 0.95;
  rotationSpeed.y *= 0.95;
  velocity *= 0.9;
}

function resetSphere() {
  scale = 1;
  if (particles) particles.rotation.set(0, 0, 0);
  rotationSpeed = { x: 0, y: 0 };
  pinchDistance = 0;
}

function animateParticles() {
  requestAnimationFrame(animateParticles);

  if (particles) {
    particles.rotation.x += rotationSpeed.x * 0.05;
    particles.rotation.y += rotationSpeed.y * 0.05;
    particles.scale.set(scale, scale, scale);

    if (handDetected) particles.rotation.z += velocity * 0.5;
    else if (autoRotateEnabled) particles.rotation.y += 0.005;
  }

  renderer.render(scene, camera);
}

function setupParticleUIListeners() {
  document.getElementById('particleCount').addEventListener('change', (e) => {
    playAudio(audioClick);
    particleSettings.particleCount = parseInt(e.target.value);
    createParticlesGeometry();
    addTickerEvent(`[SYS] Particle quantity changed: ${particleSettings.particleCount}`);
  });

  document.getElementById('shapeSelect').addEventListener('change', (e) => {
    playAudio(audioClick);
    particleSettings.shape = e.target.value;
    createParticlesGeometry();
    addTickerEvent(`[SYS] Spatial configuration changed: ${particleSettings.shape}`);
  });

  document.getElementById('particleSize').addEventListener('input', (e) => {
    particleSettings.particleSize = parseFloat(e.target.value);
    if (particles) particles.material.size = particleSettings.particleSize;
  });

  document.getElementById('baseColor').addEventListener('input', (e) => {
    particleSettings.baseColor = e.target.value;
    createParticlesGeometry();
  });

  document.getElementById('accentColor').addEventListener('input', (e) => {
    particleSettings.accentColor = e.target.value;
    createParticlesGeometry();
  });

  document.getElementById('btn-autoRotate').addEventListener('click', function() {
    playAudio(audioClick);
    autoRotateEnabled = !autoRotateEnabled;
    this.classList.toggle('active', autoRotateEnabled);
    const indicator = this.querySelector('.indicator');
    indicator.style.background = autoRotateEnabled ? '#00ff88' : '#555';
    indicator.style.boxShadow = autoRotateEnabled ? '0 0 6px #00ff88' : 'none';
  });

  document.getElementById('btn-gestures').addEventListener('click', async function() {
    playAudio(audioClick);
    gestureTrackingEnabled = !gestureTrackingEnabled;
    this.classList.toggle('active', gestureTrackingEnabled);
    const indicator = this.querySelector('.indicator');
    indicator.style.background = gestureTrackingEnabled ? '#00ff88' : '#555';
    indicator.style.boxShadow = gestureTrackingEnabled ? '0 0 6px #00ff88' : 'none';

    const gestureStatus = document.getElementById('particles-gesture-status');
    if (!gestureTrackingEnabled) {
      gestureStatus.textContent = "GESTURES SUSPENDED";
      gestureStatus.className = "status-title warning";
      handDetected = false;
      resetRotation();
      if (cameraModule && cameraRunning) {
        await cameraModule.stop();
        cameraRunning = false;
      }
      addTickerEvent('particles', "Hand gesture camera tracking suspended.");
    } else {
      gestureStatus.textContent = "NO HAND";
      gestureStatus.className = "status-title";
      if (cameraModule && !cameraRunning) {
        await cameraModule.start();
        cameraRunning = true;
      }
      addTickerEvent('particles', "Hand gesture camera tracking restored.");
    }
  });
}

// Auto-initialize on page load
setTimeout(() => {
  if (!particlesInitialized) {
    addTickerEvent("[SYS] Loading MediaPipe hands & WebGL engines...");
    startParticlesEngine();
  }
}, 100);

function openEditor() {
  if (window.electronAPI?.openEditor) {
    window.electronAPI.openEditor();
  }
}
