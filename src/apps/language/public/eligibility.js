// THE canonical definition of public eligibility (public-site spec §3/§38).
// Every public route, count, search candidate set, and sitemap builds on the
// fragments here — no endpoint may define "public" on its own.
//
// A RECORDING is publicly eligible when ALL hold:
//   current version            (is_current = 1)
//   explicitly published       (publication_status = 'public')
//   not revoked                (revoked_at IS NULL)
//   consent permits public presentation — the consent snapshot's
//   allow_language_learning purpose; consent-unknown is NEVER inferred
//   (matches the purpose-filtered export rule)
//
// An ENTRY is publicly eligible when ALL hold:
//   belongs to the site's collection (corpus)
//   explicitly published       (publication_status = 'public')
//   has at least one publicly eligible recording
import db from '../../../db.js';

/** WHERE fragment for a publicly eligible recording, table aliased `a`. */
export const PUBLIC_RECORDING = `
  a.is_current = 1
  AND a.publication_status = 'public'
  AND a.revoked_at IS NULL
  AND a.allow_language_learning = 1`;

/** WHERE fragment for a publicly eligible entry, table aliased `e`.
 *  Binds ONE parameter: the site's corpus id. */
export const PUBLIC_ENTRY = `
  e.corpus_id = ?
  AND e.publication_status = 'public'
  AND EXISTS (SELECT 1 FROM audio_files a WHERE a.entry_id = e.id AND ${PUBLIC_RECORDING})`;

/** Publicly eligible recording count for an entry (correlated subquery). */
export const PUBLIC_RECORDING_COUNT = `
  (SELECT COUNT(*) FROM audio_files a WHERE a.entry_id = e.id AND ${PUBLIC_RECORDING})`;

/** The public speaker label for a recording row (aliased `a`, joined
 *  speaker `s`): attribution is deliberate — only an explicitly enabled
 *  public display name is ever exposed (spec §6). NULL means "unnamed". */
export const PUBLIC_SPEAKER = `
  CASE WHEN s.public_attribution_enabled = 1 AND s.public_display_name IS NOT NULL
       AND s.public_display_name <> '' THEN s.public_display_name END`;

/** Resolve a publicly eligible entry by uid within a corpus, or null. */
export function publicEntryByUid(corpusId, uid) {
  return db.prepare(
    `SELECT e.id, e.uid, e.kind, e.dene_text, e.english_text, e.category
     FROM entries e WHERE e.uid = ? AND ${PUBLIC_ENTRY}`
  ).get(uid, corpusId) ?? null;
}

/** Resolve a publicly eligible recording by uid — its parent entry must be
 *  public in the same corpus (spec §11). Returns null otherwise. */
export function publicRecordingByUid(corpusId, uid) {
  return db.prepare(
    `SELECT a.id, a.uid, a.stored_name, a.playback_stored_name, a.duration_seconds, a.language
     FROM audio_files a
     JOIN entries e ON e.id = a.entry_id
     WHERE a.uid = ? AND ${PUBLIC_RECORDING} AND ${PUBLIC_ENTRY}`
  ).get(uid, corpusId) ?? null;
}

/** Admin-only: why is this entry NOT publicly visible (spec §20)?
 *  Returns [] when the entry is publicly eligible. */
export function ineligibilityReasons(entry) {
  const reasons = [];
  if (entry.publication_status !== 'public') reasons.push('Entry not published');
  const recs = db.prepare(
    `SELECT a.is_current, a.publication_status, a.revoked_at, a.allow_language_learning
     FROM audio_files a WHERE a.entry_id = ? AND a.is_current = 1`
  ).all(entry.id);
  if (!recs.length) reasons.push('No recording');
  else if (!recs.some((a) => a.publication_status === 'public')) reasons.push('No published recording');
  else if (!recs.some((a) => a.publication_status === 'public' && !a.revoked_at && a.allow_language_learning === 1)) {
    reasons.push(recs.some((a) => a.publication_status === 'public' && a.revoked_at)
      ? 'Published recording is revoked'
      : 'Consent does not permit public presentation');
  }
  return reasons;
}
