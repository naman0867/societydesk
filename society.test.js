process.env.DB_PATH = ":memory:";
const request = require("supertest");
const { app, db } = require("./server");
const { computeDueAt, slaState } = require("./sla");

const H = 3600 * 1000;
const valid = {
  title: "Lift stuck on the 4th floor",
  description: "The lift in Tower B stops between floors and the door will not open.",
  category: "lift",
  flat: "B-204",
};

// Insert a complaint directly, as if it were raised `hoursAgo` hours ago.
function insertOld(category, hoursAgo, status = "open", resolvedAfterHours = null) {
  const created = Date.now() - hoursAgo * H;
  const resolvedAt = resolvedAfterHours === null ? null : new Date(created + resolvedAfterHours * H).toISOString();
  return db.prepare(`INSERT INTO complaints
    (title, description, category, flat, status, created_at, due_at, first_response_at, resolved_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "Old complaint title", "An old complaint used in a test.", category, "A-1", status,
    new Date(created).toISOString(), computeDueAt(category, created), resolvedAt, resolvedAt
  ).lastInsertRowid;
}

describe("SLA rules", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const make = (category, hoursAgo, extra = {}) => {
    const created = now - hoursAgo * H;
    return { category, status: "open", created_at: new Date(created).toISOString(),
      due_at: computeDueAt(category, created), ...extra };
  };

  test("each category gets its own deadline", () => {
    const created = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(computeDueAt("lift", created)).toBe(new Date(created + 4 * H).toISOString());
    expect(computeDueAt("parking", created)).toBe(new Date(created + 48 * H).toISOString());
  });

  test("a complaint inside its deadline is on track", () => {
    const s = slaState(make("lift", 1), now);
    expect(s.overdue).toBe(false);
    expect(s.hoursRemaining).toBe(3);
    expect(s.escalationLevel).toBe(0);
  });

  test("a complaint just past its deadline escalates to the committee", () => {
    const s = slaState(make("lift", 5), now); // due after 4h, so 1h overdue
    expect(s.overdue).toBe(true);
    expect(s.escalationLevel).toBe(1);
    expect(s.escalatesTo).toBe("Committee");
  });

  test("more than a day overdue escalates to the secretary", () => {
    const s = slaState(make("lift", 4 + 30), now);
    expect(s.escalationLevel).toBe(2);
    expect(s.escalatesTo).toBe("Secretary");
  });

  test("more than three days overdue escalates to the president", () => {
    const s = slaState(make("lift", 4 + 80), now);
    expect(s.escalationLevel).toBe(3);
    expect(s.escalatesTo).toBe("President");
  });

  test("resolved complaints report on time or late, and never escalate", () => {
    const onTime = slaState(make("water", 20, { status: "resolved", resolved_at: new Date(now - 18 * H).toISOString() }), now);
    const late = slaState(make("water", 20, { status: "resolved", resolved_at: new Date(now - 2 * H).toISOString() }), now);
    expect(onTime.resolvedLate).toBe(false);
    expect(late.resolvedLate).toBe(true);
    expect(onTime.escalationLevel).toBe(0);
    expect(late.escalationLevel).toBe(0);
  });
});

describe("complaints API", () => {
  test("creates a complaint with a deadline from its category", async () => {
    const res = await request(app).post("/api/complaints").send(valid);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("open");
    expect(res.body.categoryLabel).toBe("Lift");
    expect(Date.parse(res.body.dueAt) - Date.parse(res.body.createdAt)).toBe(4 * H);
    expect(res.body.sla.overdue).toBe(false);
  });

  test.each([
    ["a short title", { title: "Lift" }],
    ["a short description", { description: "Broken" }],
    ["an unknown category", { category: "pets" }],
    ["a bad flat number", { flat: "!!!" }],
  ])("rejects %s", async (_name, patch) => {
    const res = await request(app).post("/api/complaints").send({ ...valid, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test("rejects a missing body", async () => {
    expect((await request(app).post("/api/complaints")).status).toBe(400);
  });

  test("lists the most overdue unresolved complaints first and resolved ones last", async () => {
    db.exec("DELETE FROM complaints");
    const resolved = insertOld("water", 30, "resolved", 5);
    const lightlyOverdue = insertOld("lift", 6);
    const veryOverdue = insertOld("security", 100);
    const onTrack = insertOld("parking", 1);

    const res = await request(app).get("/api/complaints");
    expect(res.body.map(c => c.id)).toEqual([veryOverdue, lightlyOverdue, onTrack, resolved]);
  });

  test("filters by overdue and by status", async () => {
    const overdue = await request(app).get("/api/complaints?overdue=true");
    expect(overdue.body.length).toBe(2);
    expect(overdue.body.every(c => c.sla.overdue)).toBe(true);

    const resolved = await request(app).get("/api/complaints?status=resolved");
    expect(resolved.body.length).toBe(1);
  });

  test("rejects an invalid filter", async () => {
    expect((await request(app).get("/api/complaints?status=banana")).status).toBe(400);
  });

  test("returns 404 for an unknown complaint", async () => {
    expect((await request(app).get("/api/complaints/9999")).status).toBe(404);
  });
});

describe("status changes", () => {
  let id;
  beforeAll(async () => {
    id = (await request(app).post("/api/complaints").send(valid)).body.id;
  });
  const patch = status => request(app).patch(`/api/complaints/${id}/status`).send({ status });

  test("the first move records the first response time", async () => {
    const res = await patch("in_progress");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("in_progress");
    expect(res.body.firstResponseAt).toBeTruthy();
  });

  test("a complaint cannot go back to open from in_progress", async () => {
    expect((await patch("open")).status).toBe(409);
  });

  test("resolving records the resolved time", async () => {
    const res = await patch("resolved");
    expect(res.status).toBe(200);
    expect(res.body.resolvedAt).toBeTruthy();
  });

  test("reopening clears the resolved time but keeps the first response", async () => {
    const res = await patch("open");
    expect(res.status).toBe(200);
    expect(res.body.resolvedAt).toBeNull();
    expect(res.body.firstResponseAt).toBeTruthy();
  });

  test("rejects an unknown status and an unknown id", async () => {
    expect((await patch("done")).status).toBe(400);
    const res = await request(app).patch("/api/complaints/9999/status").send({ status: "resolved" });
    expect(res.status).toBe(404);
  });
});

describe("summary", () => {
  test("counts complaints by status and overdue", async () => {
    db.exec("DELETE FROM complaints");
    insertOld("lift", 10);                 // overdue
    insertOld("parking", 1);               // on track
    insertOld("water", 30, "resolved", 5); // resolved, 5h to fix
    const res = await request(app).get("/api/summary");
    expect(res.body).toMatchObject({ total: 3, open: 2, inProgress: 0, resolved: 1, overdue: 1 });
    expect(res.body.avgResolutionHours).toBe(5);
  });
});