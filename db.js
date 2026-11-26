
const Database = require("better-sqlite3");

const db = new Database(process.env.DB_PATH || "society.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    flat TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    first_response_at TEXT,
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'resident'
      CHECK (role IN ('resident', 'committee', 'secretary', 'president')),
    flat TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_complaints_status
  ON complaints(status);

  CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

  CREATE INDEX IF NOT EXISTS idx_users_role
  ON users(role);
`);

// Safe migration: preserve existing complaint records.
const complaintColumns = db.prepare(
  "PRAGMA table_info(complaints)"
).all();

if (!complaintColumns.some(column => column.name === "user_id")) {
  db.exec(`
    ALTER TABLE complaints
    ADD COLUMN user_id INTEGER REFERENCES users(id)
  `);
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_complaints_user_id
  ON complaints(user_id)
`);

module.exports = db;
