/**
 * S.A.V.I.A - Neural Particles 3D Scene Engine
 * Features: Particle system, 3D model loading, creation engine, gesture control, physics
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  let scene, camera, renderer, controls;
  let particles, particleGeometry, particleMaterial;
  let handsModule, cameraModule;
  let raycaster, mouse;
  let handDetected = false;
  let lastHandPosition = null;
  let pinchDistance = 0;
  let pinchActive = false;
  let rotationSpeed = { x: 0, y: 0 };
  let scale = 1;
  let velocity = 0;
  let particlesInitialized = false;
  let gestureTrackingEnabled = true;
  let cameraRunning = false;
  let autoRotateEnabled = true;
  let physicsEnabled = false;
  let wireframeMode = false;
  let creationMode = false;
  let gestureMode = 'rotate'; // rotate | create | delete | move

  // 3D Model state
  let loadedModel = null;
  let modelGroup = null;

  // Creation engine state
  let spawnedObjects = [];
  let spawnVelocities = new Map();
  let spawnShape = 'burst';
  let spawnCount = 100;
  let spawnVelocity = 3;
  let lastSpawnTime = 0;
  let spawnCooldown = 100; // ms between spawns

  // Scene objects for raycasting
  let sceneObjects = [];

  const particleSettings = {
    particleCount: 2000,
    particleSize: 0.02,
    particleOpacity: 0.85,
    baseColor: '#9d4edd',
    accentColor: '#00f3ff',
    rotationSensitivity: 5,
    scaleSensitivity: 15,
    autoRotate: true,
    shape: 'sphere'
  };

  // ── Init ───────────────────────────────────────────────────────────
  async function startParticlesEngine() {
    try {
      initThreeScene();
      await initMediaPipeHands();
      setupParticleUIListeners();
      setupModelUIListeners();
      setupCreationUIListeners();
      setupActionUIListeners();
      particlesInitialized = true;
      cameraRunning = true;
      addTickerEvent('particles', '3D Scene Engine initialized successfully.');
    } catch (err) {
      console.error('Particles startup failure:', err);
      addTickerEvent('warn', 'Failed to start 3D Scene engine: ' + err.message);
    }
  }

  // ── Three.js Scene ─────────────────────────────────────────────────
  function initThreeScene() {
    const container = document.getElementById('particles-canvas-container');

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0c12, 0.02);

    camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0c12, 1);
    container.appendChild(renderer.domElement);

    // OrbitControls for mouse interaction
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 1;
    controls.maxDistance = 50;

    // Raycaster for creation/deletion
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00f3ff, 1, 100);
    pointLight.position.set(5, 5, 5);
    scene.add(pointLight);

    const pointLight2 = new THREE.PointLight(0x9d4edd, 0.8, 100);
    pointLight2.position.set(-5, -3, 3);
    scene.add(pointLight2);

    // Model group
    modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // Create initial particles
    createParticlesGeometry();

    // Handle resize
    window.addEventListener('resize', onWindowResize);

    // Mouse click for creation mode
    renderer.domElement.addEventListener('click', onCanvasClick);

    // Start animation loop
    animateParticles();
  }

  function onWindowResize() {
    if (!particlesInitialized) return;
    const container = document.getElementById('particles-canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  // ── Particle Geometry ──────────────────────────────────────────────
  function createParticlesGeometry() {
    if (particles) {
      scene.remove(particles);
      particleGeometry.dispose();
      particleMaterial.dispose();
    }

    particleGeometry = new THREE.BufferGeometry();
    const count = particleSettings.particleCount;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const baseCol = new THREE.Color(particleSettings.baseColor);
    const accentCol = new THREE.Color(particleSettings.accentColor);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      let x, y, z;

      switch (particleSettings.shape) {
        case 'sphere': {
          const radius = 2 + Math.random() * 0.5;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          x = radius * Math.sin(phi) * Math.cos(theta);
          y = radius * Math.sin(phi) * Math.sin(theta);
          z = radius * Math.cos(phi);
          break;
        }
        case 'box':
          x = (Math.random() - 0.5) * 4;
          y = (Math.random() - 0.5) * 4;
          z = (Math.random() - 0.5) * 4;
          break;
        case 'galaxy': {
          const radius = Math.random() * 3;
          const spinAngle = radius * 5;
          const branchAngle = (i % 3) * ((Math.PI * 2) / 3);
          x = Math.cos(spinAngle + branchAngle) * radius + (Math.random() - 0.5) * 0.5;
          y = (Math.random() - 0.5) * 0.5;
          z = Math.sin(spinAngle + branchAngle) * radius + (Math.random() - 0.5) * 0.5;
          break;
        }
        case 'torus': {
          const R = 2.5;
          const r = 0.8;
          const u = Math.random() * Math.PI * 2;
          const v = Math.random() * Math.PI * 2;
          x = (R + r * Math.cos(v)) * Math.cos(u);
          y = (R + r * Math.cos(v)) * Math.sin(u);
          z = r * Math.sin(v);
          break;
        }
        case 'helix': {
          const t = (i / count) * Math.PI * 8;
          const radius2 = 1.5;
          x = radius2 * Math.cos(t);
          y = (i / count) * 6 - 3;
          z = radius2 * Math.sin(t);
          break;
        }
        case 'terrain': {
          x = (Math.random() - 0.5) * 6;
          z = (Math.random() - 0.5) * 6;
          y = Math.sin(x * 1.5) * Math.cos(z * 1.5) * 1.5 + (Math.random() - 0.5) * 0.3;
          break;
        }
        default: {
          const radius = 2 + Math.random() * 0.5;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          x = radius * Math.sin(phi) * Math.cos(theta);
          y = radius * Math.sin(phi) * Math.sin(theta);
          z = radius * Math.cos(phi);
        }
      }

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      const lerpFactor = (x + 3) / 6;
      const mixedColor = baseCol.clone().lerp(accentCol, Math.max(0, Math.min(1, lerpFactor)));
      colors[i3] = mixedColor.r;
      colors[i3 + 1] = mixedColor.g;
      colors[i3 + 2] = mixedColor.b;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    particleMaterial = new THREE.PointsMaterial({
      size: particleSettings.particleSize,
      vertexColors: true,
      transparent: true,
      opacity: particleSettings.particleOpacity,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      wireframe: wireframeMode,
    });

    particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);
    sceneObjects = [particles];
  }

  // ── 3D Model Loading ───────────────────────────────────────────────
  function clearModel() {
    if (loadedModel) {
      modelGroup.remove(loadedModel);
      loadedModel = null;
    }
    document.getElementById('model-info').classList.add('hidden');
    document.getElementById('model-transform-section').style.display = 'none';
    document.getElementById('modelSelect').value = 'none';
    addTickerEvent('particles', 'Model removed from scene.');
  }

  function createPrimitiveModel(type) {
    clearModel();

    let geometry, material;
    const modelMaterial = new THREE.MeshStandardMaterial({
      color: 0x9d4edd,
      metalness: 0.3,
      roughness: 0.4,
      wireframe: wireframeMode,
      transparent: true,
      opacity: 0.8,
    });

    switch (type) {
      case 'cube':
        geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(1, 32, 32);
        break;
      case 'torus':
        geometry = new THREE.TorusKnotGeometry(0.8, 0.3, 100, 16);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(0.8, 0.8, 2, 32);
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(0.8, 2, 32);
        break;
      case 'dodecahedron':
        geometry = new THREE.DodecahedronGeometry(1);
        break;
      case 'icosahedron':
        geometry = new THREE.IcosahedronGeometry(1);
        break;
      default:
        return;
    }

    loadedModel = new THREE.Mesh(geometry, modelMaterial);
    modelGroup.add(loadedModel);

    document.getElementById('model-info').classList.remove('hidden');
    document.getElementById('model-name').textContent = type.charAt(0).toUpperCase() + type.slice(1);
    document.getElementById('model-tris').textContent = (geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3).toFixed(0) + ' tris';
    document.getElementById('model-transform-section').style.display = '';

    addTickerEvent('particles', 'Primitive model created: ' + type);
  }

  function loadCustomModel(file) {
    clearModel();

    const extension = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    reader.onload = function (e) {
      const contents = e.target.result;

      if (extension === 'glb' || extension === 'gltf') {
        const loader = new THREE.GLTFLoader();
        loader.parse(contents, '', function (gltf) {
          loadedModel = gltf.scene;
          fitModelToScene(loadedModel);
          modelGroup.add(loadedModel);

          let triCount = 0;
          gltf.scene.traverse((child) => {
            if (child.isMesh && child.geometry) {
              triCount += child.geometry.index ? child.geometry.index.count / 3 : child.geometry.attributes.position.count / 3;
            }
          });

          document.getElementById('model-info').classList.remove('hidden');
          document.getElementById('model-name').textContent = file.name;
          document.getElementById('model-tris').textContent = triCount.toFixed(0) + ' tris';
          document.getElementById('model-transform-section').style.display = '';

          addTickerEvent('particles', 'GLTF model loaded: ' + file.name);
        }, function (error) {
          addTickerEvent('warn', 'Failed to load GLTF: ' + error.message);
        });
      } else if (extension === 'obj') {
        const loader = new THREE.OBJLoader();
        loadedModel = loader.parse(contents);
        fitModelToScene(loadedModel);
        modelGroup.add(loadedModel);

        let triCount = 0;
        loadedModel.traverse((child) => {
          if (child.isMesh && child.geometry) {
            triCount += child.geometry.index ? child.geometry.index.count / 3 : child.geometry.attributes.position.count / 3;
          }
        });

        document.getElementById('model-info').classList.remove('hidden');
        document.getElementById('model-name').textContent = file.name;
        document.getElementById('model-tris').textContent = triCount.toFixed(0) + ' tris';
        document.getElementById('model-transform-section').style.display = '';

        addTickerEvent('particles', 'OBJ model loaded: ' + file.name);
      }
    };

    if (extension === 'glb' || extension === 'gltf') {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

  function fitModelToScene(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scaleFactor = 3 / maxDim;
    model.scale.setScalar(scaleFactor);
    model.position.sub(center.multiplyScalar(scaleFactor));
  }

  // ── Creation Engine ────────────────────────────────────────────────
  function spawnParticlesFromHand(landmarks) {
    if (!creationMode) return;

    const now = Date.now();
    if (now - lastSpawnTime < spawnCooldown) return;
    lastSpawnTime = now;

    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];

    // Convert hand position to 3D world coordinates
    const handX = (1 - (indexTip.x + thumbTip.x) / 2) * 2 - 1; // mirror X
    const handY = -((indexTip.y + thumbTip.y) / 2) * 2 + 1;

    const vector = new THREE.Vector3(handX, handY, 0.5);
    vector.unproject(camera);
    const dir = vector.sub(camera.position).normalize();
    const distance = -camera.position.z / dir.z;
    const spawnPos = camera.position.clone().add(dir.multiplyScalar(distance * 0.8));

    spawnParticleCluster(spawnPos, spawnShape, spawnCount, spawnVelocity);
  }

  function spawnParticleCluster(position, shape, count, velocity) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];

    const baseCol = new THREE.Color(particleSettings.baseColor);
    const accentCol = new THREE.Color(particleSettings.accentColor);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      let x = 0, y = 0, z = 0;
      let vx = 0, vy = 0, vz = 0;

      switch (shape) {
        case 'burst': {
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const speed = velocity * (0.5 + Math.random() * 0.5);
          vx = speed * Math.sin(phi) * Math.cos(theta);
          vy = speed * Math.sin(phi) * Math.sin(theta);
          vz = speed * Math.cos(phi);
          break;
        }
        case 'ring': {
          const angle = Math.random() * Math.PI * 2;
          const speed = velocity;
          vx = Math.cos(angle) * speed;
          vy = 0;
          vz = Math.sin(angle) * speed;
          break;
        }
        case 'line': {
          const dir = Math.random() > 0.5 ? 1 : -1;
          vx = dir * velocity * Math.random();
          vy = (Math.random() - 0.5) * velocity * 0.2;
          vz = (Math.random() - 0.5) * velocity * 0.2;
          break;
        }
        case 'spray': {
          vx = (Math.random() - 0.5) * velocity * 2;
          vy = (Math.random() - 0.5) * velocity * 2;
          vz = (Math.random() - 0.5) * velocity * 2;
          break;
        }
        case 'trail': {
          vx = (Math.random() - 0.5) * velocity * 0.5;
          vy = velocity * 0.3;
          vz = (Math.random() - 0.5) * velocity * 0.5;
          break;
        }
      }

      positions[i3] = position.x + x;
      positions[i3 + 1] = position.y + y;
      positions[i3 + 2] = position.z + z;

      velocities.push(vx, vy, vz);

      const mixedColor = baseCol.clone().lerp(accentCol, Math.random());
      colors[i3] = mixedColor.r;
      colors[i3 + 1] = mixedColor.g;
      colors[i3 + 2] = mixedColor.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: particleSettings.particleSize * 1.5,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    const spawnGroup = new THREE.Points(geometry, material);
    spawnGroup.userData.lifetime = 0;
    spawnGroup.userData.maxLife = 3 + Math.random() * 2; // 3-5 seconds
    scene.add(spawnGroup);
    spawnedObjects.push(spawnGroup);
    spawnVelocities.set(spawnGroup.uuid, velocities);

    if (spawnedObjects.length > 20) {
      const old = spawnedObjects.shift();
      scene.remove(old);
      spawnVelocities.delete(old.uuid);
      old.geometry.dispose();
      old.material.dispose();
    }
  }

  function spawnOnCanvasClick(event) {
    if (!creationMode) return;

    const container = document.getElementById('particles-canvas-container');
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const spawnPos = new THREE.Vector3();
    raycaster.ray.at(5, spawnPos);

    spawnParticleCluster(spawnPos, spawnShape, spawnCount, spawnVelocity);
    playAudio(audioBeep);
    addTickerEvent('particles', 'Particles spawned at click position.');
  }

  function onCanvasClick(event) {
    spawnOnCanvasClick(event);
  }

  // ── Physics Update ─────────────────────────────────────────────────
  function updateSpawnedPhysics(dt) {
    const gravity = physicsEnabled ? -2.0 : 0;
    const drag = 0.98;

    for (let i = spawnedObjects.length - 1; i >= 0; i--) {
      const obj = spawnedObjects[i];
      obj.userData.lifetime += dt;

      if (obj.userData.lifetime > obj.userData.maxLife) {
        scene.remove(obj);
        spawnVelocities.delete(obj.uuid);
        obj.geometry.dispose();
        obj.material.dispose();
        spawnedObjects.splice(i, 1);
        continue;
      }

      // Fade out
      const fadeStart = obj.userData.maxLife * 0.7;
      if (obj.userData.lifetime > fadeStart) {
        const t = (obj.userData.lifetime - fadeStart) / (obj.userData.maxLife - fadeStart);
        obj.material.opacity = 1 - t;
      }

      // Apply velocity
      const velocities = spawnVelocities.get(obj.uuid);
      if (velocities) {
        const positions = obj.geometry.attributes.position.array;
        for (let j = 0; j < positions.length; j += 3) {
          const vi = j;
          positions[j] += velocities[vi] * dt;
          positions[j + 1] += (velocities[vi + 1] + gravity * obj.userData.lifetime) * dt;
          positions[j + 2] += velocities[vi + 2] * dt;

          velocities[vi] *= drag;
          velocities[vi + 1] *= drag;
          velocities[vi + 2] *= drag;
        }
        obj.geometry.attributes.position.needsUpdate = true;
      }
    }
  }

  // ── MediaPipe Hands ────────────────────────────────────────────────
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
      gestureStatus.textContent = gestureMode.toUpperCase() + ' MODE';
      gestureStatus.className = 'status-title detected';

      const landmarks = results.multiHandLandmarks[0];
      drawHandConnections(ctx, landmarks, results.image);

      if (gestureTrackingEnabled) {
        processHandGestures(landmarks);
        updateGestureLabel(landmarks);
      }
    } else {
      handDetected = false;
      gestureStatus.textContent = 'NO HAND';
      gestureStatus.className = 'status-title';
      document.getElementById('gesture-label').textContent = '';
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

    // Color based on gesture mode
    const modeColors = {
      rotate: particleSettings.accentColor,
      create: '#00ff88',
      delete: '#ff3c3c',
      move: '#ffc800'
    };
    ctx.strokeStyle = modeColors[gestureMode] || particleSettings.accentColor;
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

  // ── Gesture Detection ──────────────────────────────────────────────
  function detectGesture(landmarks) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    const wrist = landmarks[0];

    // Calculate finger extension (distance from wrist)
    const fingerTips = [indexTip, middleTip, ringTip, pinkyTip];
    const extendedCount = fingerTips.filter(tip => {
      const dist = Math.sqrt(
        Math.pow(tip.x - wrist.x, 2) +
        Math.pow(tip.y - wrist.y, 2) +
        Math.pow(tip.z - wrist.z, 2)
      );
      return dist > 0.15;
    }).length;

    // Pinch detection
    const pinchDist = Math.sqrt(
      Math.pow(indexTip.x - thumbTip.x, 2) +
      Math.pow(indexTip.y - thumbTip.y, 2)
    );

    if (pinchDist < 0.06) return 'pinch';
    if (extendedCount >= 3) return 'open';
    if (extendedCount <= 1) return 'fist';
    if (extendedCount === 2) return 'point';

    return 'neutral';
  }

  function updateGestureLabel(landmarks) {
    const gesture = detectGesture(landmarks);
    const labels = {
      pinch: 'PINCH — Scale/Zoom',
      open: 'OPEN PALM — Spawn Particles',
      fist: 'FIST — Delete Nearest',
      point: 'POINT — Aim & Move',
      neutral: 'NEUTRAL'
    };
    document.getElementById('gesture-label').textContent = labels[gesture] || '';
  }

  // ── Hand Gesture Processing ────────────────────────────────────────
  function processHandGestures(landmarks) {
    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];
    const middleTip = landmarks[12];

    const handX = (indexTip.x + thumbTip.x + middleTip.x) / 3;
    const handY = (indexTip.y + thumbTip.y + middleTip.y) / 3;

    const gesture = detectGesture(landmarks);

    // Mode-specific actions
    switch (gestureMode) {
      case 'rotate':
        handleRotateGesture(handX, handY);
        break;
      case 'create':
        if (gesture === 'open') {
          spawnParticlesFromHand(landmarks);
        }
        break;
      case 'delete':
        if (gesture === 'fist') {
          deleteNearestObject(landmarks);
        }
        break;
      case 'move':
        handleMoveGesture(landmarks, gesture);
        break;
    }

    // Pinch-to-scale works in all modes
    if (gesture === 'pinch') {
      const pinchDist = Math.sqrt(
        Math.pow(indexTip.x - thumbTip.x, 2) +
        Math.pow(indexTip.y - thumbTip.y, 2)
      );

      if (pinchActive) {
        const scaleChange = (pinchDist - pinchDistance) * particleSettings.scaleSensitivity;
        scale = Math.max(0.2, Math.min(5, scale + scaleChange * 0.02));
      }
      pinchDistance = pinchDist;
      pinchActive = true;
    } else {
      pinchActive = false;
    }

    lastHandPosition = { x: handX, y: handY };
  }

  function handleRotateGesture(handX, handY) {
    if (lastHandPosition) {
      const deltaX = handX - lastHandPosition.x;
      const deltaY = handY - lastHandPosition.y;
      rotationSpeed.x = deltaY * particleSettings.rotationSensitivity;
      rotationSpeed.y = deltaX * particleSettings.rotationSensitivity;
      velocity = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }
  }

  function handleMoveGesture(landmarks, gesture) {
    if (gesture !== 'point' || !lastHandPosition) return;

    const indexTip = landmarks[8];
    const handX = (1 - indexTip.x) * 2 - 1;
    const handY = -(indexTip.y) * 2 + 1;

    const vector = new THREE.Vector3(handX, handY, 0.5);
    vector.unproject(camera);
    const dir = vector.sub(camera.position).normalize();
    const distance = -camera.position.z / dir.z;
    const targetPos = camera.position.clone().add(dir.multiplyScalar(distance));

    // Move the loaded model
    if (loadedModel) {
      loadedModel.position.lerp(targetPos, 0.1);
    }
  }

  function deleteNearestObject(landmarks) {
    if (spawnedObjects.length === 0) return;

    const indexTip = landmarks[8];
    const handX = (1 - indexTip.x) * 2 - 1;
    const handY = -(indexTip.y) * 2 + 1;

    const vector = new THREE.Vector3(handX, handY, 0.5);
    vector.unproject(camera);
    const dir = vector.sub(camera.position).normalize();

    raycaster.set(camera.position, dir);
    const intersects = raycaster.intersectObjects(spawnedObjects);

    if (intersects.length > 0) {
      const obj = intersects[0].object;
      const idx = spawnedObjects.indexOf(obj);
      if (idx >= 0) {
        scene.remove(obj);
        spawnVelocities.delete(obj.uuid);
        obj.geometry.dispose();
        obj.material.dispose();
        spawnedObjects.splice(idx, 1);
        playAudio(audioBeep);
        addTickerEvent('particles', 'Object deleted by gesture.');
      }
    }
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
    pinchActive = false;
  }

  // ── Animation Loop ─────────────────────────────────────────────────
  let lastTime = 0;

  function animateParticles(time) {
    requestAnimationFrame(animateParticles);

    const dt = Math.min((time - lastTime) / 1000, 0.1) || 0.016;
    lastTime = time;

    // Update controls
    if (controls) controls.update();

    // Update particles
    if (particles) {
      particles.rotation.x += rotationSpeed.x * 0.05;
      particles.rotation.y += rotationSpeed.y * 0.05;
      particles.scale.set(scale, scale, scale);

      if (handDetected) {
        particles.rotation.z += velocity * 0.5;
      } else if (autoRotateEnabled) {
        particles.rotation.y += 0.005;
      }
    }

    // Update model rotation
    if (loadedModel && autoRotateEnabled) {
      loadedModel.rotation.y += 0.003;
    }

    // Update spawned objects physics
    updateSpawnedPhysics(dt);

    renderer.render(scene, camera);
  }

  // ── UI Listeners: Particles ────────────────────────────────────────
  function setupParticleUIListeners() {
    document.getElementById('particleCount').addEventListener('change', (e) => {
      playAudio(audioClick);
      particleSettings.particleCount = parseInt(e.target.value);
      createParticlesGeometry();
      addTickerEvent('particles', 'Particle count: ' + particleSettings.particleCount);
    });

    document.getElementById('shapeSelect').addEventListener('change', (e) => {
      playAudio(audioClick);
      particleSettings.shape = e.target.value;
      createParticlesGeometry();
      addTickerEvent('particles', 'Shape: ' + particleSettings.shape);
    });

    document.getElementById('particleSize').addEventListener('input', (e) => {
      particleSettings.particleSize = parseFloat(e.target.value);
      if (particles) particles.material.size = particleSettings.particleSize;
    });

    document.getElementById('particleOpacity').addEventListener('input', (e) => {
      particleSettings.particleOpacity = parseFloat(e.target.value);
      if (particles) particles.material.opacity = particleSettings.particleOpacity;
    });

    document.getElementById('baseColor').addEventListener('input', (e) => {
      particleSettings.baseColor = e.target.value;
      createParticlesGeometry();
    });

    document.getElementById('accentColor').addEventListener('input', (e) => {
      particleSettings.accentColor = e.target.value;
      createParticlesGeometry();
    });

    document.getElementById('btn-autoRotate').addEventListener('click', function () {
      playAudio(audioClick);
      autoRotateEnabled = !autoRotateEnabled;
      this.classList.toggle('active', autoRotateEnabled);
      const indicator = this.querySelector('.indicator');
      indicator.style.background = autoRotateEnabled ? '#00ff88' : '#555';
      indicator.style.boxShadow = autoRotateEnabled ? '0 0 6px #00ff88' : 'none';
    });

    document.getElementById('btn-gestures').addEventListener('click', async function () {
      playAudio(audioClick);
      gestureTrackingEnabled = !gestureTrackingEnabled;
      this.classList.toggle('active', gestureTrackingEnabled);
      const indicator = this.querySelector('.indicator');
      indicator.style.background = gestureTrackingEnabled ? '#00ff88' : '#555';
      indicator.style.boxShadow = gestureTrackingEnabled ? '0 0 6px #00ff88' : 'none';

      const gestureStatus = document.getElementById('particles-gesture-status');
      if (!gestureTrackingEnabled) {
        gestureStatus.textContent = 'GESTURES SUSPENDED';
        gestureStatus.className = 'status-title warning';
        handDetected = false;
        resetRotation();
        if (cameraModule && cameraRunning) {
          await cameraModule.stop();
          cameraRunning = false;
        }
        addTickerEvent('particles', 'Camera gestures suspended.');
      } else {
        gestureStatus.textContent = 'NO HAND';
        gestureStatus.className = 'status-title';
        if (cameraModule && !cameraRunning) {
          await cameraModule.start();
          cameraRunning = true;
        }
        addTickerEvent('particles', 'Camera gestures restored.');
      }
    });

    document.getElementById('btn-physics').addEventListener('click', function () {
      playAudio(audioClick);
      physicsEnabled = !physicsEnabled;
      this.classList.toggle('active', physicsEnabled);
      const indicator = this.querySelector('.indicator');
      indicator.style.background = physicsEnabled ? '#00ff88' : '#555';
      indicator.style.boxShadow = physicsEnabled ? '0 0 6px #00ff88' : 'none';
      addTickerEvent('particles', 'Particle physics: ' + (physicsEnabled ? 'ON' : 'OFF'));
    });

    document.getElementById('btn-wireframe').addEventListener('click', function () {
      playAudio(audioClick);
      wireframeMode = !wireframeMode;
      this.classList.toggle('active', wireframeMode);
      const indicator = this.querySelector('.indicator');
      indicator.style.background = wireframeMode ? '#00ff88' : '#555';
      indicator.style.boxShadow = wireframeMode ? '0 0 6px #00ff88' : 'none';
      if (particles) particles.material.wireframe = wireframeMode;
      if (loadedModel) loadedModel.material.wireframe = wireframeMode;
      addTickerEvent('particles', 'Wireframe: ' + (wireframeMode ? 'ON' : 'OFF'));
    });
  }

  // ── UI Listeners: Models ───────────────────────────────────────────
  function setupModelUIListeners() {
    document.getElementById('modelSelect').addEventListener('change', function () {
      playAudio(audioClick);
      const value = this.value;
      if (value === 'none') {
        clearModel();
      } else if (value === 'custom') {
        document.getElementById('modelFileInput').click();
      } else {
        createPrimitiveModel(value);
      }
    });

    document.getElementById('modelFileInput').addEventListener('change', function (e) {
      if (e.target.files.length > 0) {
        loadCustomModel(e.target.files[0]);
      }
      this.value = '';
    });

    // Drag & drop
    const uploadArea = document.getElementById('model-upload-area');
    const container = document.getElementById('particles-canvas-container');

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('hidden');
    });

    container.addEventListener('dragleave', () => {
      uploadArea.classList.add('hidden');
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.add('hidden');
      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (/\.(glb|gltf|obj)$/i.test(file.name)) {
          loadCustomModel(file);
        }
      }
    });

    document.getElementById('btn-remove-model').addEventListener('click', () => {
      playAudio(audioClick);
      clearModel();
    });

    // Model transform sliders
    ['modelPosX', 'modelPosY', 'modelPosZ'].forEach(id => {
      document.getElementById(id).addEventListener('input', (e) => {
        if (!loadedModel) return;
        const axis = id.replace('modelPos', '').toLowerCase();
        loadedModel.position[axis] = parseFloat(e.target.value);
      });
    });

    document.getElementById('modelScale').addEventListener('input', (e) => {
      if (!loadedModel) return;
      loadedModel.scale.setScalar(parseFloat(e.target.value));
    });

    document.getElementById('modelRotY').addEventListener('input', (e) => {
      if (!loadedModel) return;
      loadedModel.rotation.y = parseFloat(e.target.value);
    });
  }

  // ── UI Listeners: Creation ─────────────────────────────────────────
  function setupCreationUIListeners() {
    // Gesture mode buttons
    document.querySelectorAll('.gesture-mode-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        playAudio(audioClick);
        gestureMode = this.dataset.mode;
        document.querySelectorAll('.gesture-mode-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        addTickerEvent('particles', 'Gesture mode: ' + gestureMode.toUpperCase());
      });
    });

    document.getElementById('btn-creation-mode').addEventListener('click', function () {
      playAudio(audioClick);
      creationMode = !creationMode;
      this.classList.toggle('active', creationMode);
      const indicator = this.querySelector('.indicator');
      indicator.style.background = creationMode ? '#00ff88' : '#555';
      indicator.style.boxShadow = creationMode ? '0 0 6px #00ff88' : 'none';

      const hud = document.getElementById('creation-mode-hud');
      hud.classList.toggle('hidden', !creationMode);

      addTickerEvent('particles', 'Creation mode: ' + (creationMode ? 'ON' : 'OFF'));
    });

    document.getElementById('spawnShape').addEventListener('change', function () {
      spawnShape = this.value;
      addTickerEvent('particles', 'Spawn shape: ' + spawnShape);
    });

    document.getElementById('spawnCount').addEventListener('input', function () {
      spawnCount = parseInt(this.value);
    });

    document.getElementById('spawnVelocity').addEventListener('input', function () {
      spawnVelocity = parseFloat(this.value);
    });
  }

  // ── UI Listeners: Actions ──────────────────────────────────────────
  function setupActionUIListeners() {
    document.getElementById('btn-reset-scene').addEventListener('click', function () {
      playAudio(audioClick);
      // Clear spawned objects
      spawnedObjects.forEach(obj => {
        scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
      });
      spawnedObjects = [];
      spawnVelocities.clear();

      // Reset particles
      resetSphere();
      createParticlesGeometry();

      // Clear model
      clearModel();

      // Reset camera
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);
      if (controls) controls.reset();

      addTickerEvent('particles', 'Scene reset complete.');
    });

    document.getElementById('btn-export-scene').addEventListener('click', function () {
      playAudio(audioClick);
      exportSceneAsOBJ();
    });

    document.getElementById('btn-screenshot').addEventListener('click', function () {
      playAudio(audioClick);
      takeScreenshot();
    });
  }

  // ── Export & Screenshot ────────────────────────────────────────────
  function exportSceneAsOBJ() {
    if (!loadedModel || !loadedModel.isMesh) {
      addTickerEvent('warn', 'No mesh model to export. Load a model first.');
      return;
    }

    let objContent = '# S.A.V.I.A. Exported Model\n';
    const geometry = loadedModel.geometry;
    const positions = geometry.attributes.position.array;

    for (let i = 0; i < positions.length; i += 3) {
      objContent += `v ${positions[i].toFixed(6)} ${positions[i + 1].toFixed(6)} ${positions[i + 2].toFixed(6)}\n`;
    }

    if (geometry.index) {
      for (let i = 0; i < geometry.index.array.length; i += 3) {
        const a = geometry.index.array[i] + 1;
        const b = geometry.index.array[i + 1] + 1;
        const c = geometry.index.array[i + 2] + 1;
        objContent += `f ${a} ${b} ${c}\n`;
      }
    }

    const blob = new Blob([objContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'savia_scene_export.obj';
    a.click();
    URL.revokeObjectURL(url);
    addTickerEvent('particles', 'Scene exported as OBJ.');
  }

  function takeScreenshot() {
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = 'savia_particles_screenshot_' + Date.now() + '.png';
    a.click();
    addTickerEvent('particles', 'Screenshot saved.');
  }

  // ── Auto-initialize ────────────────────────────────────────────────
  setTimeout(() => {
    if (!particlesInitialized) {
      addTickerEvent('particles', 'Loading 3D Scene Engine...');
      startParticlesEngine();
    }
  }, 100);

  window.openEditor = function () {
    if (window.electronAPI?.openEditor) {
      window.electronAPI.openEditor();
    }
  };

})();
