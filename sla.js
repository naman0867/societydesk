// SLA rules: every complaint category has a deadline, and the longer a complaint
// stays overdue, the higher it escalates. Pure functions, so they are easy to test.

const HOUR = 3600 * 1000;

const CATEGORIES = {
  security: { label: "Security", slaHours: 2 },
  lift: { label: "Lift", slaHours: 4 },
  water: { label: "Water supply", slaHours: 6 },
  electricity: { label: "Electricity", slaHours: 6 },
  plumbing: { label: "Plumbing", slaHours: 24 },
  cleaning: { label: "Cleaning", slaHours: 24 },
  noise: { label: "Noise", slaHours: 24 },
  parking: { label: "Parking", slaHours: 48 },
  other: { label: "Other", slaHours: 72 },
};

// Overdue by up to 24h -> committee, up to 72h -> secretary, beyond that -> president.
const ESCALATION = [
  { level: 1, upToHours: 24, to: "Committee" },
  { level: 2, upToHours: 72, to: "Secretary" },
  { level: 3, upToHours: Infinity, to: "President" },
];

const round1 = n => Math.round(n * 10) / 10;

function computeDueAt(category, createdMs) {
  return new Date(createdMs + CATEGORIES[category].slaHours * HOUR).toISOString();
}

function slaState(c, nowMs = Date.now()) {
  const due = Date.parse(c.due_at);

  if (c.status === "resolved") {
    const late = Date.parse(c.resolved_at) > due;
    return { overdue: false, escalationLevel: 0, escalatesTo: null, resolvedLate: late,
      summary: late ? "Resolved after the deadline" : "Resolved on time" };
  }

  const diffHours = (nowMs - due) / HOUR;
  if (diffHours <= 0) {
    return { overdue: false, escalationLevel: 0, escalatesTo: null,
      hoursRemaining: round1(-diffHours), summary: `Due in ${round1(-diffHours)} h` };
  }

  const step = ESCALATION.find(e => diffHours <= e.upToHours);
  return { overdue: true, escalationLevel: step.level, escalatesTo: step.to,
    hoursOverdue: round1(diffHours), summary: `Overdue by ${round1(diffHours)} h, escalated to ${step.to}` };
}

module.exports = { CATEGORIES, computeDueAt, slaState };