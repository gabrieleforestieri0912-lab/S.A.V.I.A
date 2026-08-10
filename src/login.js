const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusMsg = document.getElementById('statusMsg');
const statusDot = document.getElementById('statusDot');
const matchBar = document.getElementById('matchBar');
const matchPercent = document.getElementById('matchPercent');
const securityLevel = document.getElementById('securityLevel');
const lockIcon = document.getElementById('lockIcon');
const attemptDots = document.getElementById('attemptDots');
const bypassSection = document.getElementById('bypassSection');
const bypassBtn = document.getElementById('btnBypass');
const resetSection = document.getElementById('resetSection');
const resetBtn = document.getElementById('btnReset');

const MODEL_URL = 'models';

const MAX_ATTEMPTS = 5;
const BYPASS_TIMEOUT = 15000;

let modelsLoaded = false;
let isUnlocking = false;
let attemptsLeft = MAX_ATTEMPTS;
let scanInterval = null;
let canvasCtx = overlay.getContext('2d');
let animFrame = null;
let noFaceTimer = null;
let currentDisplaySize = null;

function forgotFaceData() {
  FaceTraining.clearProfile();
}

function updateClock() {
  const now = new Date();
  document.getElementById('clock-display').textContent = now.toTimeString().split(' ')[0];
}
setInterval(updateClock, 1000);
updateClock();

document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI?.windowMinimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI?.windowMaximize());
document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI?.windowClose());

document.getElementById('btn-train') || document.getElementById('btnTrain')?.addEventListener('click', () => {
  window.location.href = 'face-training.html';
});

bypassBtn.addEventListener('click', () => {
  setStatus('BYPASS MANUALE ATTIVATO', 'success');
  unlock();
});

resetBtn?.addEventListener('click', () => {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  forgotFaceData();
  attemptsLeft = MAX_ATTEMPTS;
  renderAttempts();
  resetSection.classList.remove('visible');
  if (bypassSection.classList.contains('visible')) {
    bypassSection.classList.remove('visible');
  }
  setStatus('PROFILO BIOMETRICO RESETTATO - POSIZIONA IL VOLTO', 'scanning');
  setMatch(0);
  setSecurityLevel(0);
  if (currentDisplaySize && !isUnlocking) {
    startFaceScanning(currentDisplaySize);
  }
});

function setStatus(text, state) {
  statusMsg.textContent = text;
  statusMsg.style.color = state === 'error' ? 'var(--accent-red)' : state === 'success' ? '#00ff88' : 'var(--accent-cyan)';
  statusDot.className = `status-dot ${state}`;
}

function setMatch(value) {
  const pct = Math.round(value * 100);
  matchPercent.textContent = `${pct}%`;
  matchBar.style.width = `${Math.min(pct, 100)}%`;
  matchBar.className = 'progress-fill ' + (
    pct >= 90 ? 'perfect' :
    pct >= 60 ? 'high' :
    pct >= 30 ? 'medium' : 'low'
  );
}

function setSecurityLevel(level) {
  const levels = ['ALPHA-0', 'ALPHA-1', 'ALPHA-2', 'ALPHA-3', 'ALPHA-4', 'ALPHA-5', 'BETA-6', 'BETA-7', 'GAMMA-8', 'GAMMA-9', 'DELTA-10'];
  const idx = Math.min(Math.floor(level * 10), levels.length - 1);
  securityLevel.textContent = levels[idx];
}

function renderAttempts() {
  attemptDots.innerHTML = '';
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const dot = document.createElement('span');
    dot.className = 'attempt-dot';
    if (i >= attemptsLeft) dot.classList.add('used');
    else dot.classList.add('remaining');
    attemptDots.appendChild(dot);
  }
}
renderAttempts();

function showBypass() {
  bypassSection.classList.add('visible');
}

function hideBypass() {
  bypassSection.classList.remove('visible');
}

function startNoFaceTimer() {
  clearNoFaceTimer();
  noFaceTimer = setTimeout(() => {
    if (!isUnlocking) {
      setStatus('ATTIVAZIONE BYPASS BIOMETRICO...', 'scanning');
      showBypass();
    }
  }, BYPASS_TIMEOUT);
}

function clearNoFaceTimer() {
  if (noFaceTimer) {
    clearTimeout(noFaceTimer);
    noFaceTimer = null;
  }
}

