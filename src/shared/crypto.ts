/** Shared crypto helpers usable in Workers and Node tests. */

const textEncoder = new TextEncoder();

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function randomId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return bytesToHex(digest);
}

// Cloudflare Workers WebCrypto rejects PBKDF2 iteration counts above 100_000.
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_LENGTH = 32;

/** Format: pbkdf2$iterations$saltHex$hashHex */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    PBKDF2_LENGTH * 8,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(bits)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = hexToBytes(parts[2]);
  const expected = parts[3];
  if (!Number.isFinite(iterations) || salt.length === 0) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    key,
    PBKDF2_LENGTH * 8,
  );
  const actual = bytesToHex(bits);
  return timingSafeEqual(actual, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addMinutes(iso: string | Date, minutes: number): string {
  const d = typeof iso === "string" ? new Date(iso) : new Date(iso.getTime());
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString();
}

export function addDays(iso: string | Date, days: number): string {
  const d = typeof iso === "string" ? new Date(iso) : new Date(iso.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
