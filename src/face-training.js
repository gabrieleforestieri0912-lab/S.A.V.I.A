/**
 * S.A.V.I.A - Face Training Pipeline
 *
 * Struttura l'addestramento biometrico del volto del proprietario.
 * A differenza dell'auto-enrollment legacy (singolo frame in login.js),
 * questo modulo raccoglie piu' campioni dal vivo, filtra i frame scadenti
 * e i valori anomali (outlier), e produce un PROFILO FACE v2 strutturato.
 *
 * Storage:
 *  - savia-face-profile   : profilo v2 (JSON strutturato)
 *  - savia-face-descriptor: legacy v1 (array descriptor), mantenuto per
 *    retrocompatibilita' con i lettori esistenti di login.js.
 *
 * Uso futuro: chiamare FaceTraining.enrollFromCamera(videoEl, onProgress)
 * in una procedura guidata dedicata. Il profilo risultante viene poi
 * verificato da login.js via FaceTraining.verify().
 */

const FACE_MODEL_URL = 'models';

const FACE_PROFILE_KEY = 'savia-face-profile';
const FACE_LEGACY_KEY = 'savia-face-descriptor';

// Thresholds / tuning (distance euclidea in spazio descriptor 128-d)
const FACE_MATCH_THRESHOLD = 0.55;    // < distanza  -> match positivo
const FACE_ENROLL_SAMPLES = 12;       // frame da collezionare per il training
const FACE_ENROLL_MIN_SCORE = 0.55;   // score minimo detector per accettare un frame
const FACE_ENROLL_MAX_SPREAD = 0.28;  // distanza massima dal running-mean (outlier)

const __delay = (ms) => new Promise(r => setTimeout(r, ms));

function meanVector(vecs) {
  const n = vecs.length;
  if (!n) return [];
  const out = new Array(vecs[0].length).fill(0);
  for (const v of vecs) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return out.map(x => x / n);
}

function euclidean(a, b) {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

// Rifiuta un campione se troppo distante dalla media dei campioni gia' raccolti.
function isOutlier(desc, collected) {
  if (collected.length < 3) return false;
  const mean = meanVector(collected);
  return euclidean(desc, mean) > FACE_ENROLL_MAX_SPREAD;
}

// Media robusta: media dei campioni rimasti dopo un giro di pulizia dagli outlier.
function robustMean(samples) {
  const mean = meanVector(samples);
  const kept = samples.filter(s => euclidean(s, mean) <= FACE_ENROLL_MAX_SPREAD);
  return (kept.length >= 1 ? meanVector(kept) : mean);
}

const FaceTraining = {
  loaded: false,

  async loadModels() {
    if (this.loaded) return true;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL)
    ]);
    this.loaded = true;
    return true;
  },

  async startCamera(videoEl) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false
    });
    videoEl.srcObject = stream;
    await new Promise((resolve) => {
      if (videoEl.readyState >= 2) return resolve();
      videoEl.onloadedmetadata = () => resolve();
    });
    await videoEl.play();
    return stream;
  },

  stopCamera(videoEl) {
    const stream = videoEl && videoEl.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (videoEl) videoEl.srcObject = null;
  },

  async detectFace(videoEl, opts) {
    return faceapi.detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({
      inputSize: (opts && opts.inputSize) || 320,
      scoreThreshold: (opts && opts.scoreThreshold) || 0.5
    })).withFaceLandmarks().withFaceDescriptor();
  },

  /**
   * Acquisizione: raccoglie N campioni dal video con controllo qualita'.
   * onProgress({ collected, total, quality, status }) - status in
   * ('searching'|'capturing').
   * onFrame(det) - chiamato a ogni frame processato (anche rifiutati)
   * con il risultato di detectFace, per il rendering live senza
   * doppia detection.
   */
  async acquireSamples(videoEl, { count = FACE_ENROLL_SAMPLES, onProgress, onFrame } = {}) {
    const samples = [];
    let lastQuality = 0;

    while (samples.length < count) {
      const det = await this.detectFace(videoEl);
      if (onFrame) onFrame(det);

      if (!det || det.detection.score < FACE_ENROLL_MIN_SCORE) {
        if (onProgress) onProgress({ collected: samples.length, total: count, quality: 0, status: 'searching' });
        await __delay(130);
        continue;
      }

      lastQuality = det.detection.score;
      const desc = Array.from(det.descriptor);
      if (!isOutlier(desc, samples.map(s => s.descriptor))) {
        samples.push({ descriptor: desc, score: det.detection.score });
      }

      if (onProgress) onProgress({ collected: samples.length, total: count, quality: lastQuality, status: 'capturing' });
      await __delay(180); // pacing: variazione di luce/posa tra i frame
    }

    return samples;
  },

  /**
   * Enroll: costruisce il profilo v2 dalla media robusta dei campioni.
   * samples e' l'output di acquireSamples: [{ descriptor, score }].
   */
  enroll(samples) {
    const descriptors = samples.map(s => s.descriptor);
    const descriptor = robustMean(descriptors);
    const quality = samples.reduce((acc, s) => acc + (s.score || 0), 0) / Math.max(1, samples.length);
    return {
      version: 2,
      subject: 'owner',
      engine: 'face-api.js@1.7.15',
      descriptor: Array.from(descriptor),
      sampleCount: samples.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      quality: quality
    };
  },

  saveProfile(profile) {
    localStorage.setItem(FACE_PROFILE_KEY, JSON.stringify(profile));
    // Legacy sync per i lettori v1 esistenti (es. login.js attuale)
    localStorage.setItem(FACE_LEGACY_KEY, JSON.stringify(profile.descriptor));
    return profile;
  },

  loadProfile() {
    const raw = localStorage.getItem(FACE_PROFILE_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p && p.descriptor) return p;
      } catch (e) { /* corrupt profile - fallback legacy */ }
    }
    const legacy = localStorage.getItem(FACE_LEGACY_KEY);
    if (legacy) {
      try {
        return { version: 1, subject: 'owner', descriptor: JSON.parse(legacy), createdAt: '', updatedAt: '', sampleCount: 1, quality: 0 };
      } catch (e) { /* ignore */ }
    }
    return null;
  },

  clearProfile() {
    localStorage.removeItem(FACE_PROFILE_KEY);
    localStorage.removeItem(FACE_LEGACY_KEY);
  },

  /**
   * Verifica un descriptor (Float32Array | number[]) contro un profilo.
   * Ritorna { match, distance, confidence }.
   */
  verify(descriptor, profile) {
    if (!profile || !profile.descriptor || !descriptor) {
      return { match: false, distance: Infinity, confidence: 0 };
    }
    const distance = euclidean(
      new Float32Array(Array.from(descriptor)),
      new Float32Array(Array.from(profile.descriptor))
    );
    const confidence = Math.max(0, Math.min(1, 1 - distance));
    return { match: distance < FACE_MATCH_THRESHOLD, distance, confidence };
  },

  /**
   * Pipeline completo end-to-end (comodita' per la procedura guidata).
   * Ritorna { profile, samples } oppure lancia un errore se non viene
   * rilevato alcun volto.
   */
  async enrollFromCamera(videoEl, onProgress) {
    await this.loadModels();
    await this.startCamera(videoEl);
    try {
      const samples = await this.acquireSamples(videoEl, { onProgress });
      const profile = this.enroll(samples);
      return { profile, samples };
    } finally {
      this.stopCamera(videoEl);
    }
  }
};

window.FaceTraining = FaceTraining;
