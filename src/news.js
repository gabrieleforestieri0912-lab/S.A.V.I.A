/**
 * S.A.V.I.A - News Monitor & Feed Module (Tech / AI)
 * - news.html  → interfaccia feed + configurazione monitor
 * - index.html → watchdog in background: avvisa quando escono nuove notizie
 * Sorgenti senza API key con CORS libero: Hacker News, DEV Community,
 * Google News IT (via proxy allorigins). Lo stato (config, cursor, log) è
 * salvato in localStorage e condiviso tra finestre.
 */

const NEWS_KEYS = { watch: 'savia-news-watch', cursor: 'savia-news-cursor', log: 'savia-news-log', saved: 'savia-news-saved' };

const NEWS_AI_TERMS = ['intelligenza artificiale', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network', 'large language', ' llm', 'openai', 'anthropic', 'google gemini', ' chatgpt', 'gpt-', 'claude', 'hugging face', 'agentic ai', 'agi', 'diffusion model', 'transformer model', 'ai '];

function classifyCategory(title, snippet) {
  const text = (String(title || '') + ' ' + String(snippet || '')).toLowerCase();
  return NEWS_AI_TERMS.some(t => text.includes(t)) ? 'AI' : 'TECH';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNum(n) { return n ? n.toLocaleString('it-IT') : '0'; }
function hashText(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(s) {
  return String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseGoogleNewsXml(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const mm = block.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
      return mm ? mm[1].trim() : '';
    };
    const title = stripTags(decodeEntities(get('title')));
    const link = get('link');
    const pub = get('pubDate');
    const description = stripTags(decodeEntities(get('description'))).slice(0, 240);
    const ts = Date.parse(pub);
    if (!title || !link) continue;
    items.push({ title, url: link, description, publishedAt: Number.isNaN(ts) ? '' : new Date(ts).toISOString() });
  }
  return items;
}

function hnQuery(cat) { return cat === 'AI' ? 'artificial intelligence' : 'technology'; }

const NEWS_SOURCES = [
  {
    id: 'hn', name: 'HACKER NEWS', badge: 'HN',
    url(cat) {
      return 'https://hn.algolia.com/api/v1/search_by_date?' + new URLSearchParams({ query: hnQuery(cat), tags: 'story', hitsPerPage: '25', numericFilters: 'points>10' }).toString();
    },
    parse(json) {
      return (json && json.hits ? json.hits : []).map(h => ({
        id: 'hn-' + h.objectID,
        title: h.title || 'Senza titolo',
        url: h.story_url || h.url || ('https://news.ycombinator.com/item?id=' + h.objectID),
        publishedAt: h.created_at,
        snippet: stripTags(h.story_text).slice(0, 200),
        score: h.points || 0,
        author: h.author || ''
      }));
    }
  },
  {
    id: 'devto', name: 'DEV COMMUNITY', badge: 'DEV',
    url(cat) {
      return 'https://dev.to/api/articles?' + new URLSearchParams({ per_page: '25', tag: cat === 'AI' ? 'ai' : 'technology' }).toString();
    },
    parse(json) {
      return (Array.isArray(json) ? json : []).map(a => ({
        id: 'dev-' + a.id,
        title: a.title || 'Senza titolo',
        url: a.url || '',
        publishedAt: a.published_at,
        snippet: (a.description || '').slice(0, 200),
        score: a.positive_reactions_count || 0,
        author: a.user && a.user.name ? a.user.name : ''
      }));
    }
  },
  {
    id: 'gnews', name: 'GOOGLE NEWS IT', badge: 'GN',
    url(cat) {
      const q = cat === 'AI' ? 'intelligenza artificiale' : 'tecnologia';
      const rss = 'https://news.google.com/rss/search?' + new URLSearchParams({ q, hl: 'it', gl: 'IT', ceid: 'IT:it' }).toString();
      return 'https://api.allorigins.win/get?url=' + encodeURIComponent(rss);
    },
    parse(json) {
      const xml = json && json.contents ? json.contents : '';
      return parseGoogleNewsXml(xml).map(a => ({
        id: 'gnews-' + hashText(a.url),
        title: a.title,
        url: a.url,
        publishedAt: a.publishedAt,
        snippet: a.description,
        score: 0
      }));
    }
  }
];

function sourceName(id) {
  const s = NEWS_SOURCES.find(x => x.id === id);
  return s ? s.name : id.toUpperCase();
}
function badgeOfSource(id) {
  const s = NEWS_SOURCES.find(x => x.id === id);
  return s ? s.badge : id.toUpperCase();
}

function normalizeArticle(raw, sourceId) {
  const ts = Date.parse(raw.publishedAt);
  return {
    id: raw.id || (sourceId + '-' + hashText(raw.url + String(raw.title))),
    title: String(raw.title || 'Senza titolo').slice(0, 180),
    url: String(raw.url || ''),
    source: sourceId,
    badge: badgeOfSource(sourceId),
    category: classifyCategory(raw.title, raw.snippet),
    publishedAt: Number.isNaN(ts) ? '' : new Date(ts).toISOString(),
    snippet: String(raw.snippet || '').slice(0, 240),
    score: raw.score || 0,
    author: String(raw.author || '')
  };
}

function fetchOpts() {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(15000) };
  }
  return {};
}

