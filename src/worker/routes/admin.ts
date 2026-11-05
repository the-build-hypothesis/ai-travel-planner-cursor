import { Hono } from "hono";
import {
  hashPassword,
  nowIso,
  randomId,
  sha256Hex,
  verifyPassword,
} from "../../shared/crypto";
import {
  clearAdminSessionCookie,
  createAdminSession,
  loadAdminSession,
  setAdminSessionCookie,
  writeAudit,
  ADMIN_SESSION_COOKIE,
} from "../auth";
import { ensureBootstrapAdmin } from "../bootstrap";
import type { Env } from "../env";
import { checkRateLimit } from "../rate-limit";
import { parseItinerary } from "../trips";
import type { AppVariables } from "../util";
import { clientIp, jsonError, parseCookies, readJson } from "../util";

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

admin.use("*", async (c, next) => {
  await ensureBootstrapAdmin(c.env);
  await next();
});

function parseRange(c: { req: { query: (k: string) => string | undefined } }): {
  from: string | null;
  to: string | null;
  label: string;
} {
  const preset = c.req.query("preset") ?? "last_30_days";
  const customFrom = c.req.query("from");
  const customTo = c.req.query("to");
  const now = Date.now();
  const to = new Date(now).toISOString();
  const hours: Record<string, number> = {
    last_hour: 1,
    last_day: 24,
    last_3_days: 72,
    last_7_days: 24 * 7,
    last_30_days: 24 * 30,
    last_90_days: 24 * 90,
    last_year: 24 * 365,
  };
  if (preset === "custom" && customFrom && customTo) {
    return { from: new Date(customFrom).toISOString(), to: new Date(customTo).toISOString(), label: "custom" };
  }
  if (preset === "all") return { from: null, to: null, label: "all" };
  const h = hours[preset] ?? hours.last_30_days;
  const from = new Date(now - h * 3600_000).toISOString();
  return { from, to, label: preset };
}

/** Time zone convention: all dashboard timestamps and filters use UTC. */

admin.post("/login", async (c) => {
  const rl = await checkRateLimit(c.env, `adminlogin:${clientIp(c)}`, 8, 900);
  if (!rl.allowed) {
    await writeAudit(c.env, {
      action: "admin_login",
      outcome: "rate_limited",
      ipHint: clientIp(c),
    });
    return jsonError(c, 429, "rate_limited", "Too many login attempts.");
  }

  const body = await readJson<{ username?: string; password?: string }>(c);
  if (!body?.username || !body?.password) {
    return jsonError(c, 400, "invalid_body", "Username and password required.");
  }

  const row = await c.env.DB.prepare(
    `SELECT id, username, password_hash, disabled, must_change_password FROM administrators WHERE username = ? COLLATE NOCASE`,
  )
    .bind(body.username.trim())
    .first<{
      id: string;
      username: string;
      password_hash: string;
      disabled: number;
      must_change_password: number;
    }>();

  const dummy =
    "pbkdf2$210000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
  const valid = await verifyPassword(body.password, row?.password_hash ?? dummy);
  if (!row || !valid) {
    await writeAudit(c.env, {
      action: "admin_login",
      outcome: "failure",
      details: { username: body.username },
      ipHint: clientIp(c),
    });
    return jsonError(c, 401, "invalid_credentials", "Invalid username or password.");
  }
  if (row.disabled) {
    await writeAudit(c.env, {
      adminId: row.id,
      adminUsername: row.username,
      action: "admin_login",
      outcome: "disabled",
      ipHint: clientIp(c),
    });
    return jsonError(c, 403, "account_disabled", "Administrator account disabled.");
  }

  const session = await createAdminSession(c.env, row.id);
  setAdminSessionCookie(c, session.token);
  await c.env.DB.prepare(`UPDATE administrators SET last_login_at = ? WHERE id = ?`)
    .bind(nowIso(), row.id)
    .run();
  await writeAudit(c.env, {
    adminId: row.id,
    adminUsername: row.username,
    action: "admin_login",
    outcome: "success",
    ipHint: clientIp(c),
  });

  return c.json({
    admin: {
      id: row.id,
      username: row.username,
      mustChangePassword: !!row.must_change_password,
    },
  });
});

