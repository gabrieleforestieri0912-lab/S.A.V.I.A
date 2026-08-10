/**
 * S.A.V.I.A - YouTube Data API v3 Integration Module
 */

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

let ytApiKey = localStorage.getItem('youtube-api-key') || 'AIzaSyDAFukRZiAr4DEwy_VVuhHzmAZehKFSGuA';
let ytSearchResults = [];
let ytNextPageToken = null;
let ytCurrentQuery = '';
let ytCurrentFilters = { order: 'relevance', duration: 'any', safeSearch: 'moderate' };
let ytSelectedVideo = null;
let ytCurrentChannelId = null;

const YT_CHANNELS = [
  { name: "L'Arte della Crescita Personale", lang: 'IT', cat: 'crescita personale' },
  { name: 'Luca Mazzucchelli', lang: 'IT', cat: 'psicologia, produttività' },
  { name: 'Dr. Filippo Ongaro', lang: 'IT', cat: 'salute, benessere' },
  { name: 'Dr. Enrico Gamba', lang: 'IT', cat: 'psicoterapia, consapevolezza' },
  { name: 'Massimo Giusti', lang: 'IT', cat: 'motivazione, mindset' },
  { name: 'Dialoghi interiori di Giulia Giordano', lang: 'IT', cat: 'psicologia, relazioni' },
  { name: 'Esplorando la Mente', lang: 'IT', cat: 'neuroscienze, psicologia' },
  { name: 'Dose Mentale', lang: 'IT', cat: 'autostima, resilienza' },
  { name: "Matt D'Avella", lang: 'EN', cat: 'minimalismo, produttività' },
  { name: 'Ali Abdaal', lang: 'EN', cat: 'produttività, crescita' },
  { name: 'Thomas Frank', lang: 'EN', cat: 'studio, organizzazione' },
  { name: 'Simon Sinek', lang: 'EN', cat: 'leadership, carriera' },
  { name: 'Jeff Su', lang: 'EN', cat: 'carriera, soft skills' },
  { name: 'Better Ideas', lang: 'EN', cat: 'self-improvement' },
  { name: 'Improvement Pill', lang: 'EN', cat: 'abitudini, motivazione' },
];

const ytSearchInput = document.getElementById('yt-search-input');
const ytSearchBtn = document.getElementById('yt-search-btn');
const ytFilterOrder = document.getElementById('yt-filter-order');
const ytFilterDuration = document.getElementById('yt-filter-duration');
const ytResultsContainer = document.getElementById('yt-results');
const ytDetailPanel = document.getElementById('yt-detail');
const ytDetailContent = document.getElementById('yt-detail-content');
const ytApiKeyInput = document.getElementById('yt-api-key');
const ytLoadMoreBtn = document.getElementById('yt-load-more');
const ytStatTotal = document.getElementById('yt-stat-total');
const ytStatQuery = document.getElementById('yt-stat-query');
const ytStatusDot = document.getElementById('yt-status-dot');
const ytStatusText = document.getElementById('yt-status-text');

function initYouTube() {
  if (ytApiKeyInput) {
    ytApiKeyInput.value = ytApiKey;
    ytApiKeyInput.addEventListener('change', () => {
      ytApiKey = ytApiKeyInput.value.trim();
      localStorage.setItem('youtube-api-key', ytApiKey);
      checkYtKey();
    });
  }

  if (ytSearchBtn) ytSearchBtn.addEventListener('click', () => doSearch());
  if (ytSearchInput) ytSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  if (ytFilterOrder) ytFilterOrder.addEventListener('change', () => { ytCurrentFilters.order = ytFilterOrder.value; });
  if (ytFilterDuration) ytFilterDuration.addEventListener('change', () => { ytCurrentFilters.duration = ytFilterDuration.value; });
  if (ytLoadMoreBtn) ytLoadMoreBtn.addEventListener('click', () => loadMore());

  checkYtKey();
}

