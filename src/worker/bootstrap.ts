import { hashPassword, nowIso, randomId } from "../shared/crypto";
import type { Env } from "./env";

const BOOTSTRAP_FLAG = "bootstrap_admin_created";

/**
 * Ensure the initial admin account exists exactly once.
 * Username: admin / password: admin, must_change_password=1.
 * Never recreate after deletion.
 */
export async function ensureBootstrapAdmin(env: Env): Promise<void> {
  const flag = await env.DB.prepare(`SELECT value FROM app_meta WHERE key = ?`)
    .bind(BOOTSTRAP_FLAG)
    .first<{ value: string }>();
  if (flag?.value === "1") return;

  const existing = await env.DB.prepare(
    `SELECT id FROM administrators WHERE username = ? COLLATE NOCASE`,
  )
    .bind("admin")
    .first();

  const now = nowIso();
  if (!existing) {
    const passwordHash = await hashPassword("admin");
    await env.DB.prepare(
      `INSERT INTO administrators (id, username, password_hash, must_change_password, disabled, is_bootstrap, created_at, updated_at)
       VALUES (?, 'admin', ?, 1, 0, 1, ?, ?)`,
    )
      .bind(randomId(), passwordHash, now, now)
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO app_meta (key, value, updated_at) VALUES (?, '1', ?)
     ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`,
  )
    .bind(BOOTSTRAP_FLAG, now)
    .run();
}