admin.post("/logout", async (c) => {
  const cookies = parseCookies(c.req.header("cookie"));
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (token) {
    const hash = await sha256Hex(token);
    await c.env.DB.prepare(
      `UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
    )
      .bind(nowIso(), hash)
      .run();
  }
  clearAdminSessionCookie(c);
  return c.json({ ok: true });
});

admin.get("/me", async (c) => {
  const session = await loadAdminSession(c);
  if (!session) return jsonError(c, 401, "unauthorized", "Admin sign-in required.");
  return c.json({
    admin: {
      id: session.adminId,
      username: session.username,
      mustChangePassword: session.mustChangePassword,
    },
  });
});

admin.use("*", async (c, next) => {
  if (c.req.path.endsWith("/login") || c.req.method === "OPTIONS") return next();
  // /me and /logout handled above; protect remaining
  if (c.req.path.endsWith("/logout") || c.req.path.endsWith("/me") || c.req.path.endsWith("/login")) {
    return next();
  }
  const session = await loadAdminSession(c);
  if (!session) return jsonError(c, 401, "unauthorized", "Admin sign-in required.");
  if (session.mustChangePassword && !c.req.path.endsWith("/change-password")) {
    return jsonError(
      c,
      403,
      "must_change_password",
      "Change the bootstrap password before accessing the admin console.",
    );
  }
  await next();
});

admin.post("/change-password", async (c) => {
  const session = await loadAdminSession(c);
  if (!session) return jsonError(c, 401, "unauthorized", "Admin sign-in required.");
  const body = await readJson<{ currentPassword?: string; newPassword?: string }>(c);
  if (!body?.currentPassword || !body?.newPassword) {
    return jsonError(c, 400, "invalid_body", "Current and new password required.");
  }
  if (body.newPassword.length < 10) {
    return jsonError(c, 400, "weak_password", "Admin password must be at least 10 characters.");
  }
  if (body.newPassword === "admin") {
    return jsonError(c, 400, "weak_password", "Choose a password other than the bootstrap default.");
  }
  const row = await c.env.DB.prepare(`SELECT password_hash FROM administrators WHERE id = ?`)
    .bind(session.adminId)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
    return jsonError(c, 401, "invalid_credentials", "Current password is incorrect.");
  }
  const passwordHash = await hashPassword(body.newPassword);
  await c.env.DB.prepare(
    `UPDATE administrators SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`,
  )
    .bind(passwordHash, nowIso(), session.adminId)
    .run();
  await writeAudit(c.env, {
    adminId: session.adminId,
    adminUsername: session.username,
    action: "admin_password_change",
    targetType: "administrator",
    targetId: session.adminId,
    outcome: "success",
  });
  return c.json({ ok: true, mustChangePassword: false });
});

admin.get("/admins", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, username, must_change_password, disabled, is_bootstrap, created_at, last_login_at FROM administrators ORDER BY created_at ASC`,
  ).all();
  return c.json({
    administrators: rows.results.map((r) => ({
      id: r.id,
      username: r.username,
      mustChangePassword: !!r.must_change_password,
      disabled: !!r.disabled,
      isBootstrap: !!r.is_bootstrap,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    })),
  });
});

admin.post("/admins", async (c) => {
  const body = await readJson<{ username?: string; password?: string }>(c);
  if (!body?.username || !body?.password) {
    return jsonError(c, 400, "invalid_body", "Username and password required.");
  }
  if (body.password.length < 10) {
    return jsonError(c, 400, "weak_password", "Password must be at least 10 characters.");
  }
  const existing = await c.env.DB.prepare(
    `SELECT id FROM administrators WHERE username = ? COLLATE NOCASE`,
  )
    .bind(body.username.trim())
    .first();
  if (existing) return jsonError(c, 409, "username_taken", "Username already exists.");
  const id = randomId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO administrators (id, username, password_hash, must_change_password, disabled, is_bootstrap, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, 0, ?, ?)`,
  )
    .bind(id, body.username.trim(), await hashPassword(body.password), now, now)
    .run();
  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "admin_create",
    targetType: "administrator",
    targetId: id,
    outcome: "success",
  });
  return c.json({ id }, 201);
});

admin.post("/admins/:id/reset-password", async (c) => {
  const body = await readJson<{ newPassword?: string }>(c);
  if (!body?.newPassword || body.newPassword.length < 10) {
    return jsonError(c, 400, "weak_password", "Password must be at least 10 characters.");
  }
  const id = c.req.param("id");
  const target = await c.env.DB.prepare(`SELECT id FROM administrators WHERE id = ?`)
    .bind(id)
    .first();
  if (!target) return jsonError(c, 404, "not_found", "Administrator not found.");
  await c.env.DB.prepare(
    `UPDATE administrators SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?`,
  )
    .bind(await hashPassword(body.newPassword), nowIso(), id)
    .run();
  await c.env.DB.prepare(
    `UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL`,
  )
    .bind(nowIso(), id)
    .run();
  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "admin_password_reset",
    targetType: "administrator",
    targetId: id,
    outcome: "success",
  });
  return c.json({ ok: true });
});

admin.post("/admins/:id/disable", async (c) => {
  const id = c.req.param("id");
  const active = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM administrators WHERE disabled = 0`,
  ).first<{ n: number }>();
  const target = await c.env.DB.prepare(
    `SELECT id, disabled FROM administrators WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: string; disabled: number }>();
  if (!target) return jsonError(c, 404, "not_found", "Not found.");
  if (!target.disabled && (active?.n ?? 0) <= 1) {
    return jsonError(c, 400, "last_admin", "Cannot disable the last active administrator.");
  }
  await c.env.DB.prepare(
    `UPDATE administrators SET disabled = 1, updated_at = ? WHERE id = ?`,
  )
    .bind(nowIso(), id)
    .run();
  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "admin_disable",
    targetType: "administrator",
    targetId: id,
    outcome: "success",
  });
  return c.json({ ok: true });
});

admin.post("/admins/:id/enable", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE administrators SET disabled = 0, updated_at = ? WHERE id = ?`,
  )
    .bind(nowIso(), id)
    .run();
  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "admin_enable",
    targetType: "administrator",
    targetId: id,
    outcome: "success",
  });
  return c.json({ ok: true });
});

