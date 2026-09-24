/* Public Language site (public-site spec phase D): a small, dependency-free
 * reader over the read-only public API. Its ONLY runtime dependency is
 * PUBLIC_API_BASE — no database, no sessions, no cookies. Routes are real
 * paths (/, /search, /entry/:uid) so links, canonical URLs, and the sitemap
 * are shareable. */
'use strict';

const API = window.PUBLIC_API_BASE;
const main = document.getElementById('main');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw Object.assign(new Error('not found'), { status: res.status });
  return res.json();
}

const fmtDuration = (s) => {
  s = Math.round(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

let siteConfig = { site_title: 'Language Collection', site_description: '' };

function navigate(url) {
  history.pushState(null, '', url);
  route();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', route);

const searchBox = (value = '') => `
  <form class="search" role="search" action="/search" data-search>
    <label class="visually-hidden" for="q">Search the collection</label>
    <input id="q" name="q" type="search" value="${esc(value)}"
      placeholder="Search in Dene or English…" autocomplete="off">
    <button type="submit">Search</button>
  </form>`;

function wireSearch() {
  document.querySelector('[data-search]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  });
}

const entryRow = (e) => `
  <li>
    <a class="entry-row" href="/entry/${esc(e.uid)}">
      <span class="dene" lang="den">${esc(e.dene_text) || '—'}</span>
      <span class="english">${esc(e.english_text) || ''}</span>
      <span class="row-meta">
        <span class="badge">${e.kind === 'phrase' ? 'Phrase' : 'Word'}</span>
        ${e.recording_count ? `<span class="badge audio" aria-label="${e.recording_count} recordings">🔊 ${e.recording_count}</span>` : ''}
      </span>
    </a>
  </li>`;

const FILTER_KEYS = ['kind', 'category', 'has_audio'];

/** The active list filters, read from the filter bar (empty values omitted). */
function currentFilters() {
  const f = document.querySelector('[data-filters]');
  const out = {};
  if (f) for (const k of FILTER_KEYS) { if (f[k].value) out[k] = f[k].value; }
  return out;
}

async function renderHome() {
  document.title = siteConfig.site_title;
  main.innerHTML = `
    <section class="hero">
      <h1>${esc(siteConfig.site_title)}</h1>
      ${siteConfig.site_description ? `<p class="lede">${esc(siteConfig.site_description)}</p>` : ''}
      ${searchBox()}
      <form class="filters" data-filters aria-label="Filter the collection">
        <label>Type
          <select name="kind">
            <option value="">Words &amp; phrases</option>
            <option value="word">Words</option>
            <option value="phrase">Phrases</option>
          </select></label>
        <label>Category
          <select name="category"><option value="">All categories</option></select></label>
        <label>Audio
          <select name="has_audio">
            <option value="">All entries</option>
            <option value="yes">With audio</option>
            <option value="no">Without audio</option>
          </select></label>
      </form>
    </section>
    <section aria-labelledby="browse-head">
      <h2 id="browse-head" class="visually-hidden">Entries</h2>
      <div id="list" aria-live="polite"><p class="muted">Loading…</p></div>
    </section>`;
  wireSearch();

  // Filters live in the URL so filtered views are shareable and survive
  // back/forward. Unknown values simply fall back to "all".
  const params = new URLSearchParams(location.search);
  const f = document.querySelector('[data-filters]');
  f.kind.value = params.get('kind') ?? '';
  if (f.kind.selectedIndex === -1) f.kind.value = '';
  f.has_audio.value = params.get('has_audio') ?? '';
  if (f.has_audio.selectedIndex === -1) f.has_audio.value = '';
  try {
    const { categories } = await api('/categories');
    if (categories.length) {
      f.category.innerHTML = '<option value="">All categories</option>' +
        categories.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    } else {
      f.category.closest('label').hidden = true;
    }
  } catch { f.category.closest('label').hidden = true; }
  f.category.value = params.get('category') ?? '';
  if (f.category.selectedIndex === -1) f.category.value = '';

  f.addEventListener('change', () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(currentFilters())) qs.set(k, v);
    const s = qs.toString();
    history.replaceState(null, '', s ? `/?${s}` : '/');
    loadList(0);
  });
  loadList(0);
}

async function loadList(offset) {
  const box = document.getElementById('list');
  if (!box) return;
  const filters = currentFilters();
  const qs = new URLSearchParams({ limit: 50, offset });
  for (const [k, v] of Object.entries(filters)) qs.set(k, v);
  let data;
  try { data = await api(`/entries?${qs}`); }
  catch { box.innerHTML = '<p class="muted">The collection is not available right now.</p>'; return; }
  if (!data.entries.length) {
    box.innerHTML = Object.keys(filters).length
      ? '<p class="muted">No entries match these filters.</p>'
      : '<p class="muted">Nothing published yet — please check back.</p>';
    return;
  }
  box.innerHTML = `
    <ul class="entry-list">${data.entries.map(entryRow).join('')}</ul>
    ${data.total > data.limit ? `
    <nav class="pager" aria-label="Pages">
      <button id="pg-prev" ${offset === 0 ? 'disabled' : ''}>‹ Previous</button>
      <span>${offset + 1}–${Math.min(offset + data.limit, data.total)} of ${data.total}</span>
      <button id="pg-next" ${offset + data.limit >= data.total ? 'disabled' : ''}>Next ›</button>
    </nav>` : ''}`;
  document.getElementById('pg-prev')?.addEventListener('click', () => loadList(Math.max(0, offset - 50)));
  document.getElementById('pg-next')?.addEventListener('click', () => loadList(offset + 50));
}

async function renderSearch(q) {
  document.title = `${q} — ${siteConfig.site_title}`;
  main.innerHTML = `
    <section class="hero small">
      <h1><a href="/" class="home-link">${esc(siteConfig.site_title)}</a></h1>
      ${searchBox(q)}
    </section>
    <section aria-labelledby="results-head">
      <h2 id="results-head">Results for “${esc(q)}”</h2>
      <div id="results" aria-live="polite"><p class="muted">Searching…</p></div>
    </section>`;
  wireSearch();
  try {
    const data = await api(`/search?q=${encodeURIComponent(q)}`);
    document.getElementById('results').innerHTML = data.results.length
      ? `<ul class="entry-list">${data.results.map(entryRow).join('')}</ul>`
      : `<p class="muted">No results for “${esc(q)}”. Try another word or phrase.</p>`;
  } catch {
    document.getElementById('results').innerHTML = '<p class="muted">Search is not available right now.</p>';
  }
}

async function renderEntry(uid) {
  main.innerHTML = '<p class="muted">Loading…</p>';
  let e;
  try { e = await api(`/entries/${encodeURIComponent(uid)}`); }
  catch {
    document.title = siteConfig.site_title;
    main.innerHTML = `
      <section class="hero small"><h1><a href="/" class="home-link">${esc(siteConfig.site_title)}</a></h1></section>
      <p class="muted">This entry isn’t available.</p><p><a href="/">← Back to the collection</a></p>`;
    return;
  }
  document.title = `${e.dene_text || e.english_text} — ${siteConfig.site_title}`;
  main.innerHTML = `
    <section class="hero small"><h1><a href="/" class="home-link">${esc(siteConfig.site_title)}</a></h1>${searchBox()}</section>
    <article class="entry-detail">
      <p class="badge kind">${e.kind === 'phrase' ? 'Phrase' : 'Word'}${e.category ? ` · ${esc(e.category)}` : ''}</p>
      <h2 class="dene" lang="den">${esc(e.dene_text) || '—'}</h2>
      <p class="english-big">${esc(e.english_text)}</p>
      <section aria-labelledby="rec-head">
        <h3 id="rec-head">Recordings</h3>
        ${e.recordings.length ? `
        <ul class="recording-list">${e.recordings.map((r) => `
          <li class="recording">
            <audio controls preload="none" src="${esc(API)}/recordings/${esc(r.uid)}/audio"></audio>
            <span class="rec-meta">${r.speaker ? esc(r.speaker) + ' · ' : ''}${r.language === 'english' ? 'English' : 'Dene'} · ${fmtDuration(r.duration_seconds)}</span>
          </li>`).join('')}
        </ul>` : '<p class="muted">No recordings.</p>'}
      </section>
      <p><a href="/">← Back to the collection</a></p>
    </article>`;
  wireSearch();
}

async function route() {
  const p = location.pathname;
  let m;
  if (p === '/' || p === '') renderHome();
  else if (p === '/search') renderSearch(new URLSearchParams(location.search).get('q') ?? '');
  else if ((m = p.match(/^\/entry\/([A-Za-z0-9-]+)\/?$/))) renderEntry(m[1]);
  else {
    main.innerHTML = `<section class="hero small"><h1><a href="/" class="home-link">${esc(siteConfig.site_title)}</a></h1></section>
      <p class="muted">Page not found.</p><p><a href="/">← Back to the collection</a></p>`;
  }
  window.scrollTo(0, 0);
}

(async function boot() {
  try { siteConfig = await api('/config'); } catch { /* defaults stand */ }
  document.getElementById('site-title').textContent = siteConfig.site_title;
  document.getElementById('site-footer').innerHTML =
    `<p>${esc(siteConfig.site_footer || `${siteConfig.site_title} — a living collection of Dene language knowledge.`)}</p>`;
  route();
})();
