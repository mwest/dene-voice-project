// 011_public_site: explicit publication model for the public Language site
// (public-site spec §3–§6, §34, §37). Publication is EXPLICIT state — never
// inferred from "has a recording" — and consent stays authoritative: a
// published recording is still publicly ineligible unless its consent
// snapshot permits public presentation (allow_language_learning) and it is
// current and unrevoked.
//
// - entries.publication_status / audio_files.publication_status:
//   'private' (default) | 'public'. Publishing is an admin act (spec §19).
// - speakers.public_display_name + public_attribution_enabled: public
//   attribution is deliberate — internal display names are never exposed
//   automatically (spec §6).
// - public_language_settings: one row per organization that runs a public
//   site (the org/collection mapping is CONFIGURATION, not code). The site's
//   collection is the organization's default Language collection.
// - publication_events: audit trail for publish/unpublish/site changes
//   (spec §34) — metadata only, never content or audio.

export function up(db) {
  db.exec(`
    ALTER TABLE entries ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'private'
      CHECK (publication_status IN ('private', 'public'));
    ALTER TABLE audio_files ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'private'
      CHECK (publication_status IN ('private', 'public'));

    ALTER TABLE speakers ADD COLUMN public_display_name TEXT;
    ALTER TABLE speakers ADD COLUMN public_attribution_enabled INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE public_language_settings (
      organization_id     INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      enabled             INTEGER NOT NULL DEFAULT 0,
      site_title          TEXT,
      site_description    TEXT,
      public_domain       TEXT,
      show_speaker_names  INTEGER NOT NULL DEFAULT 1,
      allow_downloads     INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_public_settings_domain
      ON public_language_settings(public_domain) WHERE public_domain IS NOT NULL;

    CREATE TABLE publication_events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id  INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      subject_type     TEXT NOT NULL CHECK (subject_type IN ('entry', 'recording', 'site')),
      subject_id       INTEGER,
      action           TEXT NOT NULL,
      actor_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_entries_publication ON entries(corpus_id, publication_status);
    CREATE INDEX idx_audio_publication ON audio_files(entry_id, is_current, publication_status);
  `);
}
