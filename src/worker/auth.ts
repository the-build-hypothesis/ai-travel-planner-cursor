import {
  addDays,
  addMinutes,
  hashPassword,
  normalizeEmail,
  nowIso,
  randomId,
  randomToken,
  sha256Hex,
  verifyPassword,
} from "../shared/crypto";
import type { Env } from "./env";
import {
  passwordResetEmailContent,
  sendTransactionalEmail,
  verificationEmailContent,
} from "./email";
import { checkRateLimit } from "./rate-limit";
import type { HonoCtx } from "./util";
import { clearCookie, clientIp, cookieHeader, getPublicUrl, parseCookies } from "./util";

export const USER_SESSION_COOKIE = "atp_session";
export const GUEST_COOKIE = "atp_guest";
export const ADMIN_SESSION_COOKIE = "atp_admin_session";

const USER_SESSION_DAYS = 14;
const ADMIN_SESSION_HOURS = 8;
const VERIFY_HOURS = 24;
const RESET_MINUTES = 30;

export async function ensureGuest(c: HonoCtx): Promise<{ guestId: string; isNew: boolean }> {
  const cookies = parseCookies(c.req.header("cookie"));
  const token = cookies[GUEST_COOKIE];
  if (token) {
    const hash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT id, migrated_to_user_id FROM guests WHERE token_hash = ?`,
    )
      .bind(hash)
      .first<{ id: string; migrated_to_user_id: string | null }>();
    if (row && !row.migrated_to_user_id) {
      await c.env.DB.prepare(`UPDATE guests SET last_seen_at = ? WHERE id = ?`)
        .bind(nowIso(), row.id)
        .run();
      c.set("guestId", row.id);
      return { guestId: row.id, isNew: false };
    }
  }

  const guestId = randomId();
  const newToken = randomToken(32);
  const tokenHash = await sha256Hex(newToken);
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO guests (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(guestId, tokenHash, now, now)
    .run();

  c.header(
    "Set-Cookie",
    cookieHeader(GUEST_COOKIE, newToken, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    }),
    { append: true },
  );
  c.set("guestId", guestId);
  return { guestId, isNew: true };
}

export async function loadUserSession(c: HonoCtx): Promise<string | null> {
  const cookies = parseCookies(c.req.header("cookie"));
  const token = cookies[USER_SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256Hex(token);
  const now = nowIso();
  const row = await c.env.DB.prepare(
    `SELECT s.user_id, u.disabled FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  )
    .bind(hash, now)
    .first<{ user_id: string; disabled: number }>();
  if (!row || row.disabled) return null;
  c.set("userId", row.user_id);
  return row.user_id;
}

export async function createUserSession(
  env: Env,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  const now = nowIso();
  const expiresAt = addDays(now, USER_SESSION_DAYS);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(randomId(), userId, hash, expiresAt, now)
    .run();
  return { token, expiresAt };
}

export async function revokeUserSession(env: Env, token: string) {
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
  )
    .bind(nowIso(), hash)
    .run();
}

export async function revokeAllUserSessions(env: Env, userId: string) {
  await env.DB.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(nowIso(), userId)
    .run();
}

export async function registerUser(
  c: HonoCtx,
  input: { email: string; password: string; displayName?: string },
): Promise<{ ok: true; userId: string } | { ok: false; status: number; code: string; message: string }> {
  const email = input.email.trim();
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, status: 400, code: "invalid_email", message: "Enter a valid email address." };
  }
  if (input.password.length < 8) {
    return { ok: false, status: 400, code: "weak_password", message: "Password must be at least 8 characters." };
  }

  const rl = await checkRateLimit(c.env, `register:${clientIp(c)}`, 10, 3600);
  if (!rl.allowed) {
    return { ok: false, status: 429, code: "rate_limited", message: "Too many registration attempts. Try later." };
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM users WHERE email_normalized = ?`,
  )
    .bind(normalized)
    .first();
  if (existing) {
    return { ok: false, status: 409, code: "email_taken", message: "An account with this email already exists." };
  }

  const userId = randomId();
  const now = nowIso();
  const passwordHash = await hashPassword(input.password);
  const insert = await c.env.DB.prepare(
    `INSERT INTO users (id, email, email_normalized, password_hash, display_name, email_verified, disabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  )
    .bind(userId, email, normalized, passwordHash, input.displayName ?? null, now, now)
    .run();
  if (!insert.success) {
    return {
      ok: false,
      status: 500,
      code: "db_error",
      message: "Could not create account.",
    };
  }

  // Migrate eligible guest trips (best-effort; do not fail registration)
  const guestId = c.get("guestId");
  if (guestId) {
    try {
      await migrateGuestTrips(c.env, guestId, userId);
    } catch (err) {
      console.error("guest migration failed", err);
    }
  }

  try {
    await issueVerificationEmail(c.env, userId, email, getPublicUrl(c));
  } catch (err) {
    console.error("verification email failed", err);
  }
  return { ok: true, userId };
}