async function checkYtKey() {
  if (!ytApiKey) {
    setYtStatus('offline', 'API key non configurata');
    return;
  }
  setYtStatus('checking', 'Verifica chiave...');
  try {
    const res = await fetch(`${YT_API_BASE}/videos?part=snippet&chart=mostPopular&maxResults=1&key=${ytApiKey}`);
    if (res.ok) {
      setYtStatus('online', `Connesso`);
    } else if (res.status === 403) {
      setYtStatus('offline', 'Chiave non valida o quota esaurita');
    } else {
      setYtStatus('offline', `Errore ${res.status}`);
    }
  } catch {
    setYtStatus('offline', 'Impossibile contattare YouTube');
  }
}

function setYtStatus(state, text) {
  if (ytStatusDot) {
    ytStatusDot.className = `item-status ${state}`;
  }
  if (ytStatusText) ytStatusText.textContent = text;
}

async function doSearch(query) {
  const q = query || ytSearchInput?.value?.trim();
  if (!q) return;
  if (!ytApiKey) { showYtError('Inserisci una YouTube API Key valida nel pannello laterale.'); return; }

  ytCurrentQuery = q;
  ytSearchResults = [];
  ytNextPageToken = null;
  ytSelectedVideo = null;
  ytCurrentChannelId = null;
  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
  if (ytDetailPanel) ytDetailPanel.classList.remove('active');

  await fetchResults();
}

async function loadMore() {
  if (!ytNextPageToken) return;
  if (ytCurrentChannelId) {
    await fetchChannelVideos(ytCurrentChannelId, ytNextPageToken);
  } else {
    await fetchResults(ytNextPageToken);
  }
}

async function fetchResults(pageToken) {
  if (!pageToken) {
    ytResultsContainer.innerHTML = '<div class="yt-loading"><i class="fas fa-spinner fa-pulse"></i> SCANSIONE IN CORSO...</div>';
  }

  const params = new URLSearchParams({
    part: 'snippet',
    q: ytCurrentQuery,
    type: 'video',
    maxResults: 20,
    order: ytCurrentFilters.order,
    safeSearch: ytCurrentFilters.safeSearch,
    key: ytApiKey
  });
  if (ytCurrentFilters.duration !== 'any') params.set('videoDuration', ytCurrentFilters.duration);
  if (pageToken) params.set('pageToken', pageToken);

  try {
    const res = await fetch(`${YT_API_BASE}/search?${params}`);
    if (!res.ok) throw new Error(`YouTube API: ${res.status}`);
    const data = await res.json();

    ytNextPageToken = data.nextPageToken || null;

    const videoIds = data.items.map(i => i.id.videoId).filter(Boolean);
    let statsMap = {};
    if (videoIds.length > 0) {
      const statsParams = new URLSearchParams({ part: 'statistics,contentDetails', id: videoIds.join(','), key: ytApiKey });
      const statsRes = await fetch(`${YT_API_BASE}/videos?${statsParams}`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        for (const item of statsData.items) statsMap[item.id] = item;
      }
    }

    const results = data.items.map(item => {
      const stats = statsMap[item.id.videoId] || {};
      return {
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelId: item.snippet.channelId,
        channelTitle: item.snippet.channelTitle,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        thumbnails: item.snippet.thumbnails,
        statistics: stats.statistics || {},
        contentDetails: stats.contentDetails || {}
      };
    });

    ytSearchResults = pageToken ? [...ytSearchResults, ...results] : results;
    renderResults();
    updateStats();
    if (ytLoadMoreBtn) ytLoadMoreBtn.style.display = ytNextPageToken ? 'block' : 'none';
  } catch (e) {
    showYtError(`Errore API: ${e.message}`);
  }
}