function startFaceScanning(displaySize) {
  currentDisplaySize = displaySize;
  scanInterval = setInterval(async () => {
    if (isUnlocking) {
      clearInterval(scanInterval);
      return;
    }

    try {
      const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({
        inputSize: 320,
        scoreThreshold: 0.5
      })).withFaceLandmarks().withFaceDescriptor();

      if (detection && detection.detection.score > 0.5) {
        startNoFaceTimer();
        drawCyberBox(detection, displaySize);
        drawLandmarks(detection.landmarks, displaySize);

        const profile = FaceTraining.loadProfile();

        if (!profile) {
          setStatus('PROFILO BIOMETRICO NON TROVATO - REGISTRAZIONE...', 'scanning');
          setMatch(detection.detection.score);
          setSecurityLevel(detection.detection.score);

          canvasCtx.font = '12px Orbitron';
          canvasCtx.fillStyle = 'rgba(0, 243, 255, 0.4)';
          canvasCtx.shadowColor = 'rgba(0, 243, 255, 0.3)';
          canvasCtx.shadowBlur = 6;
          canvasCtx.textAlign = 'center';
          canvasCtx.fillText('REGISTRAZIONE NUOVO VOLTO', displaySize.width / 2, 30);
          canvasCtx.shadowBlur = 0;

          drawMatchRing(detection.detection.score, displaySize);

          if (detection.detection.score > 0.7) {
            clearInterval(scanInterval);
            const descriptor = Array.from(detection.descriptor);
            const now = new Date().toISOString();
            FaceTraining.saveProfile({
              version: 2,
              subject: 'owner',
              engine: 'face-api.js@1.7.15',
              descriptor,
              sampleCount: 1,
              createdAt: now,
              updatedAt: now,
              quality: detection.detection.score
            });
            setStatus('PROFILO BIOMETRICO REGISTRATO', 'success');
            setMatch(1);
            setSecurityLevel(1);
            setTimeout(unlock, 1500);
          }
        } else {
          const result = FaceTraining.verify(detection.descriptor, profile);
          const distance = result.distance;
          const confidence = result.confidence;
          const match = result.match;

          setMatch(confidence);
          setSecurityLevel(confidence);
          drawMatchRing(confidence, displaySize);

          if (match) {
            setStatus('VOLTO RICONOSCIUTO. AUTENTICAZIONE...', 'success');
            clearInterval(scanInterval);
            setTimeout(unlock, 1000);
          } else {
            if (attemptsLeft > 0) {
              setStatus(`ACCESSO NEGATO - DISTANZA: ${distance.toFixed(3)}`, 'error');
              attemptsLeft--;
              renderAttempts();

              canvasCtx.font = '11px Orbitron';
              canvasCtx.fillStyle = 'rgba(255, 42, 95, 0.5)';
              canvasCtx.shadowColor = 'rgba(255, 42, 95, 0.4)';
              canvasCtx.shadowBlur = 8;
              canvasCtx.textAlign = 'center';
              canvasCtx.fillText('\u26D1 VOLTO SCONOSCIUTO', displaySize.width / 2, displaySize.height - 20);
              canvasCtx.shadowBlur = 0;

              if (attemptsLeft === 0) {
                setStatus('TROPPI TENTATIVI. BLOCCATO.', 'error');
                clearInterval(scanInterval);
                setTimeout(() => {
                  setStatus('BYPASS DI SICUREZZA', 'success');
                  unlock();
                }, 4000);
                return;
              }

              if (resetSection) resetSection.classList.add('visible');

              setTimeout(() => {
                if (!isUnlocking) {
                  setStatus('INQUADRA IL VISO NEL RILEVATORE', 'idle');
                }
              }, 2000);
            }
          }
        }
      } else {
        canvasCtx.clearRect(0, 0, overlay.width, overlay.height);
        if (resetSection) resetSection.classList.remove('visible');
        if (!isUnlocking && statusMsg.textContent !== 'INQUADRA IL VISO NEL RILEVATORE') {
          setStatus('INQUADRA IL VISO NEL RILEVATORE', 'idle');
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, 300);
}

function unlock() {
  if (isUnlocking) return;
  isUnlocking = true;

  clearNoFaceTimer();
  hideBypass();
  if (scanInterval) clearInterval(scanInterval);
  if (animFrame) cancelAnimationFrame(animFrame);
  if (resetSection) resetSection.classList.remove('visible');

  setStatus('ACCESSO CONSENTITO. BENTORNATO.', 'success');
  setMatch(1);
  setSecurityLevel(1);
  securityLevel.style.color = '#00ff88';
  if (lockIcon) {
    lockIcon.className = 'fas fa-lock-open';
    lockIcon.style.color = '#00ff88';
  }

  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach(t => t.stop());

  setTimeout(() => {
    if (window.electronAPI?.loginSuccess) {
      window.electronAPI.loginSuccess();
    } else {
      window.location.href = 'index.html';
    }
  }, 1500);
}

function drawCyberBox(detection, displaySize) {
  const box = detection.detection.box;
  const ctx = canvasCtx;
  const w = displaySize.width;
  const h = displaySize.height;

  const bx = (box.x / 640) * w;
  const by = (box.y / 480) * h;
  const bwidth = (box.width / 640) * w;
  const bheight = (box.height / 640) * h;

  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const glow = 'rgba(0, 243, 255, 0.08)';
  ctx.shadowColor = 'rgba(0, 243, 255, 0.3)';
  ctx.shadowBlur = 20;
  ctx.strokeStyle = 'rgba(0, 243, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bwidth, bheight);
  ctx.shadowBlur = 0;

  const cornerLen = Math.min(bwidth * 0.2, 30);
  ctx.strokeStyle = 'rgba(0, 243, 255, 0.7)';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(0, 243, 255, 0.5)';
  ctx.shadowBlur = 8;

  ctx.beginPath();
  ctx.moveTo(bx, by + cornerLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerLen, by);
  ctx.moveTo(bx + bwidth - cornerLen, by); ctx.lineTo(bx + bwidth, by); ctx.lineTo(bx + bwidth, by + cornerLen);
  ctx.moveTo(bx + bwidth, by + bheight - cornerLen); ctx.lineTo(bx + bwidth, by + bheight); ctx.lineTo(bx + bwidth - cornerLen, by + bheight);
  ctx.moveTo(bx + cornerLen, by + bheight); ctx.lineTo(bx, by + bheight); ctx.lineTo(bx, by + bheight - cornerLen);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawLandmarks(landmarks, displaySize) {
  const ctx = canvasCtx;
  const points = landmarks.positions;
  const w = displaySize.width;
  const h = displaySize.height;

  for (let i = 0; i < points.length; i++) {
    const px = (points[i].x / 640) * w;
    const py = (points[i].y / 480) * h;

    const alpha = 0.3 + (Math.sin(Date.now() / 200 + i) * 0.15);
    ctx.beginPath();
    ctx.arc(px, py, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 243, 255, ${alpha})`;
    ctx.shadowColor = 'rgba(0, 243, 255, 0.4)';
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawMatchRing(confidence, displaySize) {
  const ctx = canvasCtx;
  const cx = displaySize.width / 2;
  const cy = displaySize.height / 2 + 20;
  const radius = 40;

  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (Math.PI * 2 * Math.min(confidence, 1));
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, startAngle, endAngle);
  ctx.strokeStyle = confidence > 0.8 ? '#00ff88' : confidence > 0.5 ? 'var(--accent-gold)' : 'var(--accent-red)';
  ctx.lineWidth = 2;
  ctx.shadowColor = confidence > 0.8 ? 'rgba(0,255,136,0.5)' : 'rgba(0,243,255,0.3)';
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

async function init() {
  try {
    setStatus('CARICAMENTO RETI NEURALI...', 'idle');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    modelsLoaded = true;
    setStatus('ACCENSIONE SENSORI OTTICI...', 'idle');
    startVideo();
  } catch (error) {
    console.error(error);
    setStatus('ERRORE MODELLI - BYPASS IN 3s', 'error');
    setMatch(0);
    clearNoFaceTimer();
    setTimeout(() => {
      setStatus('BYPASS DI EMERGENZA', 'success');
      unlock();
    }, 3000);
  }
}

function startVideo() {
  navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } })
    .then(stream => {
      video.srcObject = stream;
    })
    .catch(() => {
      setStatus('NESSUNA VIDEOCAMERA - BYPASS IN 3s', 'error');
      clearNoFaceTimer();
      setTimeout(unlock, 3000);
    });
}

video.addEventListener('play', () => {
  if (!modelsLoaded) return;

  setStatus('INQUADRA IL VISO NEL RILEVATORE', 'idle');

  overlay.width = video.clientWidth || 480;
  overlay.height = video.clientHeight || 360;
  const displaySize = { width: overlay.width, height: overlay.height };
  faceapi.matchDimensions(overlay, displaySize);

  startNoFaceTimer();
  startFaceScanning(displaySize);
});

if (document.readyState === 'complete') {
  init();
} else {
  window.addEventListener('load', init);
}