export async function migrateGuestTrips(env: Env, guestId: string, userId: string) {
  await env.DB.prepare(
    `UPDATE trips SET owner_type = 'user', owner_user_id = ?, owner_guest_id = NULL, updated_at = ?
     WHERE owner_guest_id = ? AND owner_type = 'guest'`,
  )
    .bind(userId, nowIso(), guestId)
    .run();

  await env.DB.prepare(
    `UPDATE usage_records SET owner_type = 'user', owner_user_id = ?, owner_guest_id = NULL
     WHERE owner_guest_id = ? AND owner_type = 'guest'`,
  )
    .bind(userId, guestId)
    .run();

  await env.DB.prepare(
    `UPDATE guests SET migrated_to_user_id = ?, last_seen_at = ? WHERE id = ? AND migrated_to_user_id IS NULL`,
  )
    .bind(userId, nowIso(), guestId)
    .run();
}

export async function issueVerificationEmail(
  env: Env,
  userId: string,
  email: string,
  publicUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(randomId(), userId, hash, addMinutes(now, VERIFY_HOURS * 60), now)
    .run();

  const content = verificationEmailContent(publicUrl, token);
  return sendTransactionalEmail(env, { to: email, ...content });
}

export async function loginUser(
  c: HonoCtx,
  email: string,
  password: string,
): Promise<{ ok: true; userId: string; token: string } | { ok: false; status: number; code: string; message: string }> {
  const rl = await checkRateLimit(c.env, `login:${clientIp(c)}`, 20, 900);
  if (!rl.allowed) {
    return { ok: false, status: 429, code: "rate_limited", message: "Too many login attempts. Try later." };
  }

  const normalized = normalizeEmail(email);
  const user = await c.env.DB.prepare(
    `SELECT id, password_hash, disabled FROM users WHERE email_normalized = ?`,
  )
    .bind(normalized)
    .first<{ id: string; password_hash: string; disabled: number }>();

  // Constant-ish response path: still verify against dummy if missing
  const hash = user?.password_hash ?? "pbkdf2$210000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
  const valid = await verifyPassword(password, hash);
  if (!user || !valid) {
    return { ok: false, status: 401, code: "invalid_credentials", message: "Invalid email or password." };
  }
  if (user.disabled) {
    return { ok: false, status: 403, code: "account_disabled", message: "This account has been disabled." };
  }

  const guestId = c.get("guestId");
  if (guestId) {
    await migrateGuestTrips(c.env, guestId, user.id);
  }

  const session = await createUserSession(c.env, user.id);
  return { ok: true, userId: user.id, token: session.token };
}

export async function verifyEmailToken(
  env: Env,
  token: string,
): Promise<{ ok: boolean; message: string }> {
  const hash = await sha256Hex(token);
  const now = nowIso();
  const row = await env.DB.prepare(
    `SELECT id, user_id, expires_at, used_at FROM email_verification_tokens WHERE token_hash = ?`,
  )
    .bind(hash)
    .first<{ id: string; user_id: string; expires_at: string; used_at: string | null }>();
  if (!row) return { ok: false, message: "Invalid verification link." };
  if (row.used_at) return { ok: false, message: "This verification link was already used." };
  if (row.expires_at < now) return { ok: false, message: "This verification link has expired." };

  await env.DB.batch([
    env.DB.prepare(`UPDATE email_verification_tokens SET used_at = ? WHERE id = ?`).bind(now, row.id),
    env.DB.prepare(`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`).bind(now, row.user_id),
  ]);
  return { ok: true, message: "Email verified successfully." };
}

