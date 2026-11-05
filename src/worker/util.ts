import type { Context } from "hono";
import type { Env } from "./env";

export type AppVariables = {
  userId?: string;
  guestId?: string;
  adminId?: string;
  adminUsername?: string;
  mustChangePassword?: boolean;
  requestId: string;
};

export type HonoCtx = Context<{ Bindings: Env; Variables: AppVariables }>;

export function jsonError(
  c: HonoCtx,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return c.json({ error: { code, message, ...extra } }, status as 400);
}

export function getPublicUrl(c: HonoCtx): string {
  if (c.env.APP_PUBLIC_URL) return c.env.APP_PUBLIC_URL.replace(/\/$/, "");
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

export function clientIp(c: HonoCtx): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookieHeader(
  name: string,
  value: string,
  opts: {
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
    path?: string;
  } = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
    `SameSite=${opts.sameSite ?? "Lax"}`,
  ];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.secure !== false) parts.push("Secure");
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

export function clearCookie(name: string, path = "/"): string {
  return cookieHeader(name, "", { maxAge: 0, path });
}

export async function readJson<T>(c: HonoCtx): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}
