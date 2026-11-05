import { Hono } from "hono";
import { ensureBootstrapAdmin } from "./bootstrap";
import type { Env } from "./env";
import { admin } from "./routes/admin";
import { api } from "./routes/api";
import type { AppVariables } from "./util";
import { randomId } from "../shared/crypto";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use("*", async (c, next) => {
  c.set("requestId", randomId());
  c.header("X-Request-Id", c.get("requestId"));
  // Basic security headers
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  await next();
});

app.get("/api/healthz", (c) => c.json({ ok: true }));

app.route("/api", api);
app.route("/admin/api", admin);

app.onError((err, c) => {
  console.error("Unhandled error", err);
  return c.json(
    { error: { code: "internal_error", message: "Unexpected server error." } },
    500,
  );
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Lazy bootstrap on first request
    try {
      await ensureBootstrapAdmin(env);
    } catch (e) {
      console.error("bootstrap failed", e);
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api") || url.pathname.startsWith("/admin/api")) {
      return app.fetch(request, env, ctx);
    }

    // Serve SPA assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};