export async function requestPasswordReset(
  c: HonoCtx,
  email: string,
): Promise<{ ok: boolean; message: string; emailSent?: boolean; emailError?: string }> {
  const rl = await checkRateLimit(c.env, `pwreset:${clientIp(c)}`, 5, 3600);
  if (!rl.allowed) {
    return { ok: false, message: "Too many reset requests. Try later." };
  }

  const normalized = normalizeEmail(email);
  const user = await c.env.DB.prepare(
    `SELECT id, email FROM users WHERE email_normalized = ? AND disabled = 0`,
  )
    .bind(normalized)
    .first<{ id: string; email: string }>();

  // Always return the same message to avoid account enumeration
  const generic = {
    ok: true,
    message: "If an account exists for that email, a reset link has been sent.",
  };

  if (!user) return generic;

  const token = randomToken(32);
  const hash = await sha256Hex(token);
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(randomId(), user.id, hash, addMinutes(now, RESET_MINUTES), now)
    .run();

  const content = passwordResetEmailContent(getPublicUrl(c), token);
  const send = await sendTransactionalEmail(c.env, { to: user.email, ...content });
  if (!send.ok) {
    return {
      ok: false,
      message: "Unable to send reset email right now. Please try again later.",
      emailSent: false,
      emailError: send.error,
    };
  }
  return { ...generic, emailSent: true };
}

export async function resetPasswordWithToken(
  env: Env,
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; message: string }> {
  if (newPassword.length < 8) {
    return { ok: false, message: "Password must be at least 8 characters." };
  }
  const hash = await sha256Hex(token);
  const now = nowIso();
  const row = await env.DB.prepare(
    `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?`,
  )
    .bind(hash)
    .first<{ id: string; user_id: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at || row.expires_at < now) {
    return { ok: false, message: "Invalid or expired reset link." };
  }

  const passwordHash = await hashPassword(newPassword);
  await env.DB.batch([
    env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`).bind(now, row.id),
    env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(
      passwordHash,
      now,
      row.user_id,
    ),
  ]);
  await revokeAllUserSessions(env, row.user_id);
  return { ok: true, message: "Password updated. Please sign in." };
}

export function setSessionCookie(c: HonoCtx, token: string) {
  c.header(
    "Set-Cookie",
    cookieHeader(USER_SESSION_COOKIE, token, {
      maxAge: USER_SESSION_DAYS * 24 * 60 * 60,
    }),
    { append: true },
  );
}

export function clearSessionCookie(c: HonoCtx) {
  c.header("Set-Cookie", clearCookie(USER_SESSION_COOKIE), { append: true });
}

export async function getPublicUser(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT id, email, display_name, email_verified, created_at FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      email_verified: number;
      created_at: string;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    emailVerified: !!row.email_verified,
    createdAt: row.created_at,
  };
}

/** Admin auth */
export async function loadAdminSession(c: HonoCtx): Promise<{
  adminId: string;
  username: string;
  mustChangePassword: boolean;
} | null> {
  const cookies = parseCookies(c.req.header("cookie"));
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256Hex(token);
  const now = nowIso();
  const row = await c.env.DB.prepare(
    `SELECT s.admin_id, a.username, a.must_change_password, a.disabled
     FROM admin_sessions s
     JOIN administrators a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  )
    .bind(hash, now)
    .first<{
      admin_id: string;
      username: string;
      must_change_password: number;
      disabled: number;
    }>();
  if (!row || row.disabled) return null;
  c.set("adminId", row.admin_id);
  c.set("adminUsername", row.username);
  c.set("mustChangePassword", !!row.must_change_password);
  return {
    adminId: row.admin_id,
    username: row.username,
    mustChangePassword: !!row.must_change_password,
  };
}

export async function createAdminSession(env: Env, adminId: string) {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  const now = nowIso();
  const expiresAt = addMinutes(now, ADMIN_SESSION_HOURS * 60);
  await env.DB.prepare(
    `INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(randomId(), adminId, hash, expiresAt, now)
    .run();
  return { token, expiresAt };
}

export function setAdminSessionCookie(c: HonoCtx, token: string) {
  c.header(
    "Set-Cookie",
    cookieHeader(ADMIN_SESSION_COOKIE, token, {
      maxAge: ADMIN_SESSION_HOURS * 60 * 60,
      path: "/",
      sameSite: "Strict",
    }),
    { append: true },
  );
}

export function clearAdminSessionCookie(c: HonoCtx) {
  c.header("Set-Cookie", clearCookie(ADMIN_SESSION_COOKIE), { append: true });
}

export async function writeAudit(
  env: Env,
  opts: {
    adminId?: string | null;
    adminUsername?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    outcome: string;
    details?: Record<string, unknown>;
    ipHint?: string;
  },
) {
  await env.DB.prepare(
    `INSERT INTO admin_audit_log (id, timestamp, admin_id, admin_username, action, target_type, target_id, outcome, details_json, ip_hint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId(),
      nowIso(),
      opts.adminId ?? null,
      opts.adminUsername ?? null,
      opts.action,
      opts.targetType ?? null,
      opts.targetId ?? null,
      opts.outcome,
      opts.details ? JSON.stringify(opts.details) : null,
      opts.ipHint ?? null,
    )
    .run();
}
