/* =====================================================
   Download Manager — newtab.js
   Material You  ·  Chrome Extension MV3
   ===================================================== */

'use strict';

// ─── Constants ────────────────────────────────────────────

const PREFS_KEY = 'dm_prefs_v1';

const DEFAULT_PREFS = {
  viewMode:       'grid',   // 'grid' | 'list' | 'compact'
  sort:           'date-desc',
  filter:         'all',
  hideMissing:    false,
  showShortcuts:  false,
};

const FILTERS = [
  { id: 'all',        label: 'All',        icon: 'folder_open'      },
  { id: 'image',      label: 'Images',     icon: 'image'            },
  { id: 'video',      label: 'Videos',     icon: 'movie'            },
  { id: 'audio',      label: 'Audio',      icon: 'music_note'       },
  { id: 'document',   label: 'Documents',  icon: 'description'      },
  { id: 'archive',    label: 'Archives',   icon: 'folder_zip'       },
  { id: 'code',       label: 'Code',       icon: 'code'             },
  { id: 'executable', label: 'Programs',   icon: 'terminal'         },
  { id: 'other',      label: 'Other',      icon: 'insert_drive_file'},
];

const TYPE_EXTS = {
  image:      ['jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff','avif','heic','heif'],
  video:      ['mp4','mkv','avi','mov','wmv','flv','webm','m4v','mpg','mpeg','ogv','3gp'],
  audio:      ['mp3','wav','flac','aac','ogg','m4a','wma','opus','aiff'],
  document:   ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','odt','ods','odp','rtf','csv','epub','mobi','pages','numbers','key'],
  archive:    ['zip','rar','7z','tar','gz','bz2','xz','dmg','pkg','deb','rpm','iso','img'],
  code:       ['js','ts','jsx','tsx','py','java','cpp','c','h','hpp','cs','go','rs','rb','php','css','scss','html','htm','xml','json','yaml','yml','toml','sh','bash','zsh','md','sql','swift','kt','dart','vue','svelte'],
  executable: ['exe','msi','app','bat','cmd','apk','ipa'],
};

// Tonal colors per type — light and dark variants
const TYPE_PALETTE_LIGHT = {
  image:      { bg: '#E8F5E9', icon: '#2E7D32' },
  video:      { bg: '#FFEBEE', icon: '#C62828' },
  audio:      { bg: '#FFF3E0', icon: '#E65100' },
  document:   { bg: '#E3F2FD', icon: '#1565C0' },
  archive:    { bg: '#F3E5F5', icon: '#6A1B9A' },
  code:       { bg: '#E8EAF6', icon: '#283593' },
  executable: { bg: '#EFEBE9', icon: '#4E342E' },
  other:      { bg: '#F5F5F5', icon: '#424242' },
};
const TYPE_PALETTE_DARK = {
  image:      { bg: '#1B3D1E', icon: '#81C784' },
  video:      { bg: '#3B1A1A', icon: '#EF9A9A' },
  audio:      { bg: '#3D2600', icon: '#FFCC80' },
  document:   { bg: '#0D2A4A', icon: '#90CAF9' },
  archive:    { bg: '#2D1040', icon: '#CE93D8' },
  code:       { bg: '#1A1F50', icon: '#9FA8DA' },
  executable: { bg: '#2C1E18', icon: '#BCAAA4' },
  other:      { bg: '#272727', icon: '#BDBDBD' },
};

function getTypePalette() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? TYPE_PALETTE_DARK
    : TYPE_PALETTE_LIGHT;
}

// Keep TYPE_PALETTE as a live proxy
const TYPE_PALETTE = new Proxy({}, { get: (_, k) => getTypePalette()[k] });

const TYPE_ICON = {
  image:      'image',
  video:      'movie',
  audio:      'music_note',
  document:   'description',
  archive:    'folder_zip',
  code:       'code',
  executable: 'terminal',
  other:      'insert_drive_file',
};

// ─── State ────────────────────────────────────────────────

let allDownloads = [];
let prefs        = loadPrefs();
let searchQuery  = '';
let selectedIdx  = -1;
let snackTimer   = null;

// ─── Preferences ──────────────────────────────────────────

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// ─── Chrome API helpers ───────────────────────────────────

function chromeSearch(query) {
  return new Promise((resolve, reject) => {
    if (!chrome?.downloads) { resolve(getMockData()); return; }
    chrome.downloads.search(query, items => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(items);
    });
  });
}

async function loadDownloads() {
  return chromeSearch({ orderBy: ['-startTime'], limit: 0 });
}

