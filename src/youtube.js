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
const ytPlaylistNameInput = document.getElementById('yt-pl-name');
const ytPlaylistCreateBtn = document.getElementById('yt-pl-create');
const ytPlaylistContent = document.getElementById('yt-pl-content');
const ytSubsContent = document.getElementById('yt-subs-content');
const ytAnalyzeContent = document.getElementById('yt-analyze-content');
const ytToastEl = document.getElementById('yt-toast');
const YT_CMD_KEY = 'yt-cmd';

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

  if (ytPlaylistCreateBtn) ytPlaylistCreateBtn.addEventListener('click', () => {
    const name = ytPlaylistNameInput ? ytPlaylistNameInput.value.trim() : '';
    if (!name) { showYtToast('Inserisci un nome per la playlist.'); return; }
    const pl = ensurePlaylist(name);
    if (ytPlaylistNameInput) ytPlaylistNameInput.value = '';
    currentPlaylistId = pl.id;
    renderPlaylists();
    showYtToast(`Playlist "${pl.name}" creata ✓`);
  });
  if (ytPlaylistNameInput) ytPlaylistNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ytPlaylistCreateBtn) ytPlaylistCreateBtn.click(); });

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
  switchPane('detail');

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
      <div class="yt-detail-channel" id="yt-detail-channel-link" title="Analizza canale"><i class="fas fa-user"></i> ${escHtml(item.channelTitle)} <i class="fas fa-chart-line"></i></div>
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
      <button class="hud-action-btn" onclick="ytQuickAdd()"><i class="fas fa-list"></i> PLAYLIST</button>
      <button class="hud-action-btn" onclick="ytSubscribeCurrent()"><i class="fas fa-bell"></i> ISCRIVITI</button>
      <button class="hud-action-btn" onclick="ytAnalyzeCurrent()"><i class="fas fa-chart-line"></i> ANALIZZA</button>
    </div>`;

  const channelLink = ytDetailContent.querySelector('#yt-detail-channel-link');
  if (channelLink) channelLink.addEventListener('click', () => ytAnalyzeChannel(item.channelTitle));

  ytDetailPanel.classList.add('active');
  switchPane('detail');
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
  renderPlaylists();
  renderSubscriptions();
  initYtCommandBridge();
  processPendingYtCommand();
});

// ============================================================
// PLAYLIST LOCALI — persistite in localStorage ("yt-playlists")
// ============================================================

let currentPlaylistId = null;

function normalizePlaylistName(name) { return (name || 'Watch Later').trim() || 'Watch Later'; }

function plEnsurePlaylist(list, name) {
  const n = normalizePlaylistName(name);
  if (list.some(p => p.name.toLowerCase() === n.toLowerCase())) return list;
  return [...list, { id: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), name: n, videos: [], createdAt: Date.now() }];
}

function plAddVideo(list, playlistId, video) {
  let added = false;
  const next = list.map(p => {
    if (p.id !== playlistId) return p;
    if (p.videos.some(v => v.videoId === video.videoId)) return p;
    added = true;
    return { ...p, videos: [{ videoId: video.videoId, title: video.title, channelTitle: video.channelTitle || '', thumb: video.thumbnails && video.thumbnails.medium ? video.thumbnails.medium.url : '', addedAt: Date.now() }, ...p.videos] };
  });
  return { list: added ? next : list, added };
}

function plRemoveVideo(list, playlistName, videoId) {
  let removed = false;
  const next = list.map(p => {
    if (p.name.toLowerCase() !== String(playlistName).toLowerCase()) return p;
    const filtered = p.videos.filter(v => v.videoId !== videoId);
    if (filtered.length !== p.videos.length) removed = true;
    return { ...p, videos: filtered };
  });
  return { list: removed ? next : list, removed };
}

function loadPlaylists() { try { return JSON.parse(localStorage.getItem('yt-playlists')) || []; } catch (e) { return []; } }
function savePlaylists(list) { localStorage.setItem('yt-playlists', JSON.stringify(list)); }

function ensurePlaylist(name) {
  const list = loadPlaylists();
  const next = plEnsurePlaylist(list, name);
  if (next !== list) savePlaylists(next);
  const n = normalizePlaylistName(name);
  return next.find(p => p.name.toLowerCase() === n.toLowerCase());
}

function findPlaylistById(id) { return loadPlaylists().find(p => p.id === id); }

function addVideoToPlaylist(playlistId, video) {
  const r = plAddVideo(loadPlaylists(), playlistId, video);
  if (r.added) savePlaylists(r.list);
  return r.added;
}

function removeVideoFromPlaylist(playlistName, videoId) {
  const r = plRemoveVideo(loadPlaylists(), playlistName, videoId);
  if (r.removed) savePlaylists(r.list);
  return r.removed;
}

function deletePlaylist(id) {
  savePlaylists(loadPlaylists().filter(p => p.id !== id));
  if (currentPlaylistId === id) currentPlaylistId = null;
}

function renderPlaylists() {
  if (!ytPlaylistContent) return;
  if (currentPlaylistId) { renderPlaylistDetail(currentPlaylistId); return; }
  const list = loadPlaylists();
  ytPlaylistContent.innerHTML = '';
  if (!list.length) {
    ytPlaylistContent.innerHTML = '<div class="yt-empty">Nessuna playlist locale.<br>Seleziona un video e premi <b>PLAYLIST</b> nel dettaglio oppure usa il comando vocale <b>Aggiungi alla playlist</b>.</div>';
    return;
  }
  for (const pl of list) {
    const el = document.createElement('div');
    el.className = 'yt-pl-item';
    el.innerHTML = `
      <div class="yt-pl-info">
        <div class="yt-pl-name">${escHtml(pl.name)}</div>
        <div class="yt-pl-meta">${pl.videos.length} VIDEO</div>
      </div>
      <button class="hud-action-btn yt-pl-open" title="Apri playlist"><i class="fas fa-folder-open"></i></button>
      <button class="hud-action-btn hud-action-btn-danger yt-pl-del" title="Elimina playlist"><i class="fas fa-trash"></i></button>`;
    el.querySelector('.yt-pl-open').addEventListener('click', (e) => { e.stopPropagation(); currentPlaylistId = pl.id; renderPlaylists(); });
    el.querySelector('.yt-pl-del').addEventListener('click', (e) => { e.stopPropagation(); deletePlaylist(pl.id); renderPlaylists(); });
    el.addEventListener('click', () => { currentPlaylistId = pl.id; renderPlaylists(); });
    ytPlaylistContent.appendChild(el);
  }
}

function renderPlaylistDetail(playlistId) {
  if (!ytPlaylistContent) return;
  const pl = loadPlaylists().find(p => p.id === playlistId);
  ytPlaylistContent.innerHTML = '';
  if (!pl) { currentPlaylistId = null; renderPlaylists(); return; }

  const back = document.createElement('button');
  back.className = 'hud-action-btn yt-pl-back';
  back.innerHTML = '<i class="fas fa-arrow-left"></i> TUTTE LE PLAYLIST';
  back.addEventListener('click', () => { currentPlaylistId = null; renderPlaylists(); });
  ytPlaylistContent.appendChild(back);

  const head = document.createElement('div');
  head.className = 'yt-pl-detail-name';
  head.textContent = pl.name;
  ytPlaylistContent.appendChild(head);

  if (!pl.videos.length) {
    const e = document.createElement('div');
    e.className = 'yt-empty';
    e.innerHTML = 'Playlist vuota.<br>Aggiungi un video selezionato dal dettaglio o col comando vocale <b>Aggiungi alla playlist</b>.';
    ytPlaylistContent.appendChild(e);
    return;
  }
  for (const v of pl.videos) {
    const row = document.createElement('div');
    row.className = 'yt-pl-video';
    row.innerHTML = `<div class="yt-pl-v-thumb">${v.thumb ? `<img src="${v.thumb}" alt="" />` : '<i class="fas fa-film"></i>'}</div>
      <div class="yt-pl-v-info">
        <div class="yt-pl-v-title">${escHtml(v.title)}</div>
        <div class="yt-pl-v-meta">${escHtml(v.channelTitle || '')}</div>
      </div>
      <button class="hud-action-btn yt-pl-v-open" title="Guarda su YouTube"><i class="fas fa-play"></i></button>
      <button class="hud-action-btn hud-action-btn-danger yt-pl-v-rm" title="Rimuovi dalla playlist"><i class="fas fa-times"></i></button>`;
    row.querySelector('.yt-pl-v-open').addEventListener('click', () => window.open(`https://youtube.com/watch?v=${v.videoId}`, '_blank'));
    row.querySelector('.yt-pl-v-rm').addEventListener('click', () => { removeVideoFromPlaylist(pl.name, v.videoId); renderPlaylists(); });
    ytPlaylistContent.appendChild(row);
  }
}

