// Fills the database with realistic demo complaints. Run again any time to reset them.
const db = require("./db");
const { computeDueAt } = require("./sla");

const H = 3600 * 1000;
const now = Date.now();

// title, description, category, flat, status, hours ago it was raised,
// hours until first response (or null), hours until it was resolved (or null)
const demo = [
  ["Lift stuck between floors", "The lift in Tower B keeps stopping between the 4th and 5th floor.", "lift", "B-204", "open", 9, null, null],
  ["No water supply since morning", "There has been no water in the taps of Tower A since 6 am.", "water", "A-101", "in_progress", 40, 3, null],
  ["Streetlight near the main gate is out", "The light by the gate is off, and the entrance is very dark at night.", "electricity", "Gate", "open", 20, null, null],
  ["Security guard missing at night", "No guard has been at the Tower C entrance after 11 pm for three days.", "security", "C-302", "open", 100, null, null],
  ["Leaking pipe in the bathroom", "Water is dripping through the ceiling from the flat above.", "plumbing", "B-110", "open", 5, null, null],
  ["Garbage not collected", "The garbage bins on the 4th floor were not emptied today.", "cleaning", "D-405", "in_progress", 10, 2, null],
  ["Visitor parking is blocked", "A car has been parked across the visitor slots since yesterday.", "parking", "A-210", "open", 1, null, null],
  ["Loud construction noise", "Drilling next door starts before 7 am every day.", "noise", "C-101", "resolved", 70, 5, 20],
  ["Water tank overflowing", "The overhead tank overflows every evening and floods the lane.", "water", "B-303", "resolved", 60, 4, 30],
];

db.exec("DELETE FROM complaints");
const insert = db.prepare(`INSERT INTO complaints
  (title, description, category, flat, status, created_at, due_at, first_response_at, resolved_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);

for (const [title, description, category, flat, status, hoursAgo, respondAfter, resolveAfter] of demo) {
  const created = now - hoursAgo * H;
  insert.run(
    title, description, category, flat, status,
    new Date(created).toISOString(),
    computeDueAt(category, created),
    respondAfter === null ? null : new Date(created + respondAfter * H).toISOString(),
    resolveAfter === null ? null : new Date(created + resolveAfter * H).toISOString()
  );
}
console.log(`Seeded ${demo.length} demo complaints.`);