// ─── File type helpers ────────────────────────────────────

function extOf(path) {
  if (!path) return '';
  const name = path.split(/[\\/]/).pop().split('?')[0];
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function typeOf(dl) {
  const ext = extOf(dl.filename || dl.url || '');
  for (const [type, exts] of Object.entries(TYPE_EXTS)) {
    if (exts.includes(ext)) return type;
  }
  return 'other';
}

function basename(path) {
  if (!path) return 'Unknown file';
  return path.split(/[\\/]/).pop() || path;
}

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url || '—'; }
}

function fmtBytes(n) {
  if (!n || n <= 0) return '—';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4);
  return `${(n / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso), now = Date.now();
  const s = Math.floor((now - d) / 1000);
  if (s < 60)  return 'Just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  if (s < 172800) return 'Yesterday';
  if (s < 604800) return `${Math.floor(s/86400)}d ago`;
  if (s < 2592000) return `${Math.floor(s/604800)}w ago`;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year: s > 31536000 ? 'numeric' : undefined });
}

// ─── Filter / Sort ────────────────────────────────────────

function getView() {
  let items = [...allDownloads];

  // search
  if (searchQuery) {
    const q = searchQuery;
    items = items.filter(d => {
      const n = basename(d.filename).toLowerCase();
      const u = (d.url || '').toLowerCase();
      const dom = domain(d.url || '').toLowerCase();
      return n.includes(q) || u.includes(q) || dom.includes(q);
    });
  }

  // hide missing files
  if (prefs.hideMissing) {
    items = items.filter(d => d.exists !== false && d.state !== 'interrupted');
  }

  // type filter
  if (prefs.filter !== 'all') {
    items = items.filter(d => typeOf(d) === prefs.filter);
  }

  // sort
  const [by, dir] = prefs.sort.split('-');
  items.sort((a, b) => {
    let cmp = 0;
    if (by === 'date')   cmp = new Date(a.startTime) - new Date(b.startTime);
    if (by === 'name')   cmp = basename(a.filename).localeCompare(basename(b.filename));
    if (by === 'size')   cmp = (a.fileSize || 0) - (b.fileSize || 0);
    if (by === 'source') cmp = domain(a.url||'').localeCompare(domain(b.url||''));
    return dir === 'desc' ? -cmp : cmp;
  });

  return items;
}

// ─── Rendering ────────────────────────────────────────────

function renderFilterChips() {
  const el = document.getElementById('filter-chips');
  el.innerHTML = FILTERS.map((f, i) => {
    const active = prefs.filter === f.id;
    const count  = f.id === 'all'
      ? allDownloads.length
      : allDownloads.filter(d => typeOf(d) === f.id).length;

    return `<button class="filter-chip${active ? ' active' : ''}" data-filter="${f.id}" role="tab" aria-selected="${active}" title="${f.label} [${i + 1}]">
        <span class="material-symbols-rounded" style="font-size:15px;">${f.icon}</span>
        ${f.label}
        <span class="chip-count">${count}</span>
      </button>`;
  }).join('');

  el.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      prefs.filter = btn.dataset.filter;
      savePrefs();
      selectedIdx = -1;
      renderFilterChips();
      renderDownloads();
    });
  });
}

function statusBadge(dl) {
  if (dl.state === 'in_progress') {
    if (dl.paused) return `<span class="badge badge-neutral">Paused</span>`;
    const pct = dl.totalBytes > 0 ? Math.round(dl.bytesReceived / dl.totalBytes * 100) : 0;
    return `<span class="badge badge-primary progress-active">${pct}%</span>`;
  }
  if (dl.state === 'interrupted') return `<span class="badge badge-error">Failed</span>`;
  if (dl.exists === false)        return `<span class="badge badge-neutral">Missing</span>`;
  return '';
}

function actionBtns(dl) {
  const btns = [];
  if (dl.state === 'in_progress') {
    if (dl.paused) {
      btns.push(`<button data-action="resume" class="action-btn" title="Resume"><span class="material-symbols-rounded" style="font-size:18px;">play_arrow</span></button>`);
    } else {
      btns.push(`<button data-action="pause" class="action-btn" title="Pause"><span class="material-symbols-rounded" style="font-size:18px;">pause</span></button>`);
    }
    btns.push(`<button data-action="cancel" class="action-btn danger" title="Cancel"><span class="material-symbols-rounded" style="font-size:18px;">close</span></button>`);
  } else {
    if (dl.exists !== false) {
      btns.push(`<button data-action="open" class="action-btn" title="Open [Enter]"><span class="material-symbols-rounded" style="font-size:18px;">open_in_new</span></button>`);
      btns.push(`<button data-action="show" class="action-btn" title="Show in folder [F]"><span class="material-symbols-rounded" style="font-size:18px;">folder_open</span></button>`);
    }
    btns.push(`<button data-action="erase" class="action-btn danger" title="Remove [Del]"><span class="material-symbols-rounded" style="font-size:18px;">delete</span></button>`);
  }
  return btns.join('');
}

function progressBar(dl) {
  if (dl.state !== 'in_progress' || dl.paused || dl.totalBytes <= 0) return '';
  const pct = Math.round(dl.bytesReceived / dl.totalBytes * 100);
  return `<div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>`;
}

function gridCard(dl, idx) {
  const t    = typeOf(dl), pal = TYPE_PALETTE[t];
  const name = basename(dl.filename);
  const ext  = extOf(dl.filename || dl.url || '');
  const meta = [fmtDate(dl.startTime), domain(dl.url || ''), dl.fileSize > 0 ? fmtBytes(dl.fileSize || dl.bytesReceived) : ''].filter(Boolean).join(' · ');
  const sel  = idx === selectedIdx;

  return `<div class="download-card${sel ? ' is-selected' : ''}" data-id="${dl.id}" data-idx="${idx}" tabindex="0" role="button" aria-label="${name}">
    <div class="card-icon" style="background:${pal.bg}"><span class="material-symbols-rounded" style="color:${pal.icon};font-size:22px;">${TYPE_ICON[t]}</span></div>
    <p class="card-name" title="${name}">${name}</p>
    ${ext ? `<p class="card-ext">${ext}</p>` : ''}
    <p class="card-meta">${meta}</p>
    ${statusBadge(dl)}${progressBar(dl)}
    <div class="actions">${actionBtns(dl)}</div>
  </div>`;
}

function listItem(dl, idx) {
  const t    = typeOf(dl), pal = TYPE_PALETTE[t];
  const name = basename(dl.filename);
  const meta = [domain(dl.url || ''), dl.fileSize > 0 ? fmtBytes(dl.fileSize || dl.bytesReceived) : ''].filter(Boolean).join(' · ');
  const sel  = idx === selectedIdx;

  return `<div class="download-item${sel ? ' is-selected' : ''}" data-id="${dl.id}" data-idx="${idx}" tabindex="0" role="button" aria-label="${name}">
    <div style="width:2.25rem;height:2.25rem;border-radius:0.625rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${pal.bg}"><span class="material-symbols-rounded" style="color:${pal.icon};font-size:19px;">${TYPE_ICON[t]}</span></div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:0.375rem;"><span style="font-size:0.875rem;font-weight:500;color:var(--on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</span>${statusBadge(dl)}</div>
      <p style="margin:0.15rem 0 0;font-size:0.7rem;color:var(--on-surface-variant);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${meta}</p>
      ${progressBar(dl)}
    </div>
    <span style="font-size:0.7rem;color:var(--on-surface-variant);flex-shrink:0;white-space:nowrap;">${fmtDate(dl.startTime)}</span>
    <div class="actions">${actionBtns(dl)}</div>
  </div>`;
}

function compactRow(dl, idx) {
  const t   = typeOf(dl), pal = TYPE_PALETTE[t];
  const name = basename(dl.filename);
  const ext  = extOf(dl.filename || dl.url || '');
  const sel  = idx === selectedIdx;
  const c    = 'flex-shrink:0;font-size:0.72rem;color:var(--on-surface-variant);';

  return `<div class="download-item${sel ? ' is-selected' : ''}" data-id="${dl.id}" data-idx="${idx}" tabindex="0" role="button" aria-label="${name}" style="gap:0.625rem;padding:0.3rem 0.75rem;">
    <div style="width:1.75rem;height:1.75rem;border-radius:0.5rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${pal.bg}"><span class="material-symbols-rounded" style="color:${pal.icon};font-size:15px;">${TYPE_ICON[t]}</span></div>
    <span style="flex:1;min-width:0;font-size:0.875rem;color:var(--on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</span>
    ${statusBadge(dl)}
    <span style="${c}width:3.25rem;text-transform:uppercase;letter-spacing:0.03em;">${ext || '—'}</span>
    <span style="${c}width:5rem;text-align:right;">${fmtBytes(dl.fileSize || dl.bytesReceived)}</span>
    <span style="${c}width:9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${domain(dl.url || '')}</span>
    <span style="${c}width:6.5rem;text-align:right;">${fmtDate(dl.startTime)}</span>
    <div class="actions" style="width:4.5rem;justify-content:flex-end;">${actionBtns(dl)}</div>
  </div>`;
}

const COMPACT_HEADER = `
  <div style="display:flex;align-items:center;gap:0.625rem;padding:0.25rem 0.75rem 0.5rem;
              font-size:0.7rem;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;
              color:var(--on-surface-variant);border-bottom:1px solid var(--outline-variant);
              margin-bottom:0.25rem;user-select:none;">
    <div style="width:1.75rem;flex-shrink:0;"></div>
    <span style="flex:1;min-width:0;">Name</span>
    <span style="width:3.25rem;flex-shrink:0;">Type</span>
    <span style="width:5rem;flex-shrink:0;text-align:right;">Size</span>
    <span style="width:9rem;flex-shrink:0;">Source</span>
    <span style="width:6.5rem;flex-shrink:0;text-align:right;">Downloaded</span>
    <div style="width:4.5rem;flex-shrink:0;"></div>
  </div>
`;

function renderDownloads() {
  const area    = document.getElementById('downloads-area');
  const empty   = document.getElementById('state-empty');
  const loading = document.getElementById('state-loading');
  const count   = document.getElementById('download-count');

  loading.classList.add('hidden');

  const items = getView();
  count.textContent = `${items.length} file${items.length !== 1 ? 's' : ''}`;

  if (items.length === 0) {
    teardownVS();
    area.innerHTML = '';
    empty.classList.remove('hidden');
    empty.classList.add('flex');
    const sub = document.getElementById('empty-subtitle');
    if (searchQuery) sub.textContent = `No files matching "${searchQuery}"`;
    else if (prefs.filter !== 'all') sub.textContent = `No ${prefs.filter} files in your downloads`;
    else sub.textContent = 'Your downloads will appear here once you download something in Chrome.';
    return;
  }

  empty.classList.add('hidden');
  empty.classList.remove('flex');
  teardownVS();
  _selectedEl = null;
  setupVS(items); // all views use virtual scroll — no item cap
}

// ─── Virtual scroll ───────────────────────────────────────

const VS = { active: false, items: [], rowHeight: 60, cols: 1 };
let _vsRAF = null;

function getGridCols() {
  const w = window.innerWidth;
  if (w >= 1536) return 8;
  if (w >= 1280) return 6;
  if (w >= 1024) return 5;
  if (w >= 768)  return 4;
  if (w >= 640)  return 3;
  return 2;
}

function vsRowHeight() {
  if (prefs.viewMode === 'grid')    return 188; // card height + 1rem gap
  if (prefs.viewMode === 'compact') return 36;
  return 60;
}

function renderVS() {
  if (!VS.active) return;
  const area    = document.getElementById('downloads-area');
  const spacer  = area.querySelector('.vs-spacer');
  const content = area.querySelector('.vs-content');
  if (!spacer || !content) return;

  const cols      = VS.cols;
  const rh        = VS.rowHeight;
  const areaTop   = area.getBoundingClientRect().top + window.scrollY;
  const relScroll = Math.max(0, window.scrollY - areaTop);
  const buf       = cols === 1 ? 8 : 3;

  const startRow  = Math.max(0, Math.floor(relScroll / rh) - buf);
  const endRow    = Math.min(
    Math.ceil(VS.items.length / cols),
    startRow + Math.ceil(window.innerHeight / rh) + buf * 2
  );
  const startIdx  = startRow * cols;
  const endIdx    = Math.min(VS.items.length, endRow * cols);

  content.style.cssText = `position:absolute;top:${startRow * rh}px;left:0;right:0;`;

  if (cols > 1) {
    content.style.display              = 'grid';
    content.style.gridTemplateColumns  = `repeat(${cols}, minmax(0,1fr))`;
    content.style.gap                  = '1rem';
    content.innerHTML = VS.items.slice(startIdx, endIdx)
      .map((d, i) => gridCard(d, startIdx + i)).join('');
  } else {
    const fn = prefs.viewMode === 'compact' ? compactRow : listItem;
    content.innerHTML = VS.items.slice(startIdx, endIdx)
      .map((d, i) => fn(d, startIdx + i)).join('');
  }

  if (selectedIdx >= 0) {
    _selectedEl = content.querySelector(`[data-idx="${selectedIdx}"]`);
    if (_selectedEl) _selectedEl.classList.add('is-selected');
  }
}

function setupVS(items) {
  VS.active    = true;
  VS.items     = items;
  VS.cols      = prefs.viewMode === 'grid' ? getGridCols() : 1;
  VS.rowHeight = vsRowHeight();

  const rows   = Math.ceil(items.length / VS.cols);
  const area   = document.getElementById('downloads-area');
  const header = prefs.viewMode === 'compact' ? COMPACT_HEADER : '';
  area.innerHTML = `${header}<div class="vs-spacer" style="position:relative;height:${rows * VS.rowHeight}px;"><div class="vs-content"></div></div>`;
  renderVS();
}

function recalcVS() {
  if (!VS.active) return;
  const newCols = prefs.viewMode === 'grid' ? getGridCols() : 1;
  if (newCols !== VS.cols) {
    VS.cols = newCols;
    const spacer = document.querySelector('.vs-spacer');
    if (spacer) spacer.style.height = `${Math.ceil(VS.items.length / VS.cols) * VS.rowHeight}px`;
  }
  renderVS();
}

function teardownVS() {
  VS.active = false;
  VS.items  = [];
  VS.cols   = 1;
}

// ─── Selection ────────────────────────────────────────────

let _selectedEl = null;

function selectItem(idx) {
  if (_selectedEl) _selectedEl.classList.remove('is-selected');
  selectedIdx = idx;

  if (VS.active) {
    const rh      = VS.rowHeight;
    const area    = document.getElementById('downloads-area');
    const areaTop = area.getBoundingClientRect().top + window.scrollY;
    const row     = Math.floor(idx / VS.cols);
    const itemTop = areaTop + row * rh;
    const itemBot = itemTop + rh;
    const sTop    = window.scrollY;
    const viewH   = window.innerHeight;
    if (itemTop < sTop + 64)          window.scrollTo({ top: Math.max(0, itemTop - 64), behavior: 'instant' });
    else if (itemBot > sTop + viewH)  window.scrollTo({ top: itemBot - viewH + 8,       behavior: 'instant' });
    renderVS();
  }

  _selectedEl = document.querySelector(`[data-idx="${idx}"]`);
  if (_selectedEl) {
    _selectedEl.classList.add('is-selected');
    _selectedEl.focus({ preventScroll: true });
  }
}

// ─── Actions ──────────────────────────────────────────────

function dispatchAction(action, id, el) {
  switch (action) {
    case 'open':   doOpen(id); break;
    case 'show':   doShow(id); break;
    case 'erase':  doErase(id, el); break;
    case 'pause':
      chrome.downloads.pause(id, () => { snack('Download paused'); refreshOne(id); });
      break;
    case 'resume':
      chrome.downloads.resume(id, () => { snack('Download resumed'); refreshOne(id); });
      break;
    case 'cancel':
      chrome.downloads.cancel(id, () => { snack('Download cancelled'); refreshOne(id); });
      break;
  }
}

function doOpen(id) {
  if (!chrome?.downloads) { snack('Cannot open in demo mode'); return; }
  const dl = allDownloads.find(d => d.id === id);
  if (dl?.exists === false) { snack('File no longer exists on disk'); return; }
  chrome.downloads.open(id);
}

function doShow(id) {
  if (!chrome?.downloads) { snack('Cannot show in demo mode'); return; }
  chrome.downloads.show(id);
}

function doErase(id, el) {
  if (el) {
    el.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.96)';
  }
  setTimeout(() => {
    if (chrome?.downloads) {
      chrome.downloads.erase({ id }, () => {
        allDownloads = allDownloads.filter(d => d.id !== id);
        selectedIdx = -1;
        renderFilterChips();
        renderDownloads();
        snack('Removed from downloads list');
      });
    } else {
      allDownloads = allDownloads.filter(d => d.id !== id);
      selectedIdx = -1;
      renderFilterChips();
      renderDownloads();
      snack('Removed from downloads list');
    }
  }, 180);
}

function refreshOne(id) {
  if (!chrome?.downloads) return;
  chrome.downloads.search({ id }, ([updated]) => {
    if (!updated) return;
    const i = allDownloads.findIndex(d => d.id === id);
    if (i >= 0) allDownloads[i] = updated;
    renderDownloads();
  });
}

// ─── Snackbar ─────────────────────────────────────────────

function snack(msg) {
  const el = document.getElementById('snackbar');
  clearTimeout(snackTimer);
  el.textContent = msg;
  el.classList.add('show');
  snackTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── Keyboard ─────────────────────────────────────────────

function setupKeyboard() {
  document.addEventListener('keydown', e => {
    const inSearch = document.activeElement === document.getElementById('search-input');
    const items    = getView();

    if (e.key === 'Escape') {
      if (searchQuery) {
        document.getElementById('search-input').value = '';
        searchQuery = '';
        document.getElementById('btn-clear-search').classList.add('hidden');
        selectedIdx = -1;
        renderFilterChips();
        renderDownloads();
      } else {
        selectedIdx = -1;
        document.querySelectorAll('[data-id]').forEach(el => el.classList.remove('is-selected'));
        document.getElementById('search-input').blur();
      }
      return;
    }

    if (inSearch) return; // Let search input handle typing

    switch (e.key) {
      case '/':
        e.preventDefault();
        document.getElementById('search-input').focus();
        document.getElementById('search-input').select();
        break;

      case 'ArrowDown':
      case 'j':
        e.preventDefault();
        selectItem(Math.min(selectedIdx + 1, items.length - 1));
        break;

      case 'ArrowUp':
      case 'k':
        e.preventDefault();
        selectItem(Math.max(selectedIdx - 1, 0));
        break;

      case 'ArrowRight':
        if (prefs.viewMode === 'grid') { e.preventDefault(); selectItem(Math.min(selectedIdx + 1, items.length - 1)); }
        break;
      case 'ArrowLeft':
        if (prefs.viewMode === 'grid') { e.preventDefault(); selectItem(Math.max(selectedIdx - 1, 0)); }
        break;

      case 'Enter':
        if (selectedIdx >= 0 && selectedIdx < items.length) {
          e.preventDefault();
          doOpen(items[selectedIdx].id);
        }
        break;

      case 'f':
      case 'F':
        if (selectedIdx >= 0 && selectedIdx < items.length) {
          e.preventDefault();
          doShow(items[selectedIdx].id);
        }
        break;

      case 'Delete':
      case 'Backspace':
        if (selectedIdx >= 0 && selectedIdx < items.length) {
          e.preventDefault();
          const el = document.querySelector(`[data-idx="${selectedIdx}"]`);
          doErase(items[selectedIdx].id, el);
        }
        break;

      case '?':
        toggleShortcuts(); break;

      case 'g': case 'G':
        setView('grid'); break;
      case 'l': case 'L':
        setView('list'); break;
      case 'c': case 'C':
        setView('compact'); break;

      case 'r': case 'R':
        if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); doRefresh(); }
        break;

      default:
        if (e.key >= '1' && e.key <= '9') {
          const fi = parseInt(e.key, 10) - 1;
          if (fi < FILTERS.length) {
            prefs.filter = FILTERS[fi].id;
            savePrefs();
            selectedIdx = -1;
            renderFilterChips();
            renderDownloads();
          }
        }
    }
  });
}

// ─── Shortcuts panel ──────────────────────────────────────

function syncShortcutsPanel() {
  const panel = document.getElementById('shortcuts-panel');
  const btn   = document.getElementById('btn-shortcuts');
  const on    = prefs.showShortcuts;
  panel.classList.toggle('open', on);
  btn.setAttribute('aria-expanded', String(on));
  btn.style.backgroundColor = on ? 'var(--secondary-container)' : '';
  btn.style.color            = on ? 'var(--on-secondary-container)' : '';
}

function toggleShortcuts() {
  prefs.showShortcuts = !prefs.showShortcuts;
  savePrefs();
  syncShortcutsPanel();
}

// ─── Hide missing ─────────────────────────────────────────

function syncHideMissingBtn() {
  const btn = document.getElementById('btn-hide-missing');
  btn.setAttribute('aria-pressed', String(prefs.hideMissing));
  btn.classList.toggle('active', prefs.hideMissing);
}

// ─── View mode ────────────────────────────────────────────

function setView(mode) {
  prefs.viewMode = mode;
  savePrefs();
  document.getElementById('btn-grid-view').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-list-view').classList.toggle('active', mode === 'list');
  document.getElementById('btn-compact-view').classList.toggle('active', mode === 'compact');
  renderDownloads();
}

// ─── Search ───────────────────────────────────────────────

function setupSearch() {
  const input   = document.getElementById('search-input');
  const clearBtn = document.getElementById('btn-clear-search');
  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    searchQuery = input.value.trim().toLowerCase();
    clearBtn.classList.toggle('hidden', !searchQuery);
    clearBtn.style.display = searchQuery ? 'flex' : 'none';
    timer = setTimeout(() => {
      selectedIdx = -1;
      renderFilterChips();
      renderDownloads();
    }, 150);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    searchQuery = '';
    clearBtn.classList.add('hidden');
    clearBtn.style.display = 'none';
    selectedIdx = -1;
    renderFilterChips();
    renderDownloads();
    input.focus();
  });
}

// ─── Sort ─────────────────────────────────────────────────

function setupSort() {
  const sel = document.getElementById('sort-select');
  sel.value = prefs.sort;
  sel.addEventListener('change', () => {
    prefs.sort = sel.value;
    savePrefs();
    selectedIdx = -1;
    renderDownloads();
  });
}

// ─── Load & refresh ───────────────────────────────────────

async function doRefresh() {
  const area    = document.getElementById('downloads-area');
  const loading = document.getElementById('state-loading');
  const empty   = document.getElementById('state-empty');

  area.innerHTML = '';
  empty.classList.add('hidden');
  empty.classList.remove('flex');
  loading.classList.remove('hidden');
  selectedIdx = -1;

  try {
    allDownloads = await loadDownloads();
    renderFilterChips();
    renderDownloads();
  } catch (err) {
    console.error('Download Manager: failed to load', err);
    loading.classList.add('hidden');
    snack('Failed to load downloads');
  }
}

// ─── Mock data (fallback when Chrome API unavailable) ─────

function getMockData() {
  const now = Date.now();
  const h   = 3600000, d = 86400000;
  return [
    { id:1,  filename:'/Users/demo/Downloads/Annual_Report_2025.pdf',        url:'https://drive.google.com/uc?id=abc123',             startTime:new Date(now - 15*60000).toISOString(),   fileSize:3145728,    state:'complete',     exists:true,  bytesReceived:3145728,    totalBytes:3145728 },
    { id:2,  filename:'/Users/demo/Downloads/vacation_photos.zip',           url:'https://photos.google.com/share/export.zip',        startTime:new Date(now - 2*h).toISOString(),        fileSize:156237890,  state:'complete',     exists:true,  bytesReceived:156237890,  totalBytes:156237890 },
    { id:3,  filename:'/Users/demo/Downloads/design_mockup.fig',             url:'https://figma.com/export/file.fig',                 startTime:new Date(now - 5*h).toISOString(),        fileSize:45123456,   state:'complete',     exists:true,  bytesReceived:45123456,   totalBytes:45123456 },
    { id:4,  filename:'/Users/demo/Downloads/ubuntu-24.04-desktop-amd64.iso',url:'https://releases.ubuntu.com/24.04/ubuntu.iso',     startTime:new Date(now - 1*d).toISOString(),        fileSize:2100000000, state:'complete',     exists:true,  bytesReceived:2100000000, totalBytes:2100000000 },
    { id:5,  filename:'/Users/demo/Downloads/project_backup.tar.gz',         url:'https://github.com/user/repo/archive/main.tar.gz', startTime:new Date(now - 2*d).toISOString(),        fileSize:28311552,   state:'complete',     exists:true,  bytesReceived:28311552,   totalBytes:28311552 },
    { id:6,  filename:'/Users/demo/Downloads/intro_to_ml.mp4',               url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',      startTime:new Date(now - 3*d).toISOString(),        fileSize:892416000,  state:'complete',     exists:true,  bytesReceived:892416000,  totalBytes:892416000 },
    { id:7,  filename:'/Users/demo/Downloads/podcast_ep42.mp3',              url:'https://anchor.fm/show/episode42.mp3',              startTime:new Date(now - 4*d).toISOString(),        fileSize:67108864,   state:'complete',     exists:true,  bytesReceived:67108864,   totalBytes:67108864 },
    { id:8,  filename:'/Users/demo/Downloads/hero_illustration.png',         url:'https://dribbble.com/shots/hero.png',               startTime:new Date(now - 4*d - 3*h).toISOString(), fileSize:5242880,    state:'complete',     exists:true,  bytesReceived:5242880,    totalBytes:5242880 },
    { id:9,  filename:'/Users/demo/Downloads/large_dataset.csv',             url:'https://kaggle.com/datasets/download.csv',          startTime:new Date(now - 5*d).toISOString(),        fileSize:524288000,  state:'in_progress',  exists:true,  bytesReceived:209715200,  totalBytes:524288000,  paused:false },
    { id:10, filename:'/Users/demo/Downloads/app_installer.dmg',             url:'https://releases.myapp.com/installer_v3.2.dmg',    startTime:new Date(now - 6*d).toISOString(),        fileSize:134217728,  state:'complete',     exists:false, bytesReceived:134217728,  totalBytes:134217728 },
    { id:11, filename:'/Users/demo/Downloads/utils.py',                      url:'https://gist.github.com/user/abc/utils.py',         startTime:new Date(now - 7*d).toISOString(),        fileSize:12288,      state:'complete',     exists:true,  bytesReceived:12288,      totalBytes:12288 },
    { id:12, filename:'/Users/demo/Downloads/brand_assets.zip',              url:'https://notion.so/assets/brand.zip',                startTime:new Date(now - 10*d).toISOString(),       fileSize:18874368,   state:'complete',     exists:true,  bytesReceived:18874368,   totalBytes:18874368 },
    { id:13, filename:'/Users/demo/Downloads/Q4_spreadsheet.xlsx',           url:'https://docs.google.com/spreadsheets/export.xlsx',  startTime:new Date(now - 12*d).toISOString(),       fileSize:2097152,    state:'complete',     exists:true,  bytesReceived:2097152,    totalBytes:2097152 },
    { id:14, filename:'/Users/demo/Downloads/sample_animation.gif',          url:'https://giphy.com/gifs/sample.gif',                 startTime:new Date(now - 14*d).toISOString(),       fileSize:8388608,    state:'interrupted',  exists:true,  bytesReceived:2097152,    totalBytes:8388608 },
  ];
}

// ─── Event delegation ─────────────────────────────────────

function setupAreaDelegation() {
  const area = document.getElementById('downloads-area');

  area.addEventListener('click', e => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const id  = parseInt(card.dataset.id, 10);
    const idx = parseInt(card.dataset.idx, 10);
    const btn = e.target.closest('[data-action]');
    if (btn) dispatchAction(btn.dataset.action, id, card);
    else selectItem(idx);
  });

  area.addEventListener('dblclick', e => {
    const card = e.target.closest('[data-id]');
    if (!card || e.target.closest('[data-action]')) return;
    doOpen(parseInt(card.dataset.id, 10));
  });

  area.addEventListener('keydown', e => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const id = parseInt(card.dataset.id, 10);
    if (e.key === 'Enter')                              { e.preventDefault(); doOpen(id); }
    if (e.key === 'f' || e.key === 'F')                { e.preventDefault(); doShow(id); }
    if (e.key === 'Delete' || e.key === 'Backspace')   { e.preventDefault(); doErase(id, card); }
  });
}

// ─── Chrome realtime listeners ────────────────────────────

function setupRealtimeListeners() {
  if (!chrome?.downloads) return;

  chrome.downloads.onCreated.addListener(dl => {
    allDownloads.unshift(dl);
    renderFilterChips();
    renderDownloads();
    snack('New download started');
  });

  chrome.downloads.onChanged.addListener(delta => {
    const i = allDownloads.findIndex(d => d.id === delta.id);
    if (i < 0) return;
    // Apply the delta fields
    Object.keys(delta).forEach(k => {
      if (k === 'id') return;
      if (delta[k] && typeof delta[k] === 'object' && 'current' in delta[k]) {
        allDownloads[i][k] = delta[k].current;
      }
    });
    renderDownloads();
  });

  chrome.downloads.onErased.addListener(id => {
    allDownloads = allDownloads.filter(d => d.id !== id);
    renderFilterChips();
    renderDownloads();
  });
}

// ─── Init ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupSearch();
  setupSort();
  setupKeyboard();
  setupAreaDelegation();
  setupRealtimeListeners();

  document.getElementById('btn-shortcuts').addEventListener('click', toggleShortcuts);
  document.getElementById('btn-shortcuts-close').addEventListener('click', toggleShortcuts);
  syncShortcutsPanel();

  document.getElementById('btn-hide-missing').addEventListener('click', () => {
    prefs.hideMissing = !prefs.hideMissing;
    savePrefs();
    syncHideMissingBtn();
    selectedIdx = -1;
    renderDownloads();
  });
  syncHideMissingBtn();

  document.getElementById('btn-grid-view').addEventListener('click', () => setView('grid'));
  document.getElementById('btn-list-view').addEventListener('click', () => setView('list'));
  document.getElementById('btn-compact-view').addEventListener('click', () => setView('compact'));
  document.getElementById('btn-refresh').addEventListener('click', () => { doRefresh(); snack('Refreshed'); });

  // Set initial view button state
  document.getElementById('btn-grid-view').classList.toggle('active', prefs.viewMode === 'grid');
  document.getElementById('btn-list-view').classList.toggle('active', prefs.viewMode === 'list');
  document.getElementById('btn-compact-view').classList.toggle('active', prefs.viewMode === 'compact');

  window.addEventListener('scroll', () => {
    if (!VS.active) return;
    if (_vsRAF) return;
    _vsRAF = requestAnimationFrame(() => { _vsRAF = null; renderVS(); });
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (VS.active) recalcVS();
  }, { passive: true });

  doRefresh();
});
