import type { Env } from "./env";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter backed by KV.
 * key should already be namespaced (e.g. "login:ip:1.2.3.4").
 */
export async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowId = Math.floor(now / windowSeconds);
  const kvKey = `rl:${key}:${windowId}`;
  const resetAt = (windowId + 1) * windowSeconds;

  const currentRaw = await env.RATE_LIMIT.get(kvKey);
  const current = currentRaw ? Number(currentRaw) : 0;
  if (current >= limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  const next = current + 1;
  await env.RATE_LIMIT.put(kvKey, String(next), {
    expirationTtl: windowSeconds + 5,
  });
  return { allowed: true, remaining: Math.max(0, limit - next), resetAt };
}