async function fetchFeed(cat, sourceIds) {
  const cats = cat === 'ALL' ? ['AI', 'TECH'] : [cat];
  const ids = sourceIds && sourceIds.length ? sourceIds : NEWS_SOURCES.map(s => s.id);
  const articles = [];
  const errors = [];
  await Promise.all(ids.flatMap(sid => cats.map(async (c) => {
    const src = NEWS_SOURCES.find(s => s.id === sid);
    if (!src) { errors.push(`${sid}: sorgente sconosciuta`); return; }
    try {
      const res = await fetch(src.url(c), fetchOpts());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const items = src.parse(json) || [];
      for (const it of items) articles.push(normalizeArticle(it, sid));
    } catch (e) {
      errors.push(`${src.name}: ${e.message}`);
    }
  })));
  articles.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
  const seen = new Set();
  return { articles: articles.filter(a => { const k = keyArticle(a); if (seen.has(k)) return false; seen.add(k); return true; }), errors };
}

// ============================================================
// CURSOR / DEDUP — traccia gli articoli già visti
// ============================================================

function emptyCursor() { return { ts: Date.now(), ids: [] }; }
function getCursor() {
  try {
    const c = JSON.parse(localStorage.getItem(NEWS_KEYS.cursor) || 'null');
    return c && Array.isArray(c.ids) ? c : emptyCursor();
  } catch (e) { return emptyCursor(); }
}
function saveCursor(c) {
  const ids = (c.ids || []).slice(-300);
  localStorage.setItem(NEWS_KEYS.cursor, JSON.stringify({ ts: c.ts, ids }));
}
function cursorWithArticles(articles) {
  return { ts: Date.now(), ids: articles.map(keyArticle) };
}
function mergeCursorKeys(prev, keys) {
  return { ts: Date.now(), ids: [...new Set([...prev.ids, ...keys])].slice(-300) };
}
function keyArticle(a) { return (a.url || a.id) + '|' + a.title; }

function diffNewArticles(articles, cursor, windowHours) {
  const cutoff = Date.now() - Math.max(0, windowHours || 12) * 3600 * 1000;
  const known = new Set(cursor.ids || []);
  return articles.filter(a => {
    const t = Date.parse(a.publishedAt) || 0;
    if (t && t < cutoff) return false;
    return !known.has(keyArticle(a));
  });
}

// ============================================================
// WATCHDOG — controllo periodico delle novità
// ============================================================

function getWatchConfig() {
  const base = { enabled: true, intervalMin: 10, speak: true, sources: NEWS_SOURCES.map(s => s.id) };
  try {
    const saved = JSON.parse(localStorage.getItem(NEWS_KEYS.watch) || '{}');
    return Object.assign(base, saved);
  } catch (e) { return base; }
}
function saveWatchConfig(cfg) { localStorage.setItem(NEWS_KEYS.watch, JSON.stringify(cfg)); }

function getNewsLog() {
  try { return JSON.parse(localStorage.getItem(NEWS_KEYS.log) || '[]') || []; } catch (e) { return []; }
}
function logNewsAlert(a) {
  const log = getNewsLog();
  log.unshift({ title: a.title, url: a.url, source: a.source, category: a.category, publishedAt: a.publishedAt, at: new Date().toISOString() });
  localStorage.setItem(NEWS_KEYS.log, JSON.stringify(log.slice(0, 25)));
}
function clearNewsLog() { localStorage.setItem(NEWS_KEYS.log, '[]'); }

