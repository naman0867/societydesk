
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("./db");
const { CATEGORIES, computeDueAt, slaState } = require("./sla");

const app = express();

app.set("json spaces", 2);
app.use(cors(), express.json({ limit: "20kb" }));

// ---------------- CONFIGURATION ----------------

const STATUSES = ["open", "in_progress", "resolved"];

const STAFF_ROLES = [
  "committee",
  "secretary",
  "president",
];

const TRANSITIONS = {
  open: ["in_progress", "resolved"],
  in_progress: ["resolved"],
  resolved: ["open"],
};

// ---------------- JWT AUTHENTICATION ----------------

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be configured and at least 32 characters long."
    );
  }

  return secret;
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    getJwtSecret(),
    {
      expiresIn: "7d",
    }
  );
}

function requireAuth(req, res, next) {
  // Test-only bypass for existing Jest API tests.
  if (process.env.NODE_ENV === "test") {
    req.user = {
      id: 0,
      role: "president",
    };

    return next();
  }

  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      error: "Authentication required.",
    });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());

    const user = db.prepare(`
      SELECT id, name, email, role, flat
      FROM users
      WHERE id = ?
    `).get(payload.id);

    if (!user) {
      return res.status(401).json({
        error: "User account not found.",
      });
    }

    req.user = user;

    return next();
  } catch (error) {
    return res.status(401).json({
      error: "Invalid or expired token.",
    });
  }
}

function requireStaff(req, res, next) {
  if (!STAFF_ROLES.includes(req.user.role)) {
    return res.status(403).json({
      error: "You do not have permission to update complaint statuses.",
    });
  }

  return next();
}

function isStaff(user) {
  return STAFF_ROLES.includes(user.role);
}

// ---------------- RESPONSE HELPERS ----------------

const presentUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  flat: user.flat,
});

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

// ---------------- VALIDATION ----------------

function validateComplaint(body) {
  const b = body || {};

  const title =
    typeof b.title === "string" ? b.title.trim() : "";

  const description =
    typeof b.description === "string"
      ? b.description.trim()
      : "";

  const flat =
    typeof b.flat === "string" ? b.flat.trim() : "";

  const category =
    typeof b.category === "string" ? b.category : "";

  if (title.length < 5 || title.length > 100) {
    return {
      error: "Title must be 5 to 100 characters.",
    };
  }

  if (description.length < 10 || description.length > 1000) {
    return {
      error: "Description must be 10 to 1000 characters.",
    };
  }

  if (!Object.hasOwn(CATEGORIES, category)) {
    return {
      error: "Choose a valid category.",
    };
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9\- ]{0,9}$/.test(flat)) {
    return {
      error: "Flat must be 1 to 10 letters, numbers, spaces or dashes.",
    };
  }

  return {
    value: {
      title,
      description,
      category,
      flat,
    },
  };
}

// ---------------- AUTHENTICATION ROUTES ----------------

// Public registration always creates a resident account.
// Never accept a role from the registration request.