// ============================================================
// ISCRIZIONI LOCALI — persistite in localStorage ("yt-subs")
// ============================================================

function loadSubs() { try { return JSON.parse(localStorage.getItem('yt-subs')) || []; } catch (e) { return []; } }
function saveSubs(list) { localStorage.setItem('yt-subs', JSON.stringify(list)); }

function renderSubscriptions() {
  if (!ytSubsContent) return;
  const subs = loadSubs();
  ytSubsContent.innerHTML = '';
  if (!subs.length) {
    ytSubsContent.innerHTML = '<div class="yt-empty">Nessuna iscrizione locale.<br>Dì <b>Iscriviti al canale [nome]</b> o premi <b>ISCRIVITI</b> nel dettaglio di un video.</div>';
    return;
  }
  for (const s of subs) {
    const el = document.createElement('div');
    el.className = 'yt-sub-item';
    el.innerHTML = `
      <div class="yt-sub-thumb">${s.thumb ? `<img src="${s.thumb}" alt="" />` : '<i class="fas fa-user"></i>'}</div>
      <div class="yt-sub-info">
        <div class="yt-sub-name">${escHtml(s.title)}</div>
        <div class="yt-sub-meta">ISCRITTO ✓</div>
      </div>
      <button class="hud-action-btn yt-sub-rm" title="Rimuovi iscrizione"><i class="fas fa-bell-slash"></i></button>`;
    el.querySelector('.yt-sub-rm').addEventListener('click', (e) => { e.stopPropagation(); unsubscribe(s.channelId); });
    el.classList.add('clickable');
    el.addEventListener('click', () => window.open(`https://youtube.com/channel/${s.channelId}`, '_blank'));
    ytSubsContent.appendChild(el);
  }
}

