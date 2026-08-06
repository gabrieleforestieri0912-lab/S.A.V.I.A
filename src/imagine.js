/**
 * S.A.V.I.A - AI Image Generation (Pollinations.ai)
 */

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';
const TEXT_API = 'https://text.pollinations.ai';

let imgCount = 0;
const gallery = document.getElementById('img-gallery');
const promptInput = document.getElementById('img-prompt');
const modelSelect = document.getElementById('img-model');
const ratioSelect = document.getElementById('img-ratio');
const generateBtn = document.getElementById('img-generate');
const loadingEl = document.getElementById('img-loading');
const statCount = document.getElementById('img-stat-count');

async function generateImage() {
  const prompt = promptInput?.value?.trim();
  if (!prompt) return;

  const model = modelSelect?.value || 'flux';
  const ratio = ratioSelect?.value || '1024x1024';
  const [w, h] = ratio.split('x');

  generateBtn.disabled = true;
  generateBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> GENERATING...';
  loadingEl?.classList.remove('hidden');

  const encoded = encodeURIComponent(prompt);
  const url = `${POLLINATIONS_BASE}/${encoded}?width=${w}&height=${h}&model=${model}&nologo=true&seed=${Date.now()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const blob = await res.blob();
    const imgUrl = URL.createObjectURL(blob);

    imgCount++;
    if (statCount) statCount.textContent = `${imgCount} immagini`;
    addImageToGallery(imgUrl, prompt, model, w, h);

    promptInput.value = '';
    if (typeof playAudio === 'function') playAudio(audioBeep);
  } catch (e) {
    showError(`Errore generazione: ${e.message}`);
  }

  generateBtn.disabled = false;
  generateBtn.innerHTML = '<i class="fas fa-wand-magic"></i> GENERA';
  loadingEl?.classList.add('hidden');
}

async function enhancePrompt() {
  const prompt = promptInput?.value?.trim();
  if (!prompt) return;

  const originalBtnText = generateBtn.innerHTML;
  generateBtn.disabled = true;
  generateBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> ENHANCING...';

  try {
    const res = await fetch(`${TEXT_API}/${encodeURIComponent(
      `Arricchisci questo prompt per generazione immagini AI in inglese, dettagliato, mantenendo il senso originale. Restituisci SOLO il prompt arricchito, nient'altro: ${prompt}`
    )}`, {
      headers: { 'Content-Type': 'text/plain' }
    });
    if (res.ok) {
      const enhanced = await res.text();
      promptInput.value = enhanced.trim().replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* ignore */ }

  generateBtn.innerHTML = originalBtnText;
  generateBtn.disabled = false;
}

function addImageToGallery(url, prompt, model, w, h) {
  const card = document.createElement('div');
  card.className = 'img-card';
  card.innerHTML = `
    <div class="img-card-img-wrap">
      <img src="${url}" alt="${escHtml(prompt)}" loading="lazy" />
      <div class="img-card-overlay">
        <button class="img-card-dl" title="Scarica"><i class="fas fa-download"></i></button>
        <button class="img-card-copy" title="Copia prompt"><i class="fas fa-copy"></i></button>
      </div>
    </div>
    <div class="img-card-info">
      <span class="img-card-prompt">${escHtml(prompt.substring(0, 120))}${prompt.length > 120 ? '...' : ''}</span>
      <span class="img-card-meta">${model} // ${w}x${h}</span>
    </div>
  `;

  card.querySelector('.img-card-dl').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `savia-${Date.now()}.png`;
    a.click();
  });

  card.querySelector('.img-card-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(prompt);
    if (typeof addTickerEvent === 'function') addTickerEvent('sys', 'Prompt copiato negli appunti');
  });

  if (gallery) {
    const empty = gallery.querySelector('.img-empty');
    if (empty) empty.remove();
    gallery.insertBefore(card, gallery.firstChild);
  }
}

function showError(msg) {
  if (!gallery) return;
  const el = document.createElement('div');
  el.className = 'img-error';
  el.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${escHtml(msg)}`;
  gallery.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function escHtml(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}

// ── Event listeners ──

if (generateBtn) {
  generateBtn.addEventListener('click', generateImage);
}

if (promptInput) {
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      enhancePrompt();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      generateBtn?.click();
    }
  });

  const enhanceBtn = document.createElement('button');
  enhanceBtn.type = 'button';
  enhanceBtn.className = 'img-enhance-btn';
  enhanceBtn.innerHTML = '<i class="fas fa-wand-sparkles"></i>';
  enhanceBtn.title = 'Migliora prompt con AI (Ctrl+Enter)';
  enhanceBtn.addEventListener('click', enhancePrompt);
  promptInput.parentNode?.insertBefore(enhanceBtn, promptInput.nextSibling);
}

function openEditor() {
  if (window.electronAPI?.openEditor) {
    window.electronAPI.openEditor();
  }
}