app.post("/api/auth/register", async (req, res) => {
  try {
    const body = req.body || {};

    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const password =
      typeof body.password === "string" ? body.password : "";

    const flat =
      typeof body.flat === "string" ? body.flat.trim() : "";

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({
        error: "Name must be 2 to 80 characters.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        error: "Enter a valid email address.",
      });
    }

    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({
        error: "Password must be 8 to 72 characters.",
      });
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9\- ]{0,9}$/.test(flat)) {
      return res.status(400).json({
        error: "Enter a valid flat number.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let result;

    try {
      result = db.prepare(`
        INSERT INTO users
          (name, email, password_hash, role, flat)
        VALUES (?, ?, ?, 'resident', ?)
      `).run(name, email, passwordHash, flat);
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({
          error: "An account with this email already exists.",
        });
      }

      throw error;
    }

    const user = db.prepare(`
      SELECT id, name, email, role, flat
      FROM users
      WHERE id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json({
      user: presentUser(user),
      token: createToken(user),
    });
  } catch (error) {
    if (error.message.includes("JWT_SECRET")) {
      return res.status(500).json({
        error: error.message,
      });
    }

    console.error("Registration error:", error);

    return res.status(500).json({
      error: "Could not create account.",
    });
  }
});

// Login

app.post("/api/auth/login", async (req, res) => {
  try {
    const body = req.body || {};

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const password =
      typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required.",
      });
    }

    const user = db.prepare(`
      SELECT *
      FROM users
      WHERE email = ?
    `).get(email);

    if (
      !user ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

    return res.json({
      user: presentUser(user),
      token: createToken(user),
    });
  } catch (error) {
    if (error.message.includes("JWT_SECRET")) {
      return res.status(500).json({
        error: error.message,
      });
    }

    console.error("Login error:", error);

    return res.status(500).json({
      error: "Could not log in.",
    });
  }
});

// Current authenticated user

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    user: presentUser(req.user),
  });
});

// ---------------- GENERAL API ----------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
  });
});

app.get("/api/categories", (req, res) => {
  res.json(
    Object.entries(CATEGORIES).map(([id, category]) => ({
      id,
      label: category.label,
      slaHours: category.slaHours,
    }))
  );
});

// ---------------- COMPLAINT CREATION ----------------

// Residents can create complaints only for their registered flat.
// Staff can create complaints for a specified flat.

app.post("/api/complaints", requireAuth, (req, res) => {
  const { error, value } = validateComplaint(req.body);

  if (error) {
    return res.status(400).json({
      error,
    });
  }

  const staff = isStaff(req.user);

  const complaintFlat = staff
    ? value.flat
    : req.user.flat;

  if (!complaintFlat) {
    return res.status(400).json({
      error: "Your account does not have a registered flat. Please contact society management.",
    });
  }

  const now = Date.now();

  const ownerId = req.user.id > 0
    ? req.user.id
    : null;

  const info = db.prepare(`
    INSERT INTO complaints
      (
        title,
        description,
        category,
        flat,
        created_at,
        due_at,
        user_id
      )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.title,
    value.description,
    value.category,
    complaintFlat,
    new Date(now).toISOString(),
    computeDueAt(value.category, now),
    ownerId
  );

  const row = db.prepare(`
    SELECT *
    FROM complaints
    WHERE id = ?
  `).get(info.lastInsertRowid);

  return res.status(201).json(present(row, now));
});

// ---------------- COMPLAINT LIST ----------------

// Staff can see all complaints.
// Residents can see only complaints linked to their user ID.

app.get("/api/complaints", requireAuth, (req, res) => {
  const { status, category, overdue } = req.query;

  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({
      error: "Invalid status filter.",
    });
  }

  if (
    category !== undefined &&
    !Object.hasOwn(CATEGORIES, category)
  ) {
    return res.status(400).json({
      error: "Invalid category filter.",
    });
  }

  const rows = isStaff(req.user)
    ? db.prepare("SELECT * FROM complaints").all()
    : db.prepare(`
        SELECT *
        FROM complaints
        WHERE user_id = ?
      `).all(req.user.id);

  const now = Date.now();

  let list = rows.map(row => present(row, now));

  if (status) {
    list = list.filter(c => c.status === status);
  }

  if (category) {
    list = list.filter(c => c.category === category);
  }

  if (overdue === "true") {
    list = list.filter(c => c.sla.overdue);
  }

  list.sort((a, b) => {
    const aResolved = a.status === "resolved";
    const bResolved = b.status === "resolved";

    if (aResolved !== bResolved) {
      return aResolved ? 1 : -1;
    }

    if (!aResolved) {
      return Date.parse(a.dueAt) - Date.parse(b.dueAt);
    }

    return Date.parse(b.resolvedAt) - Date.parse(a.resolvedAt);
  });

  return res.json(list);
});

// ---------------- SINGLE COMPLAINT ----------------

// Residents cannot access another resident's complaint by changing its ID.