function unsubscribe(channelId) {
  saveSubs(loadSubs().filter(s => s.channelId !== channelId));
  renderSubscriptions();
  showYtToast('Iscrizione rimossa.');
}

async function resolveChannel(name) {
  const params = new URLSearchParams({ part: 'snippet', q: name, type: 'channel', maxResults: 1, key: ytApiKey });
  const res = await fetch(`${YT_API_BASE}/search?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.items || !data.items.length) return null;
  const it = data.items[0];
  return { channelId: it.id.channelId, title: it.snippet.title, thumb: it.snippet.thumbnails && it.snippet.thumbnails.medium ? it.snippet.thumbnails.medium.url : '' };
}

async function subscribeToChannel(channelName) {
  const ch = await resolveChannel(channelName);
  if (!ch) { showYtToast(`Canale "${channelName}" non trovato.`); return false; }
  const subs = loadSubs();
  if (subs.some(s => s.channelId === ch.channelId)) { showYtToast(`Già iscritto a ${ch.title}`); renderSubscriptions(); return true; }
  subs.unshift({ channelId: ch.channelId, title: ch.title, thumb: ch.thumb, addedAt: Date.now() });
  saveSubs(subs);
  renderSubscriptions();
  showYtToast(`Iscritto a ${ch.title} ✓`);
  return true;
}

// ============================================================
// QUICK ACTIONS — bottoni del dettaglio video
// ============================================================

function ytQuickAdd() {
  if (!ytSelectedVideo) { showYtToast('Nessun video selezionato.'); return; }
  let pl = currentPlaylistId ? findPlaylistById(currentPlaylistId) : null;
  if (!pl) pl = ensurePlaylist('Watch Later');
  if (addVideoToPlaylist(pl.id, ytSelectedVideo)) {
    switchPane('playlist');
    currentPlaylistId = pl.id;
    renderPlaylists();
    showYtToast(`Aggiunto a "${pl.name}" ✓`);
  } else {
    showYtToast(`Video già presente nella playlist "${pl.name}".`);
  }
}

function ytSubscribeCurrent() {
  if (!ytSelectedVideo || !ytSelectedVideo.channelTitle) { showYtToast('Nessun video selezionato.'); return; }
  subscribeToChannel(ytSelectedVideo.channelTitle);
}

function ytAnalyzeCurrent() {
  if (!ytSelectedVideo || !ytSelectedVideo.channelTitle) { showYtToast('Nessun video selezionato.'); return; }
  analyzeChannel(ytSelectedVideo.channelTitle);
}

function ytAnalyzeChannel(name) { analyzeChannel(name); }

// ============================================================
// ANALIZZATORE CANALI — report di performance del canale
// ============================================================

function isoToSeconds(iso) {
  if (!iso) return 0;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10);
}

function avgOf(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

function buildChannelReport(channel, details, videos) {
  const stats = (details && details.statistics) || {};
  const snippet = (details && details.snippet) || {};
  const vids = (videos || []).map(v => ({
    videoId: v.id,
    title: v.snippet && v.snippet.title,
    publishedAt: v.snippet && v.snippet.publishedAt,
    views: parseInt((v.statistics && v.statistics.viewCount) || 0, 10),
    likes: parseInt((v.statistics && v.statistics.likeCount) || 0, 10),
    comments: parseInt((v.statistics && v.statistics.commentCount) || 0, 10),
    durationLabel: parseDuration(v.contentDetails && v.contentDetails.duration),
    durationSec: isoToSeconds(v.contentDetails && v.contentDetails.duration)
  }));
  const counted = vids.filter(v => v.views > 0);
  const avgViews = avgOf(counted.map(v => v.views));
  const avgLikes = avgOf(counted.map(v => v.likes));
  const avgComments = avgOf(counted.map(v => v.comments));
  const engagementRate = avgViews ? ((avgLikes + avgComments) / avgViews) * 100 : 0;
  const avgDurationSec = avgOf(vids.filter(v => v.durationSec > 0).map(v => v.durationSec));
  const top = [...counted].sort((a, b) => b.views - a.views).slice(0, 3);
  const timestamps = vids.map(v => new Date(v.publishedAt).getTime()).filter(t => !Number.isNaN(t));
  return {
    channelId: channel.channelId,
    title: channel.title,
    thumb: channel.thumb || '',
    subscribers: parseInt(stats.subscriberCount || '0', 10),
    totalViews: parseInt(stats.viewCount || '0', 10),
    videoCount: parseInt(stats.videoCount || String(vids.length), 10),
    country: snippet.country || '',
    created: snippet.publishedAt || '',
    description: (snippet.description || '').slice(0, 220),
    sampleSize: counted.length,
    avgViews, avgLikes, avgComments,
    engagementRate,
    avgDurationSec,
    lastUpload: timestamps.length ? new Date(Math.max(...timestamps)) : null,
    top
  };
}

function formatNum(n) { return n ? n.toLocaleString('it-IT') : '0'; }
function fmtDur(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderChannelReport(r) {
  if (!ytAnalyzeContent) return;
  const maxViews = r.top.length ? r.top[0].views : 0;
  const topRows = r.top.map(v => {
    const w = maxViews ? Math.max(4, Math.round((v.views / maxViews) * 100)) : 0;
    return `<div class="yt-rpt-video">
      <div class="yt-rpt-v-title">${escHtml(v.title)}</div>
      <div class="yt-rpt-v-bar"><div class="yt-rpt-v-fill" style="width:${w}%"></div></div>
      <div class="yt-rpt-v-views">${formatNum(v.views)}</div>
    </div>`;
  }).join('');

  ytAnalyzeContent.innerHTML = `
    <div class="yt-rpt">
      <div class="yt-rpt-head">
        <div class="yt-rpt-thumb">${r.thumb ? `<img src="${r.thumb}" alt="" />` : '<i class="fas fa-bolt"></i>'}</div>
        <div class="yt-rpt-head-info">
          <div class="yt-rpt-title">${escHtml(r.title)}</div>
          <div class="yt-rpt-sub">${formatNum(r.subscribers)} ISCRITTI · ${formatNum(r.totalViews)} VISUALIZZAZIONI · ${formatNum(r.videoCount)} VIDEO</div>
          <div class="yt-rpt-channel"><i class="fas fa-video"></i> CHANNEL ID: ${escHtml(r.channelId)}</div>
        </div>
      </div>
      <div class="yt-rpt-stats">
        <div class="yt-rpt-stat"><span class="yt-rpt-num">${formatNum(Math.round(r.avgViews))}</span><span class="yt-rpt-lbl">VIS MEDIE</span></div>
        <div class="yt-rpt-stat"><span class="yt-rpt-num">${r.engagementRate.toFixed(1)}%</span><span class="yt-rpt-lbl">ENGAGEMENT</span></div>
        <div class="yt-rpt-stat"><span class="yt-rpt-num">${formatNum(Math.round(r.avgLikes))}</span><span class="yt-rpt-lbl">LIKE MEDI</span></div>
        <div class="yt-rpt-stat"><span class="yt-rpt-num">${formatNum(Math.round(r.avgComments))}</span><span class="yt-rpt-lbl">COMMENTI</span></div>
        <div class="yt-rpt-stat"><span class="yt-rpt-num">${r.lastUpload ? r.lastUpload.toLocaleDateString('it-IT') : '—'}</span><span class="yt-rpt-lbl">ULTIMO VIDEO</span></div>
        <div class="yt-rpt-stat"><span class="yt-rpt-num">${fmtDur(r.avgDurationSec)}</span><span class="yt-rpt-lbl">DURATA MEDIA</span></div>
      </div>
      <div class="yt-rpt-section-title">TOP VIDEO NEL CAMPIONE (${r.sampleSize} ANALIZZATI)</div>
      ${topRows || '<div class="yt-empty">Nessun video nel campione.</div>'}
      ${r.country ? `<div class="yt-rpt-country"><i class="fas fa-globe"></i> PAESE: ${escHtml(r.country)}</div>` : ''}
      ${r.description ? `<div class="yt-rpt-desc">${escHtml(r.description)}${r.description.length >= 220 ? '…' : ''}</div>` : ''}
    </div>`;
}

async function fetchLatestVideos(channelId, count) {
  const params = new URLSearchParams({ part: 'snippet', channelId, order: 'date', maxResults: count, key: ytApiKey });
  const res = await fetch(`${YT_API_BASE}/search?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  const items = data.items || [];
  const ids = items.map(i => i.id.videoId).filter(Boolean);
  if (!ids.length) return items;
  const statsParams = new URLSearchParams({ part: 'statistics,contentDetails', id: ids.join(','), key: ytApiKey });
  const statsRes = await fetch(`${YT_API_BASE}/videos?${statsParams}`);
  const map = {};
  if (statsRes.ok) {
    const statsData = await statsRes.json();
    for (const it of statsData.items) map[it.id] = it;
  }
  return items.map(i => Object.assign({ id: i.id.videoId, snippet: i.snippet }, map[i.id.videoId] || {}));
}

async function analyzeChannel(channelName) {
  switchPane('analyze');
  if (!ytAnalyzeContent) return;
  ytAnalyzeContent.innerHTML = '<div class="yt-loading"><i class="fas fa-spinner fa-pulse"></i> ANALISI CANALE...</div>';
  try {
    const ch = await resolveChannel(channelName);
    if (!ch) {
      ytAnalyzeContent.innerHTML = `<div class="yt-error"><i class="fas fa-exclamation-triangle"></i> Canale "${escHtml(channelName)}" non trovato.</div>`;
      return;
    }
    const detailsRes = await fetch(`${YT_API_BASE}/channels?${new URLSearchParams({ part: 'snippet,statistics', id: ch.channelId, key: ytApiKey })}`);
    if (!detailsRes.ok) throw new Error(`channels API: ${detailsRes.status}`);
    const detailsData = await detailsRes.json();
    const details = detailsData.items && detailsData.items[0];
    if (!details) {
      ytAnalyzeContent.innerHTML = '<div class="yt-error">Canale non disponibile per l\'analisi.</div>';
      return;
    }
    const videos = await fetchLatestVideos(ch.channelId, 15);
    renderChannelReport(buildChannelReport(ch, details, videos));
  } catch (e) {
    ytAnalyzeContent.innerHTML = `<div class="yt-error"><i class="fas fa-exclamation-triangle"></i> Errore analisi: ${escHtml(e.message)}</div>`;
  }
}

// ============================================================
// TABS & TOAST
// ============================================================

let ytActivePane = 'detail';

function switchPane(pane) {
  ytActivePane = pane;
  document.querySelectorAll('.yt-tab').forEach(t => t.classList.toggle('active', t.dataset.pane === pane));
  document.querySelectorAll('.yt-pane').forEach(p => p.classList.toggle('active', p.id === 'yt-pane-' + pane));
  if (pane === 'playlist') renderPlaylists();
  if (pane === 'subs') renderSubscriptions();
}

let ytToastTimer = null;
function showYtToast(msg) {
  if (!ytToastEl) return;
  ytToastEl.innerHTML = msg;
  ytToastEl.classList.add('show');
  clearTimeout(ytToastTimer);
  ytToastTimer = setTimeout(() => ytToastEl.classList.remove('show'), 3500);
}

// ============================================================
// BRIDGE COMANDI VOCALI / CROSS-WINDOW — consuma "yt-cmd"
// Set da index.html (ollama.js) quando un comando voce/testo
// viene riconosciuto; qui arriva via storage event oppure alla
// prima lettura al caricamento della pagina.
// ============================================================

let ytCmdHandledTs = 0;

function initYtCommandBridge() {
  window.addEventListener('storage', (e) => {
    if (e.key === YT_CMD_KEY && e.newValue) handleYtCommand(e.newValue);
  });
}

function processPendingYtCommand() {
  const raw = localStorage.getItem(YT_CMD_KEY);
  if (raw) handleYtCommand(raw);
}

function handleYtCommand(raw) {
  let cmd;
  try { cmd = JSON.parse(raw); } catch (e) { return; }
  if (!cmd || typeof cmd.op !== 'string' || !cmd.ts || cmd.ts <= ytCmdHandledTs) return;
  ytCmdHandledTs = cmd.ts;
  localStorage.removeItem(YT_CMD_KEY);
  processYtCommand(cmd);
}

async function processYtCommand(cmd) {
  const payload = String(cmd.payload || '').trim();
  switch (cmd.op) {
    case 'search': {
      if (payload) {
        if (ytSearchInput) ytSearchInput.value = payload;
        doSearch(payload);
      } else {
        switchPane('detail');
        if (ytSearchInput) ytSearchInput.focus();
        showYtToast('Dì o digita cosa cercare su YouTube.');
      }
      break;
    }
    case 'playlist_add': {
      if (!ytSelectedVideo) {
        switchPane('playlist');
        showYtToast('Seleziona prima un video (clicca su un risultato) per aggiungerlo alla playlist.');
        break;
      }
      let pl = payload ? ensurePlaylist(payload) : (currentPlaylistId ? findPlaylistById(currentPlaylistId) : null);
      if (!pl) pl = ensurePlaylist('Watch Later');
      if (addVideoToPlaylist(pl.id, ytSelectedVideo)) {
        switchPane('playlist');
        currentPlaylistId = pl.id;
        renderPlaylists();
        showYtToast(`Aggiunto a "${pl.name}" ✓`);
      } else {
        showYtToast(`Video già presente in "${pl.name}".`);
        switchPane('playlist');
        renderPlaylists();
      }
      break;
    }
    case 'playlist_remove': {
      if (!ytSelectedVideo) {
        switchPane('playlist');
        showYtToast('Seleziona il video da rimuovere e ripeti il comando.');
        break;
      }
      let removed = false;
      if (payload) {
        removed = removeVideoFromPlaylist(payload, ytSelectedVideo.videoId);
      } else {
        for (const pl of loadPlaylists()) {
          if (removeVideoFromPlaylist(pl.name, ytSelectedVideo.videoId)) removed = true;
        }
      }
      switchPane('playlist');
      if (currentPlaylistId) renderPlaylists();
      showYtToast(removed ? 'Video rimosso dalla playlist ✓' : 'Video non presente nelle playlist.');
      break;
    }
    case 'subscribe': {
      const target = payload || (ytSelectedVideo && ytSelectedVideo.channelTitle);
      if (!target) { showYtToast('Seleziona un video o indica il nome del canale.'); break; }
      await subscribeToChannel(target);
      break;
    }
    case 'analyze': {
      const target = payload || (ytSelectedVideo && ytSelectedVideo.channelTitle);
      if (!target) { switchPane('analyze'); showYtToast('Indica il nome del canale da analizzare.'); break; }
      await analyzeChannel(target);
      break;
    }
  }
}

// ============================================================
// EXPORTS — logica pura accessibile ai test (node:test)
// Inerte nel browser (module non definito nel renderer).
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    YT_CHANNELS,
    parseDuration,
    escHtml,
    normalizePlaylistName,
    plEnsurePlaylist,
    plAddVideo,
    plRemoveVideo,
    isoToSeconds,
    buildChannelReport
  };
}
