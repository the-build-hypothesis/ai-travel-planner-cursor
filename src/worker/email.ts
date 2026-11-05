import type { Env } from "./env";

export interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * Send transactional email via Cloudflare Email Service Worker binding.
 * Uses dynamic import of cloudflare:email when available.
 */
export async function sendTransactionalEmail(
  env: Env,
  opts: { to: string; subject: string; text: string; html?: string },
): Promise<SendResult> {
  const from = env.EMAIL_FROM;
  if (!from) {
    return { ok: false, error: "EMAIL_FROM is not configured" };
  }
  if (!env.EMAIL) {
    return { ok: false, error: "Email binding is unavailable" };
  }

  try {
    // EmailMessage is provided by the Cloudflare runtime via cloudflare:email
    const mod = await import("cloudflare:email");
    const EmailMessage = (mod as { EmailMessage: new (
      from: string,
      to: string,
      raw: string | ReadableStream | ArrayBuffer,
    ) => unknown }).EmailMessage;

    const boundary = `b_${crypto.randomUUID().replace(/-/g, "")}`;
    const html = opts.html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(opts.text)}</pre>`;
    // RFC822-ish raw message for EmailMessage
    const raw = [
      `From: ${from}`,
      `To: ${opts.to}`,
      `Subject: ${sanitizeHeader(opts.subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      opts.text,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const message = new EmailMessage(from, opts.to, raw);
    await env.EMAIL.send(message as never);
    return { ok: true };
  } catch (err) {
    console.error("email send failed", err);
    const message = err instanceof Error ? err.message : "Email send failed";
    return { ok: false, error: message };
  }
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function verificationEmailContent(
  publicUrl: string,
  token: string,
): { subject: string; text: string; html: string } {
  const link = `${publicUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const subject = "Verify your AI Travel Planner email";
  const text = `Welcome to AI Travel Planner.\n\nVerify your email by opening this link:\n${link}\n\nThis link expires in 24 hours. If you did not create an account, ignore this message.`;
  const html = emailLayout(
    "Verify your email",
    `<p>Welcome to AI Travel Planner.</p><p><a href="${link}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`,
  );
  return { subject, text, html };
}

export function passwordResetEmailContent(
  publicUrl: string,
  token: string,
): { subject: string; text: string; html: string } {
  const link = `${publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const subject = "Reset your AI Travel Planner password";
  const text = `We received a password reset request.\n\nReset your password:\n${link}\n\nThis link expires in 30 minutes. If you did not request a reset, ignore this message.`;
  const html = emailLayout(
    "Reset your password",
    `<p>We received a password reset request.</p><p><a href="${link}">Choose a new password</a></p><p>This link expires in 30 minutes.</p>`,
  );
  return { subject, text, html };
}

function emailLayout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:Georgia,serif;background:#0f1c24;color:#f4efe6;padding:32px"><div style="max-width:560px;margin:0 auto;background:#17303a;padding:28px;border-radius:12px"><h1 style="font-family:Georgia,serif;font-weight:600;color:#f0c75e;font-size:22px">${title}</h1>${body}<p style="color:#9bb0b8;font-size:13px;margin-top:28px">AI Travel Planner</p></div></body></html>`;
}