async function pollNewsOnce(config) {
  const res = await fetchFeed('ALL', config.sources);
  const cursor = getCursor();
  if (!(cursor.ids && cursor.ids.length)) {
    saveCursor(cursorWithArticles(res.articles));
    return { newItems: [], errors: res.errors, firstRun: true };
  }
  const fresh = diffNewArticles(res.articles, cursor, config.freshHours || 12);
  if (fresh.length) saveCursor(mergeCursorKeys(cursor, fresh.map(keyArticle)));
  return { newItems: fresh, errors: res.errors, firstRun: false };
}

function alertNews(article, config) {
  const msg = `NOVITÀ ${article.category} [${sourceName(article.source)}]: ${article.title}`;
  if (typeof sendNotification === 'function') sendNotification(msg, 'info', 9000);
  logNewsAlert(article);
  if (config.speak !== false) {
    const speak = typeof speakText === 'function' ? speakText : null;
    if (speak) {
      try {
        speak(`Attenzione. Nuove notizie su ${article.category === 'AI' ? 'intelligenza artificiale' : 'tecnologia'}. ${article.title.replace(/[^a-z0-9\s'":,.!?()%+-]/gi, '')}`);
      } catch (e) { /* ignore */ }
    }
  }
}

let newsWatchTimer = null;
let newsWatchLast = 0;
function stopNewsWatchdog() {
  if (newsWatchTimer) { clearInterval(newsWatchTimer); newsWatchTimer = null; }
}

async function tickNewsWatch() {
  const cfg = getWatchConfig();
  if (!cfg.enabled) return;
  const interval = Math.max(1, cfg.intervalMin || 10) * 60000;
  const now = Date.now();
  if (newsWatchLast && (now - newsWatchLast) < interval) return;
  newsWatchLast = now;
  try {
    const r = await pollNewsOnce(cfg);
    for (const a of r.newItems) alertNews(a, cfg);
    if (r.errors.length && typeof addTickerEvent === 'function') {
      addTickerEvent('warn', `NEWS: ${r.errors.join(' · ')}`);
    }
  } catch (e) { /* ignore */ }
}

function initNewsWatchdog() {
  stopNewsWatchdog();
  newsWatchLast = 0;
  newsWatchTimer = setInterval(tickNewsWatch, 30000);
  tickNewsWatch();
}

// ============================================================
// PAGINA — news.html (feed, filtri, salvataggi, log, monitor)
// ============================================================

let newsState = { cat: 'ALL', query: '', sources: [], articles: [] };
let newsAutoTimer = null;

function getSaved() {
  try { return JSON.parse(localStorage.getItem(NEWS_KEYS.saved) || '[]') || []; } catch (e) { return []; }
}
function saveLocalArticle(a) {
  const s = getSaved();
  if (!s.some(x => x.url === a.url)) {
    s.unshift({ url: a.url, title: a.title, source: a.source, category: a.category, publishedAt: a.publishedAt });
    localStorage.setItem(NEWS_KEYS.saved, JSON.stringify(s.slice(0, 50)));
  }
}
function unsaveLocalArticle(url) {
  localStorage.setItem(NEWS_KEYS.saved, JSON.stringify(getSaved().filter(x => x.url !== url)));
}
function isSavedArticle(url) { return getSaved().some(x => x.url === url); }