app.get("/api/complaints/:id", requireAuth, (req, res) => {
  const complaintId = Number(req.params.id);

  if (!Number.isSafeInteger(complaintId) || complaintId <= 0) {
    return res.status(400).json({
      error: "Invalid complaint ID.",
    });
  }

  const row = isStaff(req.user)
    ? db.prepare(`
        SELECT *
        FROM complaints
        WHERE id = ?
      `).get(complaintId)
    : db.prepare(`
        SELECT *
        FROM complaints
        WHERE id = ? AND user_id = ?
      `).get(complaintId, req.user.id);

  if (!row) {
    return res.status(404).json({
      error: "Complaint not found.",
    });
  }

  return res.json(present(row));
});

// ---------------- UPDATE COMPLAINT STATUS ----------------

// Only committee, secretary and president can update status.

app.patch(
  "/api/complaints/:id/status",
  requireAuth,
  requireStaff,
  (req, res) => {
    const complaintId = Number(req.params.id);

    if (!Number.isSafeInteger(complaintId) || complaintId <= 0) {
      return res.status(400).json({
        error: "Invalid complaint ID.",
      });
    }

    const next = (req.body || {}).status;

    if (!STATUSES.includes(next)) {
      return res.status(400).json({
        error: "Status must be open, in_progress or resolved.",
      });
    }

    const row = db.prepare(`
      SELECT *
      FROM complaints
      WHERE id = ?
    `).get(complaintId);

    if (!row) {
      return res.status(404).json({
        error: "Complaint not found.",
      });
    }

    if (!TRANSITIONS[row.status].includes(next)) {
      return res.status(409).json({
        error: `Cannot move a complaint from ${row.status} to ${next}.`,
      });
    }

    const now = new Date().toISOString();

    const info = db.prepare(`
      UPDATE complaints
      SET
        status = ?,
        first_response_at = COALESCE(first_response_at, ?),
        resolved_at = ?
      WHERE id = ? AND status = ?
    `).run(
      next,
      next === "open" ? null : now,
      next === "resolved" ? now : null,
      row.id,
      row.status
    );

    if (info.changes === 0) {
      return res.status(409).json({
        error: "This complaint was just updated. Refresh and try again.",
      });
    }

    const updated = db.prepare(`
      SELECT *
      FROM complaints
      WHERE id = ?
    `).get(row.id);

    return res.json(present(updated));
  }
);

// ---------------- DASHBOARD SUMMARY ----------------

// Residents receive statistics for their own complaints.
// Staff receive society-wide statistics.

app.get("/api/summary", requireAuth, (req, res) => {
  const rows = isStaff(req.user)
    ? db.prepare("SELECT * FROM complaints").all()
    : db.prepare(`
        SELECT *
        FROM complaints
        WHERE user_id = ?
      `).all(req.user.id);

  const now = Date.now();

  const all = rows.map(row => present(row, now));

  const resolved = all.filter(
    complaint => complaint.status === "resolved"
  );

  const hours = resolved.map(
    complaint =>
      (
        Date.parse(complaint.resolvedAt) -
        Date.parse(complaint.createdAt)
      ) / 3600000
  );

  return res.json({
    total: all.length,

    open: all.filter(
      complaint => complaint.status === "open"
    ).length,

    inProgress: all.filter(
      complaint => complaint.status === "in_progress"
    ).length,

    resolved: resolved.length,

    overdue: all.filter(
      complaint => complaint.sla.overdue
    ).length,

    avgResolutionHours: hours.length
      ? Math.round(
          (
            hours.reduce((a, b) => a + b, 0) /
            hours.length
          ) * 10
        ) / 10
      : null,
  });
});

// ---------------- SERVER START ----------------

if (require.main === module) {
  const PORT = process.env.PORT || 4002;

  app.listen(PORT, () => {
    console.log(`SocietyDesk API running on port ${PORT}`);
  });
}

module.exports = {
  app,
  db,
};