admin.delete("/admins/:id", async (c) => {
  const id = c.req.param("id");
  const active = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM administrators WHERE disabled = 0`,
  ).first<{ n: number }>();
  const target = await c.env.DB.prepare(
    `SELECT id, disabled FROM administrators WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: string; disabled: number }>();
  if (!target) return jsonError(c, 404, "not_found", "Not found.");
  if (!target.disabled && (active?.n ?? 0) <= 1) {
    return jsonError(c, 400, "last_admin", "Cannot delete the last active administrator.");
  }
  await c.env.DB.prepare(`DELETE FROM administrators WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "admin_delete",
    targetType: "administrator",
    targetId: id,
    outcome: "success",
  });
  return c.json({ ok: true });
});

admin.get("/metrics/overview", async (c) => {
  const range = parseRange(c);
  const lifetimeUsers = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM users`).first<{ n: number }>();
  const lifetimeTrips = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM trips`).first<{ n: number }>();

  let periodUsers = { n: 0 };
  let periodTrips = { n: 0 };
  if (range.from && range.to) {
    periodUsers = (await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM users WHERE created_at >= ? AND created_at <= ?`,
    )
      .bind(range.from, range.to)
      .first<{ n: number }>()) ?? { n: 0 };
    periodTrips = (await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM trips WHERE created_at >= ? AND created_at <= ?`,
    )
      .bind(range.from, range.to)
      .first<{ n: number }>()) ?? { n: 0 };
  }

  const costSql = range.from
    ? `SELECT provider, COALESCE(SUM(estimated_cost),0) as cost, COUNT(*) as requests
       FROM usage_records WHERE timestamp >= ? AND timestamp <= ? GROUP BY provider`
    : `SELECT provider, COALESCE(SUM(estimated_cost),0) as cost, COUNT(*) as requests
       FROM usage_records GROUP BY provider`;
  const costs = range.from
    ? await c.env.DB.prepare(costSql).bind(range.from, range.to!).all<{
        provider: string;
        cost: number;
        requests: number;
      }>()
    : await c.env.DB.prepare(costSql).all<{ provider: string; cost: number; requests: number }>();

  let llmCost = 0;
  let placesCost = 0;
  for (const row of costs.results) {
    if (row.provider === "openai" || row.provider.includes("llm")) llmCost += row.cost;
    else if (row.provider.includes("google") || row.provider.includes("places")) placesCost += row.cost;
  }

  const unattributed = range.from
    ? await c.env.DB.prepare(
        `SELECT COALESCE(SUM(estimated_cost),0) as cost FROM usage_records
         WHERE trip_id IS NULL AND timestamp >= ? AND timestamp <= ?`,
      )
        .bind(range.from, range.to!)
        .first<{ cost: number }>()
    : await c.env.DB.prepare(
        `SELECT COALESCE(SUM(estimated_cost),0) as cost FROM usage_records WHERE trip_id IS NULL`,
      ).first<{ cost: number }>();

  return c.json({
    timezone: "UTC",
    range,
    costDisclaimer: "Costs are application-level estimates, not invoices.",
    lifetime: {
      users: lifetimeUsers?.n ?? 0,
      trips: lifetimeTrips?.n ?? 0,
    },
    period: {
      newUsers: periodUsers.n,
      newTrips: periodTrips.n,
      llmCost,
      placesCost,
      combinedCost: llmCost + placesCost,
      unattributedCost: unattributed?.cost ?? 0,
    },
    byProvider: costs.results,
  });
});

admin.get("/metrics/timeseries", async (c) => {
  const range = parseRange(c);
  const from = range.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
  const to = range.to ?? nowIso();

  const usage = await c.env.DB.prepare(
    `SELECT substr(timestamp,1,10) as day, provider,
            COALESCE(SUM(estimated_cost),0) as cost,
            COUNT(*) as requests,
            COALESCE(SUM(input_tokens),0) as input_tokens,
            COALESCE(SUM(output_tokens),0) as output_tokens
     FROM usage_records
     WHERE timestamp >= ? AND timestamp <= ?
     GROUP BY day, provider ORDER BY day ASC`,
  )
    .bind(from, to)
    .all();

  const trips = await c.env.DB.prepare(
    `SELECT substr(created_at,1,10) as day, COUNT(*) as count
     FROM trips WHERE created_at >= ? AND created_at <= ?
     GROUP BY day ORDER BY day ASC`,
  )
    .bind(from, to)
    .all();

  const users = await c.env.DB.prepare(
    `SELECT substr(created_at,1,10) as day, COUNT(*) as count
     FROM users WHERE created_at >= ? AND created_at <= ?
     GROUP BY day ORDER BY day ASC`,
  )
    .bind(from, to)
    .all();

  return c.json({
    timezone: "UTC",
    range: { from, to, label: range.label },
    usage: usage.results,
    trips: trips.results,
    users: users.results,
  });
});

admin.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const range = parseRange(c);
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);

  const rows = q
    ? await c.env.DB.prepare(
        `SELECT u.*,
          (SELECT COUNT(*) FROM trips t WHERE t.owner_user_id = u.id) as trip_count
         FROM users u
         WHERE u.email_normalized LIKE ?
         ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      )
        .bind(`%${q}%`, limit, offset)
        .all()
    : await c.env.DB.prepare(
        `SELECT u.*,
          (SELECT COUNT(*) FROM trips t WHERE t.owner_user_id = u.id) as trip_count
         FROM users u
         ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      )
        .bind(limit, offset)
        .all();

  const users = [];
  for (const u of rows.results) {
    const costs = range.from
      ? await c.env.DB.prepare(
          `SELECT provider, COALESCE(SUM(estimated_cost),0) as cost FROM usage_records
           WHERE owner_user_id = ? AND timestamp >= ? AND timestamp <= ? GROUP BY provider`,
        )
          .bind(u.id, range.from, range.to!)
          .all<{ provider: string; cost: number }>()
      : await c.env.DB.prepare(
          `SELECT provider, COALESCE(SUM(estimated_cost),0) as cost FROM usage_records
           WHERE owner_user_id = ? GROUP BY provider`,
        )
          .bind(u.id)
          .all<{ provider: string; cost: number }>();
    let llmCost = 0;
    let placesCost = 0;
    for (const row of costs.results) {
      if (row.provider.includes("google") || row.provider.includes("places")) placesCost += row.cost;
      else llmCost += row.cost;
    }
    users.push({
      id: u.id,
      email: u.email,
      emailVerified: !!u.email_verified,
      disabled: !!u.disabled,
      createdAt: u.created_at,
      tripCount: u.trip_count,
      llmCost,
      placesCost,
      combinedCost: llmCost + placesCost,
    });
  }
  return c.json({ users, range, timezone: "UTC" });
});

admin.get("/users/:id", async (c) => {
  const id = c.req.param("id");
  const u = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
  if (!u) return jsonError(c, 404, "not_found", "User not found.");
  const trips = await c.env.DB.prepare(
    `SELECT id, title, destination, created_at, updated_at, itinerary_json FROM trips WHERE owner_user_id = ? ORDER BY created_at DESC`,
  )
    .bind(id)
    .all();
  const usage = await c.env.DB.prepare(
    `SELECT * FROM usage_records WHERE owner_user_id = ? ORDER BY timestamp DESC LIMIT 200`,
  )
    .bind(id)
    .all();

  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "user_inspect",
    targetType: "user",
    targetId: id,
    outcome: "success",
  });

  return c.json({
    user: {
      id: u.id,
      email: u.email,
      emailVerified: !!u.email_verified,
      disabled: !!u.disabled,
      displayName: u.display_name,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    },
    trips: trips.results.map((t) => ({
      id: t.id,
      title: t.title,
      destination: t.destination,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      dayCount: parseItinerary(t.itinerary_json as string | null)?.days?.length ?? 0,
    })),
    usage: usage.results,
  });
});

admin.post("/users/:id/disable", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(`UPDATE users SET disabled = 1, updated_at = ? WHERE id = ?`)
    .bind(nowIso(), id)
    .run();
  await c.env.DB.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(nowIso(), id)
    .run();
  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "user_disable",
    targetType: "user",
    targetId: id,
    outcome: "success",
  });
  return c.json({ ok: true });
});

admin.post("/users/:id/enable", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(`UPDATE users SET disabled = 0, updated_at = ? WHERE id = ?`)
    .bind(nowIso(), id)
    .run();
  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "user_enable",
    targetType: "user",
    targetId: id,
    outcome: "success",
  });
  return c.json({ ok: true });
});

admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  const confirm = c.req.query("confirm");
  if (confirm !== "delete") {
    return jsonError(
      c,
      400,
      "confirm_required",
      "Pass confirm=delete. Deletion removes the user account and owned trips; usage records are retained with null owner_user_id for historical cost accounting.",
    );
  }
  await c.env.DB.prepare(
    `UPDATE usage_records SET owner_user_id = NULL, owner_type = 'unattributed' WHERE owner_user_id = ?`,
  )
    .bind(id)
    .run();
  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "user_delete",
    targetType: "user",
    targetId: id,
    outcome: "success",
  });
  return c.json({
    ok: true,
    note: "User deleted. Trips cascaded. Usage retained as unattributed.",
  });
});

admin.get("/trips", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const owner = c.req.query("owner"); // user id or 'guest'

  let sql = `SELECT t.*, u.email as user_email FROM trips t
    LEFT JOIN users u ON u.id = t.owner_user_id WHERE 1=1`;
  const binds: unknown[] = [];
  if (q) {
    sql += ` AND (lower(t.title) LIKE ? OR lower(t.destination) LIKE ? OR lower(t.id) LIKE ?)`;
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (owner === "guest") {
    sql += ` AND t.owner_type = 'guest'`;
  } else if (owner) {
    sql += ` AND t.owner_user_id = ?`;
    binds.push(owner);
  }
  sql += ` ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all();
  const trips = [];
  for (const t of rows.results) {
    const costs = await c.env.DB.prepare(
      `SELECT provider, COALESCE(SUM(estimated_cost),0) as cost FROM usage_records WHERE trip_id = ? GROUP BY provider`,
    )
      .bind(t.id)
      .all<{ provider: string; cost: number }>();
    let llmCost = 0;
    let placesCost = 0;
    for (const row of costs.results) {
      if (row.provider.includes("google") || row.provider.includes("places")) placesCost += row.cost;
      else llmCost += row.cost;
    }
    trips.push({
      id: t.id,
      title: t.title,
      destination: t.destination,
      ownerType: t.owner_type,
      ownerUserId: t.owner_user_id,
      ownerGuestId: t.owner_guest_id,
      userEmail: t.user_email,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      dayCount: parseItinerary(t.itinerary_json as string | null)?.days?.length ?? 0,
      llmCost,
      placesCost,
      combinedCost: llmCost + placesCost,
    });
  }
  return c.json({ trips });
});

