const Database = require("better-sqlite3");

const db = new Database(process.env.DB_PATH || "society.db");

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
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
`);

module.exports = db;