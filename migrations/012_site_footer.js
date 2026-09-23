// 012_site_footer: admin-controlled footer text for the public Language site.
// NULL/blank means the site falls back to its built-in default line.
export function up(db) {
  db.exec(`ALTER TABLE public_language_settings ADD COLUMN site_footer TEXT;`);
}