function articleCard(a, freshMs) {
  const saved = isSavedArticle(a.url);
  const fresh = freshMs ? (Date.parse(a.publishedAt) || 0) >= freshMs : false;
  const date = a.publishedAt ? new Date(a.publishedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const score = a.score ? `<span class="nws-meta-item"><i class="fas fa-fire" style="color:var(--accent-gold);"></i> ${formatNum(a.score)}</span>` : '';
  return `<div class="nws-card">
    <div class="nws-badges">
      <span class="nws-src">${esc(a.badge)}</span>
      <span class="nws-cat ${a.category === 'AI' ? 'ai' : 'tech'}">${esc(a.category)}</span>
      ${fresh ? '<span class="nws-new">NEW</span>' : ''}
    </div>
    <a class="nws-title" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
    ${a.snippet ? `<div class="nws-snippet">${esc(a.snippet)}</div>` : ''}
    <div class="nws-meta">
      ${score}
      ${date ? `<span class="nws-meta-item"><i class="fas fa-clock"></i> ${esc(date)}</span>` : ''}
      ${a.author ? `<span class="nws-meta-item"><i class="fas fa-user"></i> ${esc(a.author)}</span>` : ''}
    </div>
    <div class="nws-actions">
      <button class="hud-action-btn" data-open="${esc(a.url)}"><i class="fas fa-external-link-alt"></i> APRI</button>
      <button class="hud-action-btn ${saved ? 'nws-saved-on' : ''}" data-save="${esc(a.url)}"><i class="fas fa-bookmark${saved ? '' : '-o'}"></i> ${saved ? 'SALVATO' : 'SALVA'}</button>
    </div>
  </div>`;
}

function renderNewsFeed() {
  const feed = document.getElementById('news-feed');
  const countEl = document.getElementById('news-count');
  if (!feed) return;
  const q = newsState.query.toLowerCase().trim();
  let list = newsState.articles;
  if (newsState.cat !== 'ALL') list = list.filter(a => a.category === newsState.cat);
  if (q) list = list.filter(a => (a.title + ' ' + a.snippet).toLowerCase().includes(q));
  if (countEl) countEl.textContent = `${list.length} notizie`;
  if (!list.length) {
    feed.innerHTML = '<div class="yt-empty"><i class="fas fa-newspaper"></i> Nessuna notizia. Prova a cambiare categoria o sorgenti.</div>';
    return;
  }
  const loadedAt = Date.now() - 1000;
  feed.innerHTML = list.map(a => articleCard(a, loadedAt)).join('');
}

function bindNewsFeed() {
  const feed = document.getElementById('news-feed');
  if (!feed) return;
  feed.addEventListener('click', (e) => {
    const openEl = e.target.closest('[data-open]');
    if (openEl) { if (openEl.dataset.open) window.open(openEl.dataset.open, '_blank'); return; }
    const saveEl = e.target.closest('[data-save]');
    if (!saveEl || !saveEl.dataset.save) return;
    const url = saveEl.dataset.save;
    const article = newsState.articles.find(a => a.url === url);
    if (isSavedArticle(url)) unsaveLocalArticle(url);
    else if (article) saveLocalArticle(article);
    renderNewsFeed();
  });
}

function renderMonitorPanel() {
  const cfg = getWatchConfig();
  const status = document.getElementById('news-monitor-status');
  const toggle = document.getElementById('news-monitor-toggle');
  const interval = document.getElementById('news-interval');
  const speak = document.getElementById('news-speak');
  const srcChips = document.querySelectorAll('#news-sources input');
  if (status) { status.textContent = cfg.enabled ? 'MONITOR ATTIVO' : 'MONITOR SPENTO'; status.className = cfg.enabled ? 'nws-status on' : 'nws-status'; }
  if (toggle) toggle.checked = !!cfg.enabled;
  if (interval) interval.value = String(cfg.intervalMin || 10);
  if (speak) speak.checked = cfg.speak !== false;
  srcChips.forEach(ch => { ch.checked = cfg.sources.includes(ch.value); });
  renderNewsLog();
}

function renderNewsLog() {
  const box = document.getElementById('news-log');
  if (!box) return;
  const log = getNewsLog();
  if (!log.length) {
    box.innerHTML = '<div class="yt-empty">Nessuna segnalazione ancora. Quando il monitor trova novità, S.A.V.I.A ti avvisa.</div>';
    return;
  }
  box.innerHTML = log.map(l => `<div class="nws-log-item">
    <span class="nws-log-cat ${l.category === 'AI' ? 'ai' : 'tech'}">${esc(l.category)}</span>
    <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>
    <span class="nws-log-time">${new Date(l.at).toLocaleTimeString('it-IT')}</span>
  </div>`).join('') + '<div class="nws-log-clear"><button class="hud-action-btn" id="news-log-clear"><i class="fas fa-trash"></i> SVUOTA LOG</button></div>';
  const clearBtn = box.querySelector('#news-log-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => { clearNewsLog(); renderNewsLog(); });
}

function bindMonitorPanel() {
  const toggle = document.getElementById('news-monitor-toggle');
  const interval = document.getElementById('news-interval');
  const speak = document.getElementById('news-speak');
  const refresh = document.getElementById('news-refresh');
  const newsSearch = document.getElementById('news-search');
  if (toggle) toggle.addEventListener('change', () => {
    const cfg = getWatchConfig();
    cfg.enabled = toggle.checked;
    saveWatchConfig(cfg);
    renderMonitorPanel();
    scheduleNewsAutoRefresh();
  });
  if (interval) interval.addEventListener('change', () => {
    const cfg = getWatchConfig();
    cfg.intervalMin = parseInt(interval.value, 10) || 10;
    saveWatchConfig(cfg);
    renderMonitorPanel();
    scheduleNewsAutoRefresh();
  });
  if (speak) speak.addEventListener('change', () => {
    const cfg = getWatchConfig();
    cfg.speak = speak.checked;
    saveWatchConfig(cfg);
  });
  document.querySelectorAll('#news-sources input').forEach(ch => ch.addEventListener('change', () => {
    const cfg = getWatchConfig();
    cfg.sources = Array.from(document.querySelectorAll('#news-sources input')).filter(x => x.checked).map(x => x.value);
    if (!cfg.sources.length) cfg.sources = ['hn'];
    saveWatchConfig(cfg);
    newsState.sources = cfg.sources;
    loadFeeds();
  }));
  if (refresh) refresh.addEventListener('click', () => loadFeeds());
  if (newsSearch) newsSearch.addEventListener('input', () => { newsState.query = newsSearch.value; renderNewsFeed(); });
  if (newsSearch) newsSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFeeds(); });
}

