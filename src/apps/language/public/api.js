// Read-only public Language API (public-site spec §8–§18): the ONLY surface
// the separate-domain public site talks to. Unauthenticated by design — no
// cookies read, no sessions, credentials never allowed over CORS. Everything
// is scoped to ONE resolved public site (an organization's default Language
// collection, mapped by configuration in public_language_settings — never a
// hard-coded org id, never a query parameter). Ineligible or unknown
// content is always a plain 404: existence is never revealed.
import express from 'express';
import path from 'node:path';
import db, { AUDIO_DIR } from '../../../db.js';
import { embed, cosine, fromBlob, MODEL } from '../../../embed.js';
import { rateLimited } from '../../../api.js';
import { defaultCorpusFor } from '../corpus.js';
import {
  PUBLIC_ENTRY, PUBLIC_RECORDING_COUNT, PUBLIC_SPEAKER,
  publicEntryByUid, publicRecordingByUid,
} from './eligibility.js';

export const publicLanguage = express.Router();

const notFound = (res) => res.status(404).json({ error: 'Not found' });

const enabledSites = () =>
  db.prepare('SELECT * FROM public_language_settings WHERE enabled = 1').all();

const originHost = (origin) => { try { return new URL(origin).hostname; } catch { return null; } };

/** Origins allowed to call this API cross-origin: each enabled site's
 *  https origin (+ www), plus explicit dev origins (spec §13/§40). */
function allowedOrigins() {
  const set = new Set();
  for (const s of enabledSites()) {
    if (s.public_domain) {
      set.add(`https://${s.public_domain}`);
      set.add(`https://www.${s.public_domain}`);
    }
  }
  for (const o of (process.env.PUBLIC_DEV_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    set.add(o);
  }
  return set;
}

// Strict CORS for the public namespace only: configured origins, GET only,
// credentials never (spec §13). Unknown origins get no CORS grant at all.
publicLanguage.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return notFound(res);
  next();
});

// Resolve WHICH public site this request is for (spec §12): exact hostname
// match first (the site served on its own domain), then the caller's Origin
// (the site calling the API cross-origin), then — only when exactly one site
// is enabled — that site. Query parameters can never select a site.
publicLanguage.use((req, res, next) => {
  const sites = enabledSites();
  if (!sites.length) return notFound(res);
  const byDomain = new Map(sites.filter((s) => s.public_domain).map((s) => [s.public_domain, s]));
  const site =
    byDomain.get(req.hostname) ??
    byDomain.get(req.hostname?.replace(/^www\./, '')) ??
    byDomain.get(originHost(req.headers.origin ?? '')) ??
    (sites.length === 1 ? sites[0] : null);
  if (!site) return notFound(res);
  req.site = site;
  req.corpusId = defaultCorpusFor(db, site.organization_id).id;
  next();
});

// Rate limits (spec §31): per-IP, generous enough for shared community IPs.
const limit = (name, max, windowMs) => (req, res, next) => {
  if (rateLimited(`public-${name}:${req.ip}`, max, windowMs)) {
    return res.status(429).json({ error: 'Too many requests — please slow down' });
  }
  next();
};

// Access log: route + status + latency + site, never search terms (spec §35).
publicLanguage.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`[public] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms org=${req.site?.organization_id ?? '-'}`);
  });
  next();
});

const JSON_CACHE = 'public, max-age=15';   // short TTL: revocation wins (spec §21/§22)
const AUDIO_CACHE = 'public, max-age=60';

publicLanguage.get('/config', limit('config', 600, 5 * 60 * 1000), (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    site_title: req.site.site_title ?? 'Language Collection',
    site_description: req.site.site_description ?? '',
    site_footer: req.site.site_footer ?? '',
    show_speaker_names: !!req.site.show_speaker_names,
    allow_downloads: !!req.site.allow_downloads,
  });
});

const publicEntrySelect = `
  SELECT e.uid, e.kind, e.dene_text, e.english_text, e.category,
         ${PUBLIC_RECORDING_COUNT} AS recording_count
  FROM entries e`;

