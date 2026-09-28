// One-time repair: example-sentence phrases created by the CSV/spreadsheet
// imports before they inherited their word's category were saved with none.
// Gives every uncategorized example phrase the category of the word it is the
// example for (the primary link — lowest position, oldest first — when a phrase
// exemplifies several words). Phrases that already have a category are never
// touched, so re-running is a no-op.
//
//   node scripts/backfill-example-categories.js          # dry run: report what would change
//   node scripts/backfill-example-categories.js --apply  # write the categories
import db from '../src/db.js';

const APPLY = process.argv.includes('--apply');

const rows = db.prepare(
  `SELECT p.id, p.dene_text, p.english_text,
     (SELECT w.category FROM entry_examples x JOIN entries w ON w.id = x.word_entry_id
      WHERE x.phrase_entry_id = p.id AND w.category IS NOT NULL AND w.category <> ''
      ORDER BY x.position, x.created_at, w.id LIMIT 1) AS word_category
   FROM entries p
   WHERE p.kind = 'phrase' AND (p.category IS NULL OR p.category = '')
     AND EXISTS (SELECT 1 FROM entry_examples x WHERE x.phrase_entry_id = p.id)`
).all().filter((r) => r.word_category);

const update = db.prepare(`UPDATE entries SET category = ?, updated_at = datetime('now') WHERE id = ?`);
db.transaction(() => {
  for (const r of rows) {
    console.log(`${APPLY ? 'set' : 'would set'} #${r.id} ${JSON.stringify(r.dene_text || r.english_text)} -> ${JSON.stringify(r.word_category)}`);
    if (APPLY) update.run(r.word_category, r.id);
  }
})();
console.log(`${rows.length} example phrase${rows.length === 1 ? '' : 's'} ${APPLY ? 'updated' : 'would be updated (dry run; pass --apply to write)'}`);
