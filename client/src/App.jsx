
import { useCallback, useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4002/api";
const SOCIETY = "Maple Heights Residents' Association";

const STATUS_LABEL = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

const EMPTY_FORM = {
  title: "",
  category: "",
  flat: "",
  description: "",
};

async function api(path, options = {}, token = null) {
  let res;

  try {
    res = await fetch(API + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error("Can't reach the server. Is the API running?");
  }

  const data =
    res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || "Something went wrong.");
  }

  return data;
}

function timeAgo(iso) {
  const mins = Math.max(
    0,
    Math.round((Date.now() - Date.parse(iso)) / 60000)
  );

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.round(mins / 60);

  if (hours < 48) return `${hours} h ago`;

  return `${Math.round(hours / 24)} days ago`;
}

function fmtHours(h) {
  if (h >= 24 && h % 24 === 0) {
    return `${h / 24} day${h === 24 ? "" : "s"}`;
  }

  return `${h} hours`;
}

function slaClass(sla) {
  if (sla.resolvedLate !== undefined) {
    return sla.resolvedLate ? "sla-late" : "sla-done";
  }

  if (!sla.overdue) return "sla-ok";

  return `sla-l${sla.escalationLevel}`;
}

function Ladder({ level }) {
  const steps = ["Committee", "Secretary", "President"];

  return (
    <ol className="ladder" aria-label={`Escalation level ${level} of 3`}>
      {steps.map((step, i) => (
        <li key={step} className={i < level ? "on" : ""}>
          {step}
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Authentication ---------------- */

function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [flat, setFlat] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    setError("");
    setBusy(true);

    try {
      const endpoint =
        mode === "login" ? "/auth/login" : "/auth/register";

      const payload =
        mode === "login"
          ? { email, password }
          : { name, email, password, flat };

      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!result?.token || !result?.user) {
        throw new Error("Invalid authentication response.");
      }

      onLogin(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand auth-brand">
          <span className="mark" aria-hidden="true" />
          SocietyDesk
        </div>

        <div className="auth-heading">
          <span className="auth-eyebrow">RESIDENT COMMUNITY PORTAL</span>

          <h1>
            {mode === "login"
              ? "Welcome back"
              : "Create your account"}
          </h1>

          <p className="auth-subtitle">
            {mode === "login"
              ? "Sign in to manage your society complaints."
              : "Join your residents' community and get started."}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "register" && (
            <>
              <label htmlFor="auth-name">Full name</label>

              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your full name"
                minLength={2}
                maxLength={80}
                autoComplete="name"
                required
              />

              <label htmlFor="auth-flat">Flat number</label>

              <input
                id="auth-flat"
                type="text"
                value={flat}
                onChange={(e) => setFlat(e.target.value)}
                placeholder="e.g. B-204"
                maxLength={10}
                required
              />
            </>
          )}

          <label htmlFor="auth-email">Email address</label>

          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />

          <label htmlFor="auth-password">Password</label>

          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            minLength={8}
            maxLength={72}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            required
          />

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button
            className="btn primary block auth-submit"
            type="submit"
            disabled={busy}
          >
            {busy
              ? "Please wait..."
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <div className="auth-switch">
          {mode === "login"
            ? "Don't have an account?"
            : "Already have an account?"}

          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </div>

        <p className="auth-footer">
          SocietyDesk · Simplifying community management
        </p>
      </section>
    </main>
  );
}

/* ---------------- Complaint Card ---------------- */

function ComplaintCard({ c, busy, onStatus, canManage }) {
  const levelClass = c.sla.overdue
    ? `level-${c.sla.escalationLevel}`
    : "";

  return (
    <article className={`complaint ${levelClass}`}>
      <div className="complaint-head">
        <h3>{c.title}</h3>

        <span className={`status status-${c.status}`}>
          {STATUS_LABEL[c.status]}
        </span>
      </div>

      <p className="complaint-meta">
        <span>{c.categoryLabel}</span>
        <span>Flat {c.flat}</span>
        <span>Raised {timeAgo(c.createdAt)}</span>
      </p>

      <p className="complaint-desc">{c.description}</p>

      <div className="complaint-sla">
        <span className={`sla ${slaClass(c.sla)}`}>
          {c.sla.summary}
        </span>

        {c.sla.overdue && (
          <Ladder level={c.sla.escalationLevel} />
        )}
      </div>

      {canManage && (
        <div className="actions">
          {c.status === "open" && (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => onStatus(c.id, "in_progress")}
            >
              Start work
            </button>
          )}

          {c.status !== "resolved" && (
            <button
              className="btn small primary"
              disabled={busy}
              onClick={() => onStatus(c.id, "resolved")}
            >
              Mark resolved
            </button>
          )}

          {c.status === "resolved" && (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => onStatus(c.id, "open")}
            >
              Reopen
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/* ---------------- Main Application ---------------- */

export default function App() {
  const [user, setUser] = useState(null);

  const [token, setToken] = useState(
    () => localStorage.getItem("societydesk_token")
  );

  const [authLoading, setAuthLoading] = useState(true);

  const [categories, setCategories] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [summary, setSummary] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const canManage = [
    "committee",
    "secretary",
    "president",
  ].includes(user?.role);

  /* Verify existing session */

  useEffect(() => {
    let active = true;

    async function verifySession() {
      if (!token) {
        setUser(null);
        setAuthLoading(false);
        return;
      }

      try {
        const result = await api("/auth/me", {}, token);

        if (active) {
          setUser(result.user);
        }
      } catch {
        localStorage.removeItem("societydesk_token");

        if (active) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    }

    verifySession();

    return () => {
      active = false;
    };
  }, [token]);

  /* Login */

  const handleLogin = (result) => {
    localStorage.setItem("societydesk_token", result.token);

    setUser(result.user);
    setToken(result.token);

    setLoading(true);
    setLoadError("");
  };

  /* Logout */

  const logout = () => {
    localStorage.removeItem("societydesk_token");

    setToken(null);
    setUser(null);

    setComplaints([]);
    setSummary(null);
    setCategories([]);

    setLoading(true);
    setForm(EMPTY_FORM);
    setNotice("");
    setActionError("");
    setLoadError("");
  };

  /* Dashboard data */

  const refresh = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([
        api("/complaints", {}, token),
        api("/summary", {}, token),
      ]);

      setComplaints(list);
      setSummary(sum);
      setLoadError("");
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!user || !token) return;

    let active = true;

    async function loadDashboard() {
      try {
        const [categoryList, complaintList, sum] =
          await Promise.all([
            api("/categories", {}, token),
            api("/complaints", {}, token),
            api("/summary", {}, token),
          ]);

        if (active) {
          setCategories(categoryList);
          setComplaints(complaintList);
          setSummary(sum);
          setLoadError("");
        }
      } catch (e) {
        if (active) {
          setLoadError(e.message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    const timer = setInterval(() => {
      refresh();
    }, 60000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user, token, refresh]);

  /* Raise complaint */

  const submit = async (e) => {
    e.preventDefault();

    setFormError("");
    setNotice("");
    setSubmitting(true);

    try {
      const c = await api(
        "/complaints",
        {
          method: "POST",
          body: JSON.stringify(form),
        },
        token
      );

      setForm(EMPTY_FORM);

      setNotice(
        `Complaint raised. We aim to resolve it by ${new Date(
          c.dueAt
        ).toLocaleString()}.`
      );

      setFormOpen(false);

      await refresh();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* Update complaint status */

  const changeStatus = async (id, status) => {
    setActionError("");
    setBusyId(id);

    try {
      await api(
        `/complaints/${id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
        token
      );

      await refresh();
    } catch (err) {
      setActionError(err.message);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  /* Filters */

  const visible = complaints.filter(
    (c) =>
      (statusFilter === "all" || c.status === statusFilter) &&
      (categoryFilter === "all" || c.category === categoryFilter) &&
      (!overdueOnly || c.sla.overdue)
  );

  const selected = categories.find(
    (c) => c.id === form.category
  );

  const tabs = [
    ["all", "All", summary?.total],
    ["open", "Open", summary?.open],
    ["in_progress", "In progress", summary?.inProgress],
    ["resolved", "Resolved", summary?.resolved],
  ];

  /* Loading and authentication */

  if (authLoading) {
    return (
      <div className="auth-loading">
        <span className="mark" />
        <p>Checking your session...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  /* Dashboard UI */

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          SocietyDesk
        </div>

        <div className="user-info">
          <div className="user-details">
            <span>{user.name}</span>
            <small>{user.role}</small>
          </div>

          <button className="btn small" onClick={logout}>
            Logout
          </button>
        </div>

        <button
          className="btn primary raise-btn"
          onClick={() => setFormOpen((o) => !o)}
        >
          {formOpen ? "Close form" : "Raise a complaint"}
        </button>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <h1>{SOCIETY}</h1>

          <p>
            Raise a complaint, track the deadline, and see who it
            escalates to.
          </p>
        </div>
      </section>

      <main className="layout">
        <section className="main-col" aria-label="Complaints">
          {summary && (
            <div className="stats">
              <button
                className={`stat stat-overdue ${
                  overdueOnly ? "active" : ""
                }`}
                aria-pressed={overdueOnly}
                onClick={() => setOverdueOnly((v) => !v)}
              >
                <strong>{summary.overdue}</strong>
                <span>Overdue</span>
              </button>

              <div className="stat">
                <strong>{summary.open}</strong>
                <span>Open</span>
              </div>

              <div className="stat">
                <strong>{summary.inProgress}</strong>
                <span>In progress</span>
              </div>

              <div className="stat">
                <strong>{summary.resolved}</strong>
                <span>Resolved</span>
              </div>
            </div>
          )}

          {summary?.avgResolutionHours != null && (
            <p className="avg">
              Average time to resolve: {summary.avgResolutionHours} h
            </p>
          )}

          <div className="filters">
            <div className="tabs" role="tablist">
              {tabs.map(([id, label, count]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={statusFilter === id}
                  className="tab"
                  onClick={() => setStatusFilter(id)}
                >
                  {label}

                  {count != null && (
                    <span className="count">{count}</span>
                  )}
                </button>
              ))}
            </div>

            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">All categories</option>

              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <p className="hint">
            {canManage
              ? "Staff access: You can manage complaint statuses."
              : "Resident access: You can raise and track complaints."}
          </p>

          {loadError && (
            <div className="banner error" role="alert">
              {loadError}
            </div>
          )}

          {actionError && (
            <div className="banner error" role="alert">
              {actionError}
            </div>
          )}

          {loading && (
            <p className="empty">Loading complaints...</p>
          )}

          {!loading && !loadError && visible.length === 0 && (
            <p className="empty">
              {complaints.length === 0
                ? "No complaints yet. Raise the first one."
                : "No complaints match these filters."}
            </p>
          )}

          <div className="list">
            {visible.map((c) => (
              <ComplaintCard
                key={c.id}
                c={c}
                busy={busyId === c.id}
                onStatus={changeStatus}
                canManage={canManage}
              />
            ))}
          </div>
        </section>

        <aside className={`form-card ${formOpen ? "open" : ""}`}>
          <h2>Raise a complaint</h2>

          <form onSubmit={submit}>
            <label htmlFor="title">Title</label>

            <input
              id="title"
              value={form.title}
              maxLength={100}
              placeholder="e.g. Lift stuck on the 4th floor"
              onChange={(e) =>
                setForm({ ...form, title: e.target.value })
              }
              required
            />

            <div className="row">
              <div>
                <label htmlFor="category">Category</label>

                <select
                  id="category"
                  value={form.category}
                  required
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                >
                  <option value="">Choose one</option>

                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="flat">Flat</label>

                <input
                  id="flat"
                  value={form.flat}
                  maxLength={10}
                  placeholder="B-204"
                  onChange={(e) =>
                    setForm({ ...form, flat: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            {selected && (
              <p className="sla-hint">
                We aim to resolve this within{" "}
                {fmtHours(selected.slaHours)}.
              </p>
            )}

            <label htmlFor="description">Details</label>

            <textarea
              id="description"
              rows={4}
              value={form.description}
              maxLength={1000}
              placeholder="What is wrong, and where?"
              onChange={(e) =>
                setForm({
                  ...form,
                  description: e.target.value,
                })
              }
              required
            />

            <p className="counter">
              {form.description.length}/1000
            </p>

            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}

            {notice && (
              <p className="form-notice" role="status">
                {notice}
              </p>
            )}

            <button
              className="btn primary block"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Submit complaint"}
            </button>
          </form>
        </aside>
      </main>
    </div>
  );
}