publicLanguage.get('/entries', limit('entries', 600, 5 * 60 * 1000), (req, res) => {
  const where = [PUBLIC_ENTRY];
  const params = [req.corpusId];
  const q = String(req.query.q ?? '').trim();
  if (q) {
    const like = `%${q}%`;
    where.push('(e.dene_text LIKE ? OR e.english_text LIKE ? OR e.category LIKE ?)');
    params.push(like, like, like);
  }
  if (req.query.kind === 'word' || req.query.kind === 'phrase') {
    where.push('e.kind = ?');
    params.push(req.query.kind);
  }
  if (req.query.category) {
    where.push('e.category = ?');
    params.push(String(req.query.category));
  }
  const letter = String(req.query.letter ?? '').trim();
  if (letter) {
    where.push('e.dene_text LIKE ?');
    params.push(`${letter.slice(0, 4)}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const limitN = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  // total counts PUBLIC entries only — private totals are never derivable.
  const total = db.prepare(`SELECT COUNT(*) n FROM entries e ${whereSql}`).get(...params).n;
  const entries = db.prepare(
    `${publicEntrySelect} ${whereSql} ORDER BY e.dene_text COLLATE NOCASE, e.id LIMIT ? OFFSET ?`
  ).all(...params, limitN, offset);
  res.set('Cache-Control', JSON_CACHE);
  res.json({ entries, total, limit: limitN, offset });
});

publicLanguage.get('/entries/:uid', limit('entries', 600, 5 * 60 * 1000), (req, res) => {
  const entry = publicEntryByUid(req.corpusId, String(req.params.uid));
  if (!entry) return notFound(res); // 404, never 403 (spec §10)
  const showSpeakers = !!req.site.show_speaker_names;
  const recordings = db.prepare(
    `SELECT a.uid, a.language, a.duration_seconds, ${PUBLIC_SPEAKER} AS speaker
     FROM audio_files a
     LEFT JOIN speakers s ON s.id = a.speaker_id
     WHERE a.entry_id = ? AND a.is_current = 1 AND a.publication_status = 'public'
       AND a.revoked_at IS NULL AND a.allow_language_learning = 1
     ORDER BY a.created_at`
  ).all(entry.id).map((a) => ({
    uid: a.uid,
    speaker: showSpeakers ? (a.speaker ?? null) : null,
    language: a.language,
    duration_seconds: a.duration_seconds,
    audio_url: `/api/public/language/recordings/${a.uid}/audio`,
  }));
  res.set('Cache-Control', JSON_CACHE);
  res.json({
    uid: entry.uid,
    kind: entry.kind,
    dene_text: entry.dene_text,
    english_text: entry.english_text,
    category: entry.category,
    recordings,
  });
});

// Hybrid public search (spec §16/§17): the CANDIDATE SET is public-eligible
// entries only — both lexical and semantic retrieval start from it, so
// private content can never influence results, counts, or neighbours.
const RRF_K = 60;
const MIN_SEMANTIC = Number(process.env.SEMANTIC_SEARCH_MIN_SCORE) || 0.25;

publicLanguage.get('/search', limit('search', 240, 5 * 60 * 1000), async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json({ query: '', results: [] });
  const limitN = Math.min(Number(req.query.limit) || 20, 50);
  const like = `%${q}%`;

  const keyword = db.prepare(
    `SELECT e.uid,
            CASE WHEN lower(e.dene_text) = lower(?) OR lower(e.english_text) = lower(?) THEN 0
                 WHEN e.dene_text LIKE ? OR e.english_text LIKE ? THEN 1
                 ELSE 2 END AS tier
     FROM entries e
     WHERE ${PUBLIC_ENTRY}
       AND (e.dene_text LIKE ? OR e.english_text LIKE ? OR e.category LIKE ?)
     ORDER BY tier, e.dene_text COLLATE NOCASE LIMIT 50`
  ).all(q, q, `${q}%`, `${q}%`, req.corpusId, like, like, like)
    .map((r) => ({ uid: r.uid, boost: r.tier === 0 ? 0.05 : r.tier === 1 ? 0.015 : 0 }));

  let semantic = [];
  if (process.env.SEMANTIC_SEARCH_DISABLED !== '1') {
    try {
      const qvec = await embed(q);
      semantic = db.prepare(
        `SELECT e.uid, e.embedding FROM entries e
         WHERE ${PUBLIC_ENTRY} AND e.embedding IS NOT NULL AND e.embedding_model = ?`
      ).all(req.corpusId, MODEL)
        .map((r) => ({ uid: r.uid, score: cosine(qvec, fromBlob(r.embedding)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);
    } catch (e) {
      console.error('[public] embed failed — keyword-only:', e.message);
    }
  }

  const scores = new Map();
  keyword.forEach((k, i) => scores.set(k.uid, (scores.get(k.uid) ?? 0) + 1 / (RRF_K + i + 1) + k.boost));
  semantic.forEach((s, i) => {
    if (!scores.has(s.uid) && s.score < MIN_SEMANTIC) return;
    scores.set(s.uid, (scores.get(s.uid) ?? 0) + 1 / (RRF_K + i + 1));
  });
  const uids = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limitN).map(([uid]) => uid);
  let results = [];
  if (uids.length) {
    const rows = db.prepare(
      `${publicEntrySelect} WHERE e.uid IN (${uids.map(() => '?').join(',')}) AND ${PUBLIC_ENTRY}`
    ).all(...uids, req.corpusId);
    const byUid = new Map(rows.map((r) => [r.uid, r]));
    results = uids.map((u) => byUid.get(u)).filter(Boolean);
  }
  res.set('Cache-Control', JSON_CACHE);
  res.json({ query: q, results });
});

// Public audio (spec §11): the approved playback derivative, streamed with
// normal browser range support; the lossless master falls back only when no
// derivative exists (same bytes-as-stream policy as the app player). Storage
// paths and original filenames are never exposed.
publicLanguage.get('/recordings/:uid/audio', limit('audio', 1200, 15 * 60 * 1000), (req, res) => {
  const rec = publicRecordingByUid(req.corpusId, String(req.params.uid));
  if (!rec) return notFound(res);
  const serveName = rec.playback_stored_name || rec.stored_name;
  const ext = path.extname(serveName).toLowerCase();
  const mime = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4' }[ext]
    ?? 'application/octet-stream';
  res.sendFile(path.join(AUDIO_DIR, serveName), {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${rec.uid}${ext}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': AUDIO_CACHE,
    },
  }, (err) => { if (err && !res.headersSent) notFound(res); });
});

// Everything else in the namespace is a 404 — no route disclosure.
publicLanguage.use((req, res) => notFound(res));