function renderResults() {
  ytResultsContainer.innerHTML = '';
  if (ytSearchResults.length === 0) {
    ytResultsContainer.innerHTML = '<div class="yt-empty">Nessun risultato trovato.</div>';
    return;
  }

  for (const item of ytSearchResults) {
    const card = document.createElement('div');
    card.className = 'yt-result-card';
    card.dataset.videoId = item.videoId;

    const thumb = item.thumbnails?.medium?.url || item.thumbnails?.default?.url || '';
    const date = new Date(item.publishedAt).toLocaleDateString('it-IT');
    const views = item.statistics.viewCount ? parseInt(item.statistics.viewCount).toLocaleString('it-IT') : 'N/A';
    const duration = item.contentDetails?.duration ? parseDuration(item.contentDetails.duration) : '';

    card.innerHTML =
      `<div class="yt-card-thumb">
        <img src="${thumb}" alt="" loading="lazy" />
        ${duration ? `<span class="yt-card-duration">${duration}</span>` : ''}
      </div>
      <div class="yt-card-info">
        <div class="yt-card-title">${escHtml(item.title)}</div>
        <div class="yt-card-channel"><i class="fas fa-user"></i> ${escHtml(item.channelTitle)}</div>
        <div class="yt-card-meta"><i class="fas fa-eye"></i> ${views} <i class="fas fa-calendar"></i> ${date}</div>
      </div>`;

    card.addEventListener('click', () => selectVideo(item));
    ytResultsContainer.appendChild(card);
  }
}

function selectVideo(item) {
  ytSelectedVideo = item;
  const thumb = item.thumbnails?.high?.url || item.thumbnails?.medium?.url || '';
  const date = new Date(item.publishedAt).toLocaleDateString('it-IT');
  const views = item.statistics.viewCount ? parseInt(item.statistics.viewCount).toLocaleString('it-IT') : 'N/A';
  const likes = item.statistics.likeCount ? parseInt(item.statistics.likeCount).toLocaleString('it-IT') : 'N/A';
  const comments = item.statistics.commentCount ? parseInt(item.statistics.commentCount).toLocaleString('it-IT') : 'N/A';
  const desc = item.description ? item.description.substring(0, 800) : 'Nessuna descrizione.';

  ytDetailContent.innerHTML =
    `<div class="yt-detail-thumb">
      <img src="${thumb}" alt="" />
      <a class="yt-detail-watch" href="https://youtube.com/watch?v=${item.videoId}" target="_blank" rel="noopener">
        <i class="fas fa-play"></i> GUARDA SU YOUTUBE
      </a>
    </div>
    <div class="yt-detail-header">
      <h3>${escHtml(item.title)}</h3>
      <div class="yt-detail-channel"><i class="fas fa-user"></i> ${escHtml(item.channelTitle)}</div>
    </div>
    <div class="yt-detail-stats">
      <span><i class="fas fa-eye"></i> ${views}</span>
      <span><i class="fas fa-thumbs-up"></i> ${likes}</span>
      <span><i class="fas fa-comment"></i> ${comments}</span>
      <span><i class="fas fa-calendar"></i> ${date}</span>
    </div>
    <div class="yt-detail-desc">${escHtml(desc)}</div>
    <div class="yt-detail-actions">
      <button class="hud-action-btn" onclick="window.open('https://youtube.com/watch?v=${item.videoId}', '_blank')"><i class="fas fa-external-link-alt"></i> APRI</button>
      <button class="hud-action-btn" onclick="navigator.clipboard.writeText('https://youtube.com/watch?v=${item.videoId}')"><i class="fas fa-link"></i> COPIA LINK</button>
    </div>`;

  ytDetailPanel.classList.add('active');
}

function showYtError(msg) {
  ytResultsContainer.innerHTML = `<div class="yt-error"><i class="fas fa-exclamation-triangle"></i> ${escHtml(msg)}</div>`;
}

function updateStats() {
  if (ytStatTotal) ytStatTotal.textContent = `${ytSearchResults.length} video`;
  if (ytStatQuery) ytStatQuery.textContent = `"${ytCurrentQuery}"`;
}

function parseDuration(iso) {
  if (iso == null) return '';
  const match = iso.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return '';
  const h = (match[1] || '').replace('H', '');
  const m = (match[2] || '').replace('M', '');
  const s = (match[3] || '').replace('S', '');
  const parts = [];
  if (h) parts.push(h.padStart(2, '0'));
  parts.push((m || '0').padStart(2, '0'));
  parts.push((s || '0').padStart(2, '0'));
  return parts.join(':');
}

function escHtml(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}

/* ── Channel Browser ────────────────────────────────────────────── */