admin.get("/trips/:id", async (c) => {
  const id = c.req.param("id");
  const trip = await c.env.DB.prepare(`SELECT * FROM trips WHERE id = ?`).bind(id).first();
  if (!trip) return jsonError(c, 404, "not_found", "Trip not found.");
  const messages = await c.env.DB.prepare(
    `SELECT id, role, content, created_at FROM messages WHERE trip_id = ? ORDER BY created_at ASC`,
  )
    .bind(id)
    .all();
  const usage = await c.env.DB.prepare(
    `SELECT * FROM usage_records WHERE trip_id = ? ORDER BY timestamp DESC`,
  )
    .bind(id)
    .all();
  await writeAudit(c.env, {
    adminId: c.get("adminId"),
    adminUsername: c.get("adminUsername"),
    action: "trip_inspect",
    targetType: "trip",
    targetId: id,
    outcome: "success",
  });
  return c.json({
    trip: {
      ...trip,
      itinerary: parseItinerary(trip.itinerary_json as string | null),
    },
    messages: messages.results,
    usage: usage.results,
  });
});

admin.get("/usage", async (c) => {
  const range = parseRange(c);
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const rows = range.from
    ? await c.env.DB.prepare(
        `SELECT * FROM usage_records WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT ?`,
      )
        .bind(range.from, range.to!, limit)
        .all()
    : await c.env.DB.prepare(
        `SELECT * FROM usage_records ORDER BY timestamp DESC LIMIT ?`,
      )
        .bind(limit)
        .all();
  return c.json({ usage: rows.results, range, timezone: "UTC" });
});

admin.get("/ops/errors", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM ops_events ORDER BY timestamp DESC LIMIT 100`,
  ).all();
  const failedUsage = await c.env.DB.prepare(
    `SELECT provider, COUNT(*) as n, AVG(duration_ms) as avg_ms
     FROM usage_records WHERE status != 'ok' GROUP BY provider`,
  ).all();
  const latency = await c.env.DB.prepare(
    `SELECT provider, AVG(duration_ms) as avg_ms, COUNT(*) as n
     FROM usage_records WHERE duration_ms IS NOT NULL GROUP BY provider`,
  ).all();
  return c.json({
    events: rows.results,
    failedByProvider: failedUsage.results,
    latencyByProvider: latency.results,
  });
});

admin.get("/audit", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM admin_audit_log ORDER BY timestamp DESC LIMIT 200`,
  ).all();
  return c.json({ audit: rows.results });
});

export { admin };
