// Serves the public Language site on its configured domain(s) (public-site
// spec phases D/E): when the request Host matches an enabled site's
// public_domain (or its www), this middleware answers with the public-site
// shell, assets, robots.txt and sitemap.xml — with real per-page titles,
// descriptions, canonical URLs and Open Graph tags for SEO (spec §29). The
// same public-site/ directory also deploys standalone (serve.js); this
// same-host path just means one Fly app can carry both origins.
//
// Only ever GET/HEAD, only non-/api paths, and only public-eligible content
// reaches the sitemap or meta — unpublished material 404s exactly like the
// public API.
import fs from 'node:fs';
import path from 'node:path';
import db from '../../../db.js';
import { defaultCorpusFor } from '../corpus.js';
import { PUBLIC_ENTRY, publicEntryByUid } from './eligibility.js';

const SITE_DIR = path.join(import.meta.dirname, '../../../../public-site');
const template = () => fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');

const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function siteForHost(hostname) {
  if (!hostname) return null;
  const apex = hostname.replace(/^www\./, '');
  return db.prepare(
    `SELECT * FROM public_language_settings WHERE enabled = 1 AND public_domain IN (?, ?)`
  ).get(hostname, apex) ?? null;
}

function shell(res, status, { title, description, canonical }) {
  const html = template()
    .replaceAll('{{TITLE}}', escAttr(title))
    .replaceAll('{{DESCRIPTION}}', escAttr(description ?? ''))
    .replaceAll('{{CANONICAL}}', escAttr(canonical));
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' }).send(html);
}

export function publicSiteHandler(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/')) return next();
  const site = siteForHost(req.hostname);
  if (!site) return next();

  const origin = `https://${site.public_domain}`;
  const title = site.site_title || 'Language Collection';

  // Static assets (the shell itself is rendered below, never served raw).
  if (req.path === '/app.js' || req.path === '/style.css') {
    return res.sendFile(path.join(SITE_DIR, req.path.slice(1)), {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  }
  if (req.path === '/robots.txt') {
    return res.type('text/plain').set('Cache-Control', 'public, max-age=3600')
      .send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  }
  if (req.path === '/sitemap.xml') {
    // Public-eligible entries only (spec §29) — never unpublished content.
    const corpusId = defaultCorpusFor(db, site.organization_id).id;
    const uids = db.prepare(
      `SELECT e.uid FROM entries e WHERE ${PUBLIC_ENTRY} ORDER BY e.id LIMIT 50000`
    ).all(corpusId).map((r) => r.uid);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `<url><loc>${origin}/</loc></url>\n` +
      uids.map((u) => `<url><loc>${origin}/entry/${escAttr(u)}</loc></url>`).join('\n') +
      `\n</urlset>\n`;
    return res.type('application/xml').set('Cache-Control', 'public, max-age=300').send(xml);
  }

  if (req.path === '/' ) {
    return shell(res, 200, { title, description: site.site_description, canonical: `${origin}/` });
  }
  if (req.path === '/search') {
    return shell(res, 200, { title: `Search — ${title}`, description: site.site_description, canonical: `${origin}/search` });
  }
  const m = req.path.match(/^\/entry\/([A-Za-z0-9-]+)\/?$/);
  if (m) {
    const corpusId = defaultCorpusFor(db, site.organization_id).id;
    const entry = publicEntryByUid(corpusId, m[1]);
    if (!entry) return shell(res, 404, { title, description: site.site_description, canonical: `${origin}/` });
    return shell(res, 200, {
      title: `${entry.dene_text || entry.english_text} — ${title}`,
      description: entry.dene_text && entry.english_text
        ? `“${entry.dene_text}” — ${entry.english_text}${entry.category ? ` (${entry.category})` : ''}`
        : site.site_description,
      canonical: `${origin}/entry/${entry.uid}`,
    });
  }
  return shell(res, 404, { title, description: site.site_description, canonical: `${origin}/` });
}
