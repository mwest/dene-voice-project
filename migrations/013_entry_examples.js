// 013_entry_examples: many-to-many WORD ↔ EXAMPLE PHRASE. An example sentence
// is a real phrase entry (recordable, translatable, publishable, consented),
// never a bare text column — this table only records the relationship. The
// UI presents it flat (one primary example per word: lowest position, oldest
// first), but one phrase may exemplify many words and vice versa. Links
// cascade with either endpoint; the other endpoint always survives.
export function up(db) {
  db.exec(`
    CREATE TABLE entry_examples (
      word_entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      phrase_entry_id  INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      position         INTEGER NOT NULL DEFAULT 0,
      created_by       INTEGER REFERENCES users(id),
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (word_entry_id, phrase_entry_id)
    );
    CREATE INDEX idx_entry_examples_phrase ON entry_examples(phrase_entry_id);
  `);
}
