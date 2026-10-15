/**
 * S.A.V.I.A — Holographic Orb (JARVIS globe)
 * Globo olografico ambra/oro: particelle + anelli wireframe + nucleo.
 * Reagisce allo stato vocale/cognitivo tramite energia 0..1.
 *
 * API:
 *   window.saviaOrbSet('idle'|'listen'|'heard'|'capture'|'think'|'speak')
 *   window.saviaOrbPulse(v)   — impulso extra che decade da solo
 *   click sul globo = push-to-talk (se disponibile)
 *
 * Fallback: senza WebGL/Three.js mostra il reattore SVG classico.
 */
(function () {
  'use strict';

  const ENERGY_LEVELS = { idle: 0.12, listen: 0.3, heard: 0.45, capture: 0.55, think: 0.7, speak: 0.95 };
  let target = ENERGY_LEVELS.idle;
  let energy = ENERGY_LEVELS.idle;
  let pulse = 0;

  window.saviaOrbSet = function (mode) {
    target = (mode && ENERGY_LEVELS[mode] != null) ? ENERGY_LEVELS[mode] : ENERGY_LEVELS.idle;
  };
  window.saviaOrbPulse = function (v) {
    pulse = Math.min(1.2, pulse + (typeof v === 'number' ? v : 0.5));
  };

  const canvas = document.getElementById('savia-orb');
  const wrap = document.getElementById('savia-orb-wrap');
  const fallback = document.getElementById('reactor-fallback');

  function showFallback() {
    if (fallback) fallback.style.display = '';
    if (canvas) canvas.style.display = 'none';
  }

  if (!canvas || !wrap) return;

  function startOrb() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (e) { showFallback(); return; }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.15, 6);
  camera.lookAt(0, 0, 0);

  const AMBER = new THREE.Color('#ff9d1f');
  const GOLD = new THREE.Color('#ffe9a8');

  const world = new THREE.Group();
  scene.add(world);

  // ── Sfere di particelle (shader: pulsazione + scintillio) ──
  function fibSphere(n, r, sizeMin, sizeMax) {
    const pos = new Float32Array(n * 3);
    const rand = new Float32Array(n);
    const size = new Float32Array(n);
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = ga * i;
      pos[i * 3] = Math.cos(th) * rad * r;
      pos[i * 3 + 1] = y * r;
      pos[i * 3 + 2] = Math.sin(th) * rad * r;
      rand[i] = Math.random();
      size[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
    }
    return { pos, rand, size };
  }

  const pointUniforms = {
    uEnergy: { value: 0.12 },
    uTime: { value: 0 },
    uColorA: { value: AMBER },
    uColorB: { value: GOLD }
  };

  function makePoints(n, r, sizeMin, sizeMax, opacity) {    const d = fibSphere(n, r, sizeMin, sizeMax);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(d.rand, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(d.size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: pointUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: [
        'attribute float aRand;',
        'attribute float aSize;',
        'uniform float uEnergy;',
        'uniform float uTime;',
        'varying float vTw;',
        'void main() {',
        '  vec3 p = position;',
        '  float w = sin(uTime * 2.0 + aRand * 6.2831) * (0.015 + uEnergy * 0.11);',
        '  p += normalize(position + vec3(0.0001)) * w;',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  float tw = 0.7 + 0.3 * sin(uTime * 3.0 + aRand * 40.0);',
        '  vTw = tw;',
        '  gl_PointSize = aSize * tw * (1.0 + uEnergy * 0.9) * (26.0 / -mv.z);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColorA;',
        'uniform vec3 uColorB;',
        'uniform float uEnergy;',
        'varying float vTw;',
        'void main() {',
        '  vec2 c = gl_PointCoord - vec2(0.5);',
        '  float d = length(c);',
        '  if (d > 0.5) discard;',
        '  float glow = smoothstep(0.5, 0.05, d);',
        '  vec3 col = mix(uColorA, uColorB, clamp(vTw * 0.5 + uEnergy * 0.6, 0.0, 1.0));',
        '  gl_FragColor = vec4(col, glow * (0.16 + uEnergy * 0.5));',
        '}'
      ].join('\n')
    });
    const pts = new THREE.Points(g, m);
    m.opacity = opacity;
    return pts;
  }

  const outerPts = makePoints(1900, 1.38, 0.5, 1.4, 0.9);
  const innerPts = makePoints(900, 0.95, 0.4, 1.1, 0.95);
  world.add(outerPts);
  world.add(innerPts);

  // Scintille sparse nel volume
  (function addSparks() {
    const n = 260;
    const pos = new Float32Array(n * 3);
    const rand = new Float32Array(n);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = 1.0 + Math.random() * 0.9;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      rand[i] = Math.random();
      size[i] = 0.7 + Math.random() * 1.3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = outerPts.material.clone();
    m.uniforms = pointUniforms;
    world.add(new THREE.Points(g, m));
  })();

  // ── Anelli e bande wireframe ──
  const rings = new THREE.Group();
  world.add(rings);

  function ringMat(op) {
    return new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: op });
  }

  function circleLine(r, opacity) {
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, ringMat(opacity));
  }

  const ring1 = circleLine(1.72, 0.5); ring1.rotation.x = Math.PI * 0.42; rings.add(ring1);
  const ring2 = circleLine(1.96, 0.35); ring2.rotation.x = Math.PI * 0.58; ring2.rotation.y = 0.35; rings.add(ring2);
  const ring3 = circleLine(1.55, 0.3); ring3.rotation.y = Math.PI * 0.5; ring3.rotation.z = 0.5; rings.add(ring3);

  // Bande di latitudine
  const bands = new THREE.Group();
  world.add(bands);
  [-0.9, -0.45, 0, 0.45, 0.9].forEach(function (y, i) {
    const r = Math.sqrt(Math.max(0.05, 1.38 * 1.38 - y * y));
    const b = circleLine(r, 0.16 + (i === 2 ? 0.14 : 0));
    b.position.y = y;
    b.rotation.x = Math.PI / 2;
    bands.add(b);
  });

  // Archi meridianici
  for (let k = 0; k < 3; k++) {
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(1.38, 0.005, 6, 120, Math.PI * 1.25),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.35 })
    );
    arc.rotation.y = (k / 3) * Math.PI;
    arc.rotation.z = 0.4 + k * 0.35;
    rings.add(arc);
  }

  // ── Nucleo ──
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd98a'), wireframe: true, transparent: true, opacity: 0.85 })
  );
  world.add(core);

  // Alone dietro il globo
  const glowTex = (function () {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,190,80,0.32)');
    g.addColorStop(0.35, 'rgba(255,150,40,0.12)');
    g.addColorStop(1, 'rgba(255,150,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  glow.scale.set(3.6, 3.6, 1);
  scene.add(glow);

  // ── Resize ──
  function resize() {
    const w = wrap.clientWidth || 2;
    const h = wrap.clientHeight || 2;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const s = Math.max(0.4, Math.min(w, h) / 680);
    world.scale.setScalar(s);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
  window.addEventListener('resize', resize);
  resize();

  // Click = parla subito
  canvas.style.cursor = 'pointer';
  canvas.title = 'Tocca e parla';
  canvas.addEventListener('click', function () {
    if (typeof window.saviaVoiceTest === 'function') window.saviaVoiceTest();
  });

  // ── Loop ──
  const clock = new THREE.Clock();
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    energy += (target - energy) * Math.min(1, dt * 3.2);
    pulse = Math.max(0, pulse - dt * 1.4);
    const e = Math.min(1.25, energy + pulse);

    pointUniforms.uTime.value = t;
    pointUniforms.uEnergy.value = Math.min(1, e);

    const spin = 0.06 + e * 0.55;
    outerPts.rotation.y += dt * spin;
    outerPts.rotation.x = Math.sin(t * 0.12) * 0.12;
    innerPts.rotation.y -= dt * (spin * 0.7);
    innerPts.rotation.z += dt * 0.05;
    bands.rotation.y += dt * (0.03 + e * 0.2);
    ring1.rotation.z += dt * (0.05 + e * 0.35);
    ring2.rotation.z -= dt * (0.04 + e * 0.3);
    ring3.rotation.x += dt * 0.03;
    core.rotation.y += dt * (0.3 + e * 1.4);
    core.rotation.x += dt * 0.18;
    const cs = 1 + e * 0.22 + Math.sin(t * 5.0) * 0.02 * (0.3 + e);
    core.scale.setScalar(cs);

    rings.children.forEach(function (r) {
      if (r.material && r.material.opacity != null) {
        if (!r.userData.baseOp) r.userData.baseOp = r.material.opacity;
        r.material.opacity = Math.min(0.9, r.userData.baseOp * (0.55 + e * 0.9));
      }
    });

    glow.material.opacity = 0.12 + e * 0.25;
    const gs = 3.4 + e * 0.6;
    glow.scale.set(gs, gs, 1);

    // Respiro verticale dolce
    world.position.y = Math.sin(t * 0.8) * 0.03;

    renderer.render(scene, camera);
  }
  tick();
  }

  if (window.THREE) {
    try { startOrb(); } catch (e) { showFallback(); }
  } else {
    // Three.js caricato in async: attendi fino a 6s, poi fallback SVG
    let orbTries = 0;
    const orbTimer = setInterval(function () {
      if (window.THREE) {
        clearInterval(orbTimer);
        try { startOrb(); } catch (e) { showFallback(); }
      } else if (++orbTries > 40) {
        clearInterval(orbTimer);
        showFallback();
      }
    }, 150);
  }
})();
