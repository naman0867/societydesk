const express = require("express");
const cors = require("cors");
const db = require("./db");
const { CATEGORIES, computeDueAt, slaState } = require("./sla");

const app = express();
app.set("json spaces", 2);
app.use(cors(), express.json({ limit: "20kb" }));

const STATUSES = ["open", "in_progress", "resolved"];
// The status state machine: which moves are allowed from each state.
const TRANSITIONS = {
  open: ["in_progress", "resolved"],
  in_progress: ["resolved"],
  resolved: ["open"], // reopen
};

const present = (row, now = Date.now()) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  category: row.category,
  categoryLabel: CATEGORIES[row.category].label,
  flat: row.flat,
  status: row.status,
  createdAt: row.created_at,
  dueAt: row.due_at,
  firstResponseAt: row.first_response_at,
  resolvedAt: row.resolved_at,
  sla: slaState(row, now),
});

function validateComplaint(body) {
  const b = body || {};
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  const flat = typeof b.flat === "string" ? b.flat.trim() : "";
  const category = typeof b.category === "string" ? b.category : "";

  if (title.length < 5 || title.length > 100) return { error: "Title must be 5 to 100 characters." };
  if (description.length < 10 || description.length > 1000) return { error: "Description must be 10 to 1000 characters." };
  if (!Object.hasOwn(CATEGORIES, category)) return { error: "Choose a valid category." };
  if (!/^[A-Za-z0-9][A-Za-z0-9\- ]{0,9}$/.test(flat)) return { error: "Flat must be 1 to 10 letters, numbers, spaces or dashes." };
  return { value: { title, description, category, flat } };
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/categories", (req, res) =>
  res.json(Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, slaHours: c.slaHours }))));

app.post("/api/complaints", (req, res) => {
  const { error, value } = validateComplaint(req.body);
  if (error) return res.status(400).json({ error });

  const now = Date.now();
  const info = db.prepare(
    "INSERT INTO complaints (title, description, category, flat, created_at, due_at) VALUES (?,?,?,?,?,?)"
  ).run(value.title, value.description, value.category, value.flat,
    new Date(now).toISOString(), computeDueAt(value.category, now));

  const row = db.prepare("SELECT * FROM complaints WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(present(row, now));
});

app.get("/api/complaints", (req, res) => {
  const { status, category, overdue } = req.query;
  if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status filter." });
  if (category !== undefined && !Object.hasOwn(CATEGORIES, category)) return res.status(400).json({ error: "Invalid category filter." });

  const now = Date.now();
  let list = db.prepare("SELECT * FROM complaints").all().map(r => present(r, now));
  if (status) list = list.filter(c => c.status === status);
  if (category) list = list.filter(c => c.category === category);
  if (overdue === "true") list = list.filter(c => c.sla.overdue);

  // Unresolved first (earliest deadline first, so the most overdue are on top), then resolved (newest first)
  list.sort((a, b) => {
    const ar = a.status === "resolved", br = b.status === "resolved";
    if (ar !== br) return ar ? 1 : -1;
    if (!ar) return Date.parse(a.dueAt) - Date.parse(b.dueAt);
    return Date.parse(b.resolvedAt) - Date.parse(a.resolvedAt);
  });
  res.json(list);
});

app.get("/api/complaints/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM complaints WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Complaint not found." });
  res.json(present(row));
});

app.patch("/api/complaints/:id/status", (req, res) => {
  const next = (req.body || {}).status;
  if (!STATUSES.includes(next)) return res.status(400).json({ error: "Status must be open, in_progress or resolved." });

  const row = db.prepare("SELECT * FROM complaints WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Complaint not found." });
  if (!TRANSITIONS[row.status].includes(next))
    return res.status(409).json({ error: `Cannot move a complaint from ${row.status} to ${next}.` });

  const now = new Date().toISOString();
  // "AND status = ?" makes this safe if two people update at the same moment.
  const info = db.prepare(
    `UPDATE complaints
     SET status = ?, first_response_at = COALESCE(first_response_at, ?), resolved_at = ?
     WHERE id = ? AND status = ?`
  ).run(next, next === "open" ? null : now, next === "resolved" ? now : null, row.id, row.status);
  if (info.changes === 0) return res.status(409).json({ error: "This complaint was just updated. Refresh and try again." });

  res.json(present(db.prepare("SELECT * FROM complaints WHERE id = ?").get(row.id)));
});

app.get("/api/summary", (req, res) => {
  const now = Date.now();
  const all = db.prepare("SELECT * FROM complaints").all().map(r => present(r, now));
  const resolved = all.filter(c => c.status === "resolved");
  const hours = resolved.map(c => (Date.parse(c.resolvedAt) - Date.parse(c.createdAt)) / 3600000);
  res.json({
    total: all.length,
    open: all.filter(c => c.status === "open").length,
    inProgress: all.filter(c => c.status === "in_progress").length,
    resolved: resolved.length,
    overdue: all.filter(c => c.sla.overdue).length,
    avgResolutionHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
  });
});

if (require.main === module) {
  const PORT = process.env.PORT || 4002;
  app.listen(PORT, () => console.log(`API on :${PORT}`));
}
module.exports = { app, db };