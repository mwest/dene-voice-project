// Portal site: a directory of every enabled public Language site, served on
// the host(s) named by PORTAL_HOSTS (e.g. denekede.ca). One server-rendered
// page — no session, no cookies, and only PUBLIC numbers: each card counts
// publicly eligible entries and recordings through the same canonical
// fragments as the sites themselves, so the portal can never leak private
// totals. A site whose domain IS a portal host is skipped (no self-links).
import db from '../../../db.js';
import { defaultCorpusFor } from '../corpus.js';
import { PUBLIC_ENTRY, PUBLIC_RECORDING } from './eligibility.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const portalHosts = () => new Set(
  (process.env.PORTAL_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
);

function portalSites() {
  const hosts = portalHosts();
  return db.prepare(
    `SELECT * FROM public_language_settings
     WHERE enabled = 1 AND public_domain IS NOT NULL
     ORDER BY site_title COLLATE NOCASE`
  ).all()
    .filter((s) => !hosts.has(s.public_domain))
    .map((s) => {
      const corpusId = defaultCorpusFor(db, s.organization_id).id;
      const entries = db.prepare(
        `SELECT COUNT(*) n FROM entries e WHERE ${PUBLIC_ENTRY}`
      ).get(corpusId).n;
      const recordings = db.prepare(
        `SELECT COUNT(*) n FROM audio_files a JOIN entries e ON e.id = a.entry_id
         WHERE ${PUBLIC_ENTRY} AND ${PUBLIC_RECORDING}`
      ).get(corpusId).n;
      return {
        title: s.site_title || 'Language Collection',
        description: s.site_description || '',
        url: `https://${s.public_domain}`,
        entries,
        recordings,
      };
    });
}

const FOOTER_TEXT =
  'These collections are based on dictionaries created by the Sahtu Divisional Education Council.';

function renderPortal(origin) {
  const sites = portalSites();
  const n = (x) => x.toLocaleString('en-CA');
  const cards = sites.map((s) => `
      <a class="card" href="${esc(s.url)}">
        <h2 lang="den">${esc(s.title)}</h2>
        ${s.description ? `<p class="desc">${esc(s.description)}</p>` : ''}
        <p class="counts">
          <span><b>${n(s.entries)}</b> entries</span>
          <span><b>${n(s.recordings)}</b> recordings</span>
        </p>
      </a>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dene Kǝdǝ́</title>
  <meta name="description" content="Public Dene language collections — words, phrases, and recordings.">
  <link rel="canonical" href="${esc(origin)}/">
  <meta property="og:title" content="Dene Kǝdǝ́">
  <meta property="og:description" content="Public Dene language collections — words, phrases, and recordings.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${esc(origin)}/">
  <style>
    :root {
      --bg: #faf8f4; --panel: #ffffff; --ink: #2b2620; --muted: #766e61;
      --line: #e6e0d5; --accent: #8a4b2f; --accent-dark: #6e3a23; --accent-soft: #f3e7df;
      font-size: 17px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--ink); line-height: 1.6;
      font-family: "Segoe UI", system-ui, -apple-system, "Noto Sans", sans-serif;
    }
    a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
    main { max-width: 880px; margin: 0 auto; padding: 1.5rem 1.2rem 3rem; }
    .hero { text-align: center; padding: 2.2rem 0 1.4rem; }
    .hero h1 { margin: 0 0 0.4rem; font-size: 2.2rem; }
    .lede { color: var(--muted); max-width: 52ch; margin: 0 auto; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem; margin-top: 1.6rem; }
    .card {
      display: block; background: var(--panel); border: 1px solid var(--line);
      border-radius: 14px; padding: 1.2rem 1.3rem; text-decoration: none; color: inherit;
    }
    .card:hover { border-color: var(--accent); box-shadow: 0 2px 10px rgba(138, 75, 47, 0.12); }
    .card h2 { margin: 0 0 0.3rem; font-size: 1.2rem; color: var(--accent-dark); overflow-wrap: anywhere; }
    .desc { margin: 0 0 0.6rem; color: var(--muted); font-size: 0.9rem; }
    .counts { margin: 0; display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.9rem; color: var(--muted); }
    .counts b { color: var(--ink); }
    .empty { text-align: center; color: var(--muted); margin-top: 2rem; }
    footer {
      max-width: 880px; margin: 0 auto; padding: 1rem 1.2rem 2rem;
      color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--line); text-align: center;
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>Dene Kǝdǝ́</h1>
      <p class="lede">Public Dene language collections — words, phrases, and recordings from communities of the Sahtú.</p>
    </section>
    ${sites.length
      ? `<div class="cards">${cards}</div>`
      : '<p class="empty">No public collections are available yet — please check back.</p>'}
  </main>
  <footer><p>${esc(FOOTER_TEXT)}</p></footer>
</body>
</html>`;
}

export function portalHandler(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/')) return next();
  const hosts = portalHosts();
  const host = req.hostname?.toLowerCase() ?? '';
  if (!hosts.has(host) && !hosts.has(host.replace(/^www\./, ''))) return next();

  const origin = `https://${host.replace(/^www\./, '')}`;
  if (req.path === '/robots.txt') {
    return res.type('text/plain').set('Cache-Control', 'public, max-age=3600')
      .send('User-agent: *\nAllow: /\n');
  }
  if (req.path !== '/') return res.redirect(302, '/');
  res.status(200)
    .set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' })
    .send(renderPortal(origin));
}
