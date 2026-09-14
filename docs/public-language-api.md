# Public Language API (v1)

The read-only, unauthenticated API behind the public Language site. Base
path: `/api/public/language`. The public frontend depends ONLY on this
contract — never on the authenticated `/api/language/...` routes, cookies,
or the database.

**Site resolution.** Every request is scoped to one public site — an
organization's default Language collection, configured in
`public_language_settings` (enabled, `public_domain`, titles, attribution
policy). The site is resolved from the request hostname (exact match), else
the CORS `Origin` host, else — only when exactly one site is enabled — that
site. Query parameters can never select a site. No site ⇒ everything 404s.

**Publication.** Content appears only when explicitly published AND
consent-eligible: an entry must be published and hold ≥1 current, published,
unrevoked recording whose consent snapshot permits public presentation
(`allow_language_learning`). Ineligible or unknown = plain **404**, never
403 — existence is never revealed. Unpublish/revocation takes effect on the
next request (JSON `Cache-Control: max-age=15`, audio `max-age=60`).

**CORS.** Only configured origins (each enabled site's `https://domain` and
`www` variant, plus `PUBLIC_DEV_ORIGINS` for development). GET only,
credentials never. Rate limits are per-IP and community-shared-IP friendly.

## `GET /config`
```json
{ "site_title": "…", "site_description": "…",
  "show_speaker_names": true, "allow_downloads": false }
```

## `GET /entries?q&kind&category&letter&limit&offset`
Lexical browse over public entries, ordered by Dene text. `limit` ≤ 200.
```json
{ "entries": [ { "uid": "…", "kind": "word", "dene_text": "łue",
    "english_text": "fish", "category": "animals", "recording_count": 2 } ],
  "total": 1, "limit": 50, "offset": 0 }
```
`total` counts public entries only.

## `GET /entries/:uid`
```json
{ "uid": "…", "kind": "word", "dene_text": "łue", "english_text": "fish",
  "category": "animals",
  "recordings": [ { "uid": "…", "speaker": "Jane M.", "language": "dene",
      "duration_seconds": 3.8,
      "audio_url": "/api/public/language/recordings/<uid>/audio" } ] }
```
`speaker` is null unless that speaker has explicit public attribution AND
the site shows speaker names. Only publicly eligible recordings appear.

## `GET /search?q&limit`
Hybrid keyword + semantic ranking (same local model as the app). The
candidate set is public entries only — both retrieval paths — so private
content can never influence results or neighbours. `limit` ≤ 50.
```json
{ "query": "fish", "results": [ /* entry rows as in /entries */ ] }
```

## `GET /recordings/:uid/audio`
Streams the approved playback derivative (master only as a stream when no
derivative exists), with normal browser Range support (`206`). Filename is
the recording uid — storage paths and original filenames are never exposed.

## Errors
`404 {"error":"Not found"}` for anything ineligible, unknown, non-GET, or
outside this contract; `429` when rate-limited.
