// 014_user_last_login: when each person last signed in. Stamped by
// createSession on every successful password sign-in. Before this, the only
// trace of a login was a row in `sessions`, which disappears on sign-out,
// password change, or after 30 days — so history before this migration is
// unrecoverable. Seed from the newest surviving session so anyone signed in
// during the last 30 days (and not since signed out) starts with a real date;
// everyone else stays NULL ("never" / unknown) until their next sign-in.
export function up(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN last_login_at TEXT;
    UPDATE users SET last_login_at =
      (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = users.id);
  `);
}