function bindNewsTabs() {
  document.querySelectorAll('#news-tabs .yt-tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('#news-tabs .yt-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    newsState.cat = t.dataset.cat || 'ALL';
    renderNewsFeed();
  }));
}

async function loadFeeds() {
  const feed = document.getElementById('news-feed');
  const statusDot = document.getElementById('news-status-dot');
  const statusText = document.getElementById('news-status-text');
  if (statusDot) statusDot.className = 'item-status checking';
  if (statusText) statusText.textContent = 'Ricerco le ultime notizie...';
  if (feed) feed.innerHTML = '<div class="yt-loading"><i class="fas fa-spinner fa-pulse"></i> SCANSIONE NOTIZIE...</div>';
  const res = await fetchFeed('ALL', newsState.sources);
  newsState.articles = res.articles;
  renderNewsFeed();
  if (statusDot) statusDot.className = 'item-status ' + (res.errors.length && !res.articles.length ? 'offline' : 'online');
  if (statusText) {
    statusText.textContent = res.errors.length ? `Connesso (${res.articles.length} notizie, ${res.errors.length} sorgenti off)`
      : `Connesso (${res.articles.length} notizie)`;
  }
}

function scheduleNewsAutoRefresh() {
  clearTimeout(newsAutoTimer);
  const cfg = getWatchConfig();
  if (!cfg.enabled) return;
  newsAutoTimer = setTimeout(() => { loadFeeds(); scheduleNewsAutoRefresh(); }, Math.max(1, cfg.intervalMin || 10) * 60000);
}

function initNewsPage() {
  const cfg = getWatchConfig();
  newsState.sources = cfg.sources && cfg.sources.length ? cfg.sources : NEWS_SOURCES.map(s => s.id);
  bindNewsTabs();
  bindMonitorPanel();
  bindNewsFeed();
  renderMonitorPanel();
  loadFeeds();
  scheduleNewsAutoRefresh();
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('news-app')) initNewsPage();
  else initNewsWatchdog();
});

// ============================================================
// EXPORTS — logica pura accessibile ai test (node:test)
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NEWS_SOURCES,
    classifyCategory,
    parseGoogleNewsXml,
    decodeEntities,
    stripTags,
    hashText,
    normalizeArticle,
    fetchFeed,
    keyArticle,
    emptyCursor,
    cursorWithArticles,
    mergeCursorKeys,
    diffNewArticles,
    getWatchConfig,
    getCursor,
    saveCursor,
    pollNewsOnce
  };
}