function renderChannels() {
  const container = document.getElementById('yt-channels-container');
  const countEl = document.getElementById('yt-channels-count');
  if (!container) return;

  container.innerHTML = '';
  if (countEl) countEl.textContent = `${YT_CHANNELS.length} canali`;

  for (const ch of YT_CHANNELS) {
    const el = document.createElement('div');
    el.className = 'channel-item';
    el.dataset.channel = ch.name;
    el.innerHTML = `
      <div class="channel-lang ${ch.lang.toLowerCase()}">${ch.lang}</div>
      <div class="channel-info">
        <div class="channel-name">${escHtml(ch.name)}</div>
        <div class="channel-cat">${escHtml(ch.cat)}</div>
      </div>
    `;
    el.addEventListener('click', () => handleChannelClick(ch.name));
    container.appendChild(el);
  }
}

async function handleChannelClick(channelName) {
  document.querySelectorAll('.channel-item').forEach(el => {
    el.classList.toggle('active', el.dataset.channel === channelName);
  });

  if (ytSearchInput) ytSearchInput.value = channelName;

  ytResultsContainer.innerHTML = '<div class="yt-loading"><i class="fas fa-spinner fa-pulse"></i> RICERCA CANALE...</div>';

  const params = new URLSearchParams({
    part: 'snippet',
    q: channelName,
    type: 'channel',
    maxResults: 1,
    key: ytApiKey
  });

  try {
    const res = await fetch(`${YT_API_BASE}/search?${params}`);
    if (!res.ok) throw new Error(`YouTube API: ${res.status}`);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      showYtError(`Canale "${channelName}" non trovato.`);
      return;
    }

    const channelId = data.items[0].id.channelId;
    const channelTitle = data.items[0].snippet.title;

    ytCurrentChannelId = channelId;
    ytCurrentQuery = channelTitle;
    ytSearchResults = [];
    ytNextPageToken = null;
    ytSelectedVideo = null;
    if (ytDetailPanel) ytDetailPanel.classList.remove('active');

    await fetchChannelVideos(channelId);
  } catch (e) {
    showYtError(`Errore: ${e.message}`);
  }
}

async function fetchChannelVideos(channelId, pageToken) {
  const params = new URLSearchParams({
    part: 'snippet',
    channelId: channelId,
    order: 'date',
    maxResults: 20,
    key: ytApiKey
  });
  if (pageToken) params.set('pageToken', pageToken);

  try {
    const res = await fetch(`${YT_API_BASE}/search?${params}`);
    if (!res.ok) throw new Error(`YouTube API: ${res.status}`);
    const data = await res.json();

    ytNextPageToken = data.nextPageToken || null;

    const videoIds = data.items.map(i => i.id.videoId).filter(Boolean);
    let statsMap = {};
    if (videoIds.length > 0) {
      const statsParams = new URLSearchParams({ part: 'statistics,contentDetails', id: videoIds.join(','), key: ytApiKey });
      const statsRes = await fetch(`${YT_API_BASE}/videos?${statsParams}`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        for (const item of statsData.items) statsMap[item.id] = item;
      }
    }

    const results = data.items.map(item => {
      const stats = statsMap[item.id.videoId] || {};
      return {
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelId: item.snippet.channelId,
        channelTitle: item.snippet.channelTitle,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        thumbnails: item.snippet.thumbnails,
        statistics: stats.statistics || {},
        contentDetails: stats.contentDetails || {}
      };
    });

    ytSearchResults = pageToken ? [...ytSearchResults, ...results] : results;
    renderResults();
    updateStats();
    if (ytLoadMoreBtn) ytLoadMoreBtn.style.display = ytNextPageToken ? 'block' : 'none';
  } catch (e) {
    showYtError(`Errore: ${e.message}`);
  }
}

function openEditor() {
  if (window.electronAPI?.openEditor) {
    window.electronAPI.openEditor();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initYouTube();
  renderChannels();
});

// ============================================================
// EXPORTS — logica pura accessibile ai test (node:test)
// Inerte nel browser (module non definito nel renderer).
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    YT_CHANNELS,
    parseDuration,
    escHtml
  };
}
