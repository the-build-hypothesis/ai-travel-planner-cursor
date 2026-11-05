import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { adminApi, ApiError, type AdminUser } from "../../api";

const PRESETS = [
  ["last_hour", "Last hour"],
  ["last_day", "Last day"],
  ["last_3_days", "Last 3 days"],
  ["last_7_days", "Last 7 days"],
  ["last_30_days", "Last 30 days"],
  ["last_90_days", "Last 90 days"],
  ["last_year", "Last year"],
  ["custom", "Custom"],
] as const;

export function AdminApp() {
  const [admin, setAdmin] = useState<AdminUser | null | undefined>(undefined);
  const [preset, setPreset] = useState("last_30_days");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    adminApi
      .me()
      .then((r) => setAdmin(r.admin))
      .catch(() => setAdmin(null));
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ preset });
    if (preset === "custom" && from && to) {
      p.set("from", from);
      p.set("to", to);
    }
    return p.toString();
  }, [preset, from, to]);

  if (admin === undefined) return <p className="shell muted">Loading admin…</p>;
  if (!admin) return <AdminLogin onLogin={setAdmin} />;
  if (admin.mustChangePassword) {
    return <ForcePasswordChange admin={admin} onDone={(a) => setAdmin(a)} />;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          Admin <span>Console</span>
        </div>
        <div className="nav-actions">
          <span className="muted">{admin.username}</span>
          <button
            className="btn secondary"
            onClick={async () => {
              await adminApi.logout();
              setAdmin(null);
            }}
          >
            Log out
          </button>
          <Link className="btn ghost" to="/">
            App
          </Link>
        </div>
      </header>
      <div className="panel" style={{ padding: "0.85rem 1rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Reporting period (UTC)</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {preset === "custom" && (
            <>
              <div className="field" style={{ margin: 0 }}>
                <label>From</label>
                <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>To</label>
                <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}
        </div>
      </div>
      <div className="admin-layout">
        <nav className="panel admin-nav">
          <Link to="/admin">Overview</Link>
          <Link to="/admin/users">Users</Link>
          <Link to="/admin/trips">Trips</Link>
          <Link to="/admin/usage">Usage</Link>
          <Link to="/admin/ops">Operations</Link>
          <Link to="/admin/admins">Administrators</Link>
          <Link to="/admin/audit">Audit log</Link>
        </nav>
        <div>
          <Routes>
            <Route path="/" element={<Overview qs={qs} />} />
            <Route path="/users" element={<Users qs={qs} />} />
            <Route path="/users/:id" element={<UserDetail />} />
            <Route path="/trips" element={<Trips />} />
            <Route path="/trips/:id" element={<TripDetail />} />
            <Route path="/usage" element={<Usage qs={qs} />} />
            <Route path="/ops" element={<Ops />} />
            <Route path="/admins" element={<Admins />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: (a: AdminUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await adminApi.login(username, password);
      onLogin(r.admin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }
  return (
    <div className="panel auth-card">
      <h1>Administrator sign-in</h1>
      <p className="lead">Separate from application user accounts.</p>
      {error && <div className="error">{error}</div>}
      <form onSubmit={submit}>
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn" style={{ width: "100%" }}>
          Sign in
        </button>
      </form>
    </div>
  );
}

function ForcePasswordChange({
  admin,
  onDone,
}: {
  admin: AdminUser;
  onDone: (a: AdminUser) => void;
}) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await adminApi.changePassword(currentPassword, newPassword);
      onDone({ ...admin, mustChangePassword: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }
  return (
    <div className="panel auth-card">
      <h1>Change bootstrap password</h1>
      <p className="lead">
        The initial administrator must set a new password before accessing the console.
      </p>
      {error && <div className="error">{error}</div>}
      <form onSubmit={submit}>
        <div className="field">
          <label>Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>New password (min 10)</label>
          <input
            type="password"
            minLength={10}
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            required
          />
        </div>
        <button className="btn" style={{ width: "100%" }}>
          Update password
        </button>
      </form>
    </div>
  );
}

function Overview({ qs }: { qs: string }) {
  const [data, setData] = useState<any>(null);
  const [series, setSeries] = useState<any>(null);
  useEffect(() => {
    adminApi.overview(qs).then(setData);
    adminApi.timeseries(qs).then(setSeries);
  }, [qs]);
  if (!data) return <p className="muted">Loading metrics…</p>;
  const costBars = (series?.usage ?? [])
    .filter((r: any) => r.provider === "openai")
    .map((r: any) => Number(r.cost));
  const tripBars = (series?.trips ?? []).map((r: any) => Number(r.count));
  return (
    <div>
      <h2>Overview</h2>
      <p className="muted">
        All timestamps UTC. {data.costDisclaimer}
      </p>
      <div className="metric-grid">
        <Metric label="Users (lifetime)" value={data.lifetime.users} />
        <Metric label="New users (period)" value={data.period.newUsers} />
        <Metric label="Trips (lifetime)" value={data.lifetime.trips} />
        <Metric label="New trips (period)" value={data.period.newTrips} />
        <Metric label="LLM cost (est.)" value={`$${Number(data.period.llmCost).toFixed(4)}`} />
        <Metric
          label="Places cost (est.)"
          value={`$${Number(data.period.placesCost).toFixed(4)}`}
        />
        <Metric
          label="Combined (est.)"
          value={`$${Number(data.period.combinedCost).toFixed(4)}`}
        />
        <Metric
          label="Unattributed (est.)"
          value={`$${Number(data.period.unattributedCost).toFixed(4)}`}
        />
      </div>
      <div className="panel" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <h3>LLM cost over time</h3>
        <BarChart values={costBars} />
      </div>
      <div className="panel" style={{ padding: "1rem" }}>
        <h3>Trip creation over time</h3>
        <BarChart values={tripBars} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function BarChart({ values }: { values: number[] }) {
  const max = Math.max(0.000001, ...values);
  if (!values.length) return <p className="muted">No data in range.</p>;
  return (
    <div className="chart">
      {values.map((v, i) => (
        <div
          key={i}
          className="bar"
          style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
          title={String(v)}
        />
      ))}
    </div>
  );
}

function Users({ qs }: { qs: string }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<any>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(qs);
    if (q) params.set("q", q);
    adminApi.users(params.toString()).then(setData);
  }, [qs, q]);
  return (
    <div>
      <h2>Users</h2>
      <input
        placeholder="Search email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: "0.8rem", width: "min(360px, 100%)", padding: "0.6rem" }}
      />
      <div className="panel" style={{ padding: "0.5rem 0.8rem", overflow: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Email</th>
              <th>Registered</th>
              <th>Status</th>
              <th>Trips</th>
              <th>LLM</th>
              <th>Places</th>
              <th>Combined</th>
            </tr>
          </thead>
          <tbody>
            {(data?.users ?? []).map((u: any) => (
              <tr
                key={u.id}
                style={{ cursor: "pointer" }}
                onClick={() => navigate(`/admin/users/${u.id}`)}
              >
                <td>{u.email}</td>
                <td>{new Date(u.createdAt).toLocaleString()}</td>
                <td>
                  {u.disabled ? (
                    <span className="badge danger">Disabled</span>
                  ) : u.emailVerified ? (
                    <span className="badge">Verified</span>
                  ) : (
                    <span className="badge warn">Unverified</span>
                  )}
                </td>
                <td>{u.tripCount}</td>
                <td>${Number(u.llmCost).toFixed(4)}</td>
                <td>${Number(u.placesCost).toFixed(4)}</td>
                <td>${Number(u.combinedCost).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (id) adminApi.user(id).then(setData);
  }, [id]);
  if (!data) return <p className="muted">Loading…</p>;
  const u = data.user;
  return (
    <div>
      <button className="btn ghost" onClick={() => navigate("/admin/users")}>
        Back
      </button>
      <h2>{u.email}</h2>
      <p className="muted">
        Created {new Date(u.createdAt).toLocaleString()} ·{" "}
        {u.disabled ? "Disabled" : "Active"} ·{" "}
        {u.emailVerified ? "Verified" : "Unverified"}
      </p>
      <div className="nav-actions" style={{ marginBottom: "1rem" }}>
        {u.disabled ? (
          <button className="btn secondary" onClick={() => adminApi.enableUser(u.id).then(() => adminApi.user(u.id).then(setData))}>
            Re-enable
          </button>
        ) : (
          <button className="btn secondary" onClick={() => adminApi.disableUser(u.id).then(() => adminApi.user(u.id).then(setData))}>
            Disable
          </button>
        )}
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm("Delete user and owned trips? Usage becomes unattributed.")) return;
            await adminApi.deleteUser(u.id);
            navigate("/admin/users");
          }}
        >
          Delete
        </button>
      </div>
      <h3>Trips</h3>
      <ul>
        {data.trips.map((t: any) => (
          <li key={t.id}>
            <Link to={`/admin/trips/${t.id}`}>{t.title}</Link> — {t.dayCount} days
          </li>
        ))}
      </ul>
      <h3>Recent usage</h3>
      <UsageTable rows={data.usage} />
    </div>
  );
}

function Trips() {
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  const [data, setData] = useState<any>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (owner) p.set("owner", owner);
    adminApi.trips(p.toString()).then(setData);
  }, [q, owner]);
  return (
    <div>
      <h2>Trips</h2>
      <div className="nav-actions" style={{ marginBottom: "0.8rem" }}>
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">All owners</option>
          <option value="guest">Guests only</option>
        </select>
      </div>
      <div className="panel" style={{ padding: "0.5rem 0.8rem", overflow: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Trip</th>
              <th>Owner</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Days</th>
              <th>LLM</th>
              <th>Places</th>
              <th>Combined</th>
            </tr>
          </thead>
          <tbody>
            {(data?.trips ?? []).map((t: any) => (
              <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/admin/trips/${t.id}`)}>
                <td>
                  <strong>{t.title}</strong>
                  <div className="muted">{t.destination}</div>
                </td>
                <td>{t.userEmail || (t.ownerType === "guest" ? "Guest" : t.ownerUserId)}</td>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
                <td>{new Date(t.updatedAt).toLocaleString()}</td>
                <td>{t.dayCount}</td>
                <td>${Number(t.llmCost).toFixed(4)}</td>
                <td>${Number(t.placesCost).toFixed(4)}</td>
                <td>${Number(t.combinedCost).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TripDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (id) adminApi.trip(id).then(setData);
  }, [id]);
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div>
      <h2>{data.trip.title}</h2>
      <p className="muted">
        {data.trip.destination} · {data.trip.owner_type} · created{" "}
        {new Date(data.trip.created_at).toLocaleString()}
      </p>
      <h3>Itinerary</h3>
      <pre style={{ whiteSpace: "pre-wrap", background: "#fff", padding: "1rem", borderRadius: 12 }}>
        {JSON.stringify(data.trip.itinerary, null, 2)}
      </pre>
      <h3>Messages</h3>
      <ul>
        {data.messages.map((m: any) => (
          <li key={m.id}>
            <strong>{m.role}</strong>: {m.content.slice(0, 200)}
          </li>
        ))}
      </ul>
      <h3>Usage</h3>
      <UsageTable rows={data.usage} />
    </div>
  );
}

function Usage({ qs }: { qs: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    adminApi.usage(qs).then(setData);
  }, [qs]);
  return (
    <div>
      <h2>Usage records</h2>
      <p className="muted">Estimated costs. Not invoices.</p>
      <UsageTable rows={data?.usage ?? []} />
    </div>
  );
}

function UsageTable({ rows }: { rows: any[] }) {
  return (
    <div className="panel" style={{ padding: "0.5rem 0.8rem", overflow: "auto" }}>
      <table className="data">
        <thead>
          <tr>
            <th>Time (UTC)</th>
            <th>Provider</th>
            <th>Endpoint/Model</th>
            <th>Status</th>
            <th>Tokens/Units</th>
            <th>Est. cost</th>
            <th>Trip</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.timestamp).toLocaleString()}</td>
              <td>{r.provider}</td>
              <td>{r.model_or_endpoint}</td>
              <td>{r.status}</td>
              <td>
                {r.input_tokens != null
                  ? `${r.input_tokens}/${r.output_tokens}`
                  : r.billable_units}
              </td>
              <td>${Number(r.estimated_cost ?? 0).toFixed(6)}</td>
              <td>{r.trip_id ? r.trip_id.slice(0, 8) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ops() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    adminApi.ops().then(setData);
  }, []);
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div>
      <h2>Operations</h2>
      <h3>Latency</h3>
      <pre>{JSON.stringify(data.latencyByProvider, null, 2)}</pre>
      <h3>Failures</h3>
      <pre>{JSON.stringify(data.failedByProvider, null, 2)}</pre>
      <h3>Recent events</h3>
      <ul>
        {data.events.map((e: any) => (
          <li key={e.id}>
            {e.timestamp} [{e.kind}] {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Admins() {
  const [data, setData] = useState<any>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reload = () => adminApi.admins().then(setData);
  useEffect(() => {
    reload();
  }, []);
  return (
    <div>
      <h2>Administrators</h2>
      {error && <div className="error">{error}</div>}
      <form
        className="panel"
        style={{ padding: "1rem", marginBottom: "1rem" }}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await adminApi.createAdmin(username, password);
            setUsername("");
            setPassword("");
            reload();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed");
          }
        }}
      >
        <h3>Create administrator</h3>
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn">Create</button>
      </form>
      <div className="panel" style={{ padding: "0.5rem 0.8rem" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Username</th>
              <th>Created</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data?.administrators ?? []).map((a: any) => (
              <tr key={a.id}>
                <td>
                  {a.username} {a.isBootstrap && <span className="badge">bootstrap</span>}
                </td>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
                <td>{a.disabled ? "Disabled" : a.mustChangePassword ? "Must change password" : "Active"}</td>
                <td className="nav-actions">
                  <button
                    className="btn ghost"
                    onClick={async () => {
                      const pw = prompt("New temporary password (min 10)");
                      if (!pw) return;
                      await adminApi.resetAdminPassword(a.id, pw);
                      reload();
                    }}
                  >
                    Reset PW
                  </button>
                  {a.disabled ? (
                    <button className="btn ghost" onClick={() => adminApi.enableAdmin(a.id).then(reload)}>
                      Enable
                    </button>
                  ) : (
                    <button className="btn ghost" onClick={() => adminApi.disableAdmin(a.id).then(reload).catch((e) => setError(e.message))}>
                      Disable
                    </button>
                  )}
                  <button
                    className="btn danger"
                    onClick={() =>
                      confirm("Delete administrator?") &&
                      adminApi.deleteAdmin(a.id).then(reload).catch((e) => setError(e.message))
                    }
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Audit() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    adminApi.audit().then(setData);
  }, []);
  return (
    <div>
      <h2>Audit log</h2>
      <p className="muted">Append-only. Passwords and tokens are never logged.</p>
      <div className="panel" style={{ padding: "0.5rem 0.8rem", overflow: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Time</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {(data?.audit ?? []).map((a: any) => (
              <tr key={a.id}>
                <td>{new Date(a.timestamp).toLocaleString()}</td>
                <td>{a.admin_username || "—"}</td>
                <td>{a.action}</td>
                <td>
                  {a.target_type} {a.target_id}
                </td>
                <td>{a.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
