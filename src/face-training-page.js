/**
 * S.A.V.I.A - Face Training page controller
 * Driver della procedura guidata di addestramento (face-training.html).
 * Usa il modulo FaceTraining (face-training.js).
 */

const videoEl = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusMsg = document.getElementById('statusMsg');
const statusDot = document.getElementById('statusDot');
const sampleBar = document.getElementById('sampleBar');
const samplePct = document.getElementById('samplePct');
const qualityBar = document.getElementById('qualityBar');
const qualityPct = document.getElementById('qualityPct');
const profileState = document.getElementById('profileState');
const startBtn = document.getElementById('btnStart');
const resetBtn = document.getElementById('btnReset');
const doneBtn = document.getElementById('btnDone');

const ENROLL_COUNT = 12;
const canvasCtx = overlay.getContext('2d');
let training = false;

function setStatus(text, state) {
  statusMsg.textContent = text;
  statusMsg.style.color = state === 'error' ? 'var(--accent-red)' : state === 'success' ? '#00ff88' : 'var(--accent-cyan)';
  statusDot.className = 'status-dot ' + (state || 'idle');
}

function setBar(el, pct) {
  const p = Math.round(Math.max(0, Math.min(1, pct)) * 100);
  el.style.width = p + '%';
  el.className = 'progress-fill ' + (p >= 90 ? 'perfect' : p >= 60 ? 'high' : p >= 30 ? 'medium' : 'low');
  return p;
}

function updateClock() {
  const now = new Date();
  const el = document.getElementById('clock-display');
  if (el) el.textContent = now.toTimeString().split(' ')[0];
}
setInterval(updateClock, 1000);
updateClock();

document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI?.windowMinimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI?.windowMaximize());
document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI?.windowClose());

function renderProfile() {
  const profile = FaceTraining.loadProfile();
  if (!profile) {
    profileState.textContent = 'NON REGISTRATO';
    profileState.style.color = 'var(--accent-gold)';
    return;
  }
  profileState.textContent = `OWNER v${profile.version || 1} — ${profile.sampleCount || 1} CAMPIONI`;
  profileState.style.color = '#00ff88';
}

function resetUI() {
  setStatus('PRONTO AD ADDESTRARE', 'idle');
  setBar(sampleBar, 0);
  setBar(qualityBar, 0);
  samplePct.textContent = '0/' + ENROLL_COUNT;
  qualityPct.textContent = '0%';
}

function clearOverlay() {
  canvasCtx.clearRect(0, 0, overlay.width, overlay.height);
}

// Rendering live del rilevatore sull'overlay (mirrored come il video)
function drawDetection(det, displaySize) {
  canvasCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (!det) return;

  const box = det.detection.box;
  const w = displaySize.width;
  const h = displaySize.height;
  const bx = (box.x / 640) * w;
  const by = (box.y / 480) * h;
  const bwidth = (box.width / 640) * w;
  const bheight = (box.height / 640) * h;

  canvasCtx.strokeStyle = 'rgba(0, 243, 255, 0.35)';
  canvasCtx.lineWidth = 1;
  canvasCtx.strokeRect(bx, by, bwidth, bheight);

  const cornerLen = Math.min(bwidth * 0.2, 24);
  canvasCtx.strokeStyle = 'rgba(0, 243, 255, 0.75)';
  canvasCtx.lineWidth = 2;
  canvasCtx.beginPath();
  canvasCtx.moveTo(bx, by + cornerLen); canvasCtx.lineTo(bx, by); canvasCtx.lineTo(bx + cornerLen, by);
  canvasCtx.moveTo(bx + bwidth - cornerLen, by); canvasCtx.lineTo(bx + bwidth, by); canvasCtx.lineTo(bx + bwidth, by + cornerLen);
  canvasCtx.moveTo(bx + bwidth, by + bheight - cornerLen); canvasCtx.lineTo(bx + bwidth, by + bheight); canvasCtx.lineTo(bx + bwidth - cornerLen, by + bheight);
  canvasCtx.moveTo(bx + cornerLen, by + bheight); canvasCtx.lineTo(bx, by + bheight); canvasCtx.lineTo(bx, by + bheight - cornerLen);
  canvasCtx.stroke();

  if (det.landmarks) {
    const points = det.landmarks.positions;
    canvasCtx.fillStyle = 'rgba(0, 243, 255, 0.5)';
    for (let i = 0; i < points.length; i++) {
      canvasCtx.beginPath();
      canvasCtx.arc((points[i].x / 640) * w, (points[i].y / 480) * h, 1.5, 0, Math.PI * 2);
      canvasCtx.fill();
    }
  }
}

async function runTraining() {
  if (training) return;
  training = true;
  startBtn.disabled = true;

  try {
    setStatus('CARICAMENTO RETI NEURALI...', 'idle');
    await FaceTraining.loadModels();

    setStatus('ACCENSIONE SENSORI OTTICI...', 'idle');
    await FaceTraining.startCamera(videoEl);

    overlay.width = videoEl.clientWidth || 480;
    overlay.height = videoEl.clientHeight || 360;
    const displaySize = { width: overlay.width, height: overlay.height };

    setStatus('INQUADRA IL VOLTO NEL RILEVATORE', 'scanning');
    setBar(sampleBar, 0);
    samplePct.textContent = '0/' + ENROLL_COUNT;

    const samples = await FaceTraining.acquireSamples(videoEl, {
      count: ENROLL_COUNT,
      onFrame: (det) => drawDetection(det, displaySize),
      onProgress: ({ collected, total, quality, status }) => {
        samplePct.textContent = collected + '/' + total;
        setBar(sampleBar, collected / total);
        const q = setBar(qualityBar, quality);
        qualityPct.textContent = q + '%';
        if (status === 'searching') {
          setStatus('CERCO UN VOLTO VALIDO...', 'scanning');
        } else {
          setStatus('CATTURA CAMPIONE...', 'scanning');
        }
      }
    });

    const profile = FaceTraining.enroll(samples);
    FaceTraining.saveProfile(profile);

    clearOverlay();
    setStatus('TRAINING COMPLETATO. PROFILO SALVATO.', 'success');
    setBar(sampleBar, 1);
    renderProfile();
  } catch (e) {
    console.error(e);
    setStatus('ERRORE TRAINING: ' + (e.message || e), 'error');
  } finally {
    FaceTraining.stopCamera(videoEl);
    training = false;
    startBtn.disabled = false;
  }
}

resetBtn?.addEventListener('click', () => {
  if (training) return;
  FaceTraining.clearProfile();
  resetUI();
  renderProfile();
});

doneBtn?.addEventListener('click', () => {
  window.location.href = 'index.html';
});

startBtn?.addEventListener('click', () => {
  if (typeof playAudio === 'function') playAudio(audioClick);
  runTraining();
});

renderProfile();
resetUI();
