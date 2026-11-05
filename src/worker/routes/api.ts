import { Hono } from "hono";
import { z } from "zod";
import {
  addMinutes,
  hashPassword,
  nowIso,
  randomId,
  sha256Hex,
  verifyPassword,
} from "../../shared/crypto";
import { TripPreferencesSchema } from "../../shared/types";
import {
  clearSessionCookie,
  ensureGuest,
  getPublicUser,
  issueVerificationEmail,
  loadUserSession,
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPasswordWithToken,
  revokeUserSession,
  setSessionCookie,
  USER_SESSION_COOKIE,
  verifyEmailToken,
} from "../auth";
import type { Env } from "../env";
import { getConfiguredProvider } from "../llm";
import { handleChatMessage } from "../planner";
import { geocodeDestination, searchPlaces } from "../places";
import { checkRateLimit } from "../rate-limit";
import {
  createTrip,
  deleteTrip,
  getTripForOwner,
  listMessages,
  listTripsForOwner,
  parseItinerary,
  saveItinerary,
  tripToClient,
  updateTripFields,
} from "../trips";
import type { AppVariables, HonoCtx } from "../util";
import {
  clientIp,
  getPublicUrl,
  jsonError,
  parseCookies,
  readJson,
} from "../util";

const api = new Hono<{ Bindings: Env; Variables: AppVariables }>();

api.use("*", async (c, next) => {
  await ensureGuest(c);
  await loadUserSession(c);
  await next();
});

api.get("/health", (c) =>
  c.json({
    ok: true,
    app: c.env.APP_NAME ?? "AI Travel Planner",
    time: nowIso(),
  }),
);

api.get("/config", (c) => {
  let llmProvider: string | null = c.env.LLM_PROVIDER ?? null;
  let llmModel: string | null = c.env.LLM_MODEL ?? null;
  let llmConfigured = false;
  try {
    const cfg = getConfiguredProvider(c.env);
    llmProvider = cfg.provider.name;
    llmModel = cfg.model;
    llmConfigured = !!c.env.OPENAI_API_KEY;
  } catch {
    llmConfigured = false;
  }
  return c.json({
    publicUrl: getPublicUrl(c),
    mapsEnabled: !!c.env.GOOGLE_MAPS_API_KEY,
    // Client Maps JS needs a browser key; we proxy places server-side.
    // Expose a boolean only — never the secret.
    emailConfigured: !!c.env.EMAIL_FROM && !!c.env.EMAIL,
    llmProvider,
    llmModel,
    llmConfigured,
  });
});

api.get("/me", async (c) => {
  const userId = c.get("userId");
  const guestId = c.get("guestId");
  if (!userId) {
    return c.json({ user: null, guestId });
  }
  const user = await getPublicUser(c.env, userId);
  return c.json({ user, guestId });
});

api.post("/auth/register", async (c) => {
  const body = await readJson<{ email?: string; password?: string; displayName?: string }>(c);
  if (!body?.email || !body?.password) {
    return jsonError(c, 400, "invalid_body", "Email and password are required.");
  }
  try {
    const result = await registerUser(c, {
      email: body.email,
      password: body.password,
      displayName: body.displayName,
    });
    if (!result.ok) return jsonError(c, result.status, result.code, result.message);

    const { createUserSession } = await import("../auth");
    const session = await createUserSession(c.env, result.userId);
    setSessionCookie(c, session.token);
    const user = await getPublicUser(c.env, result.userId);
    return c.json({ user, message: "Account created. Check your email to verify." }, 201);
  } catch (err) {
    console.error("register failed", err);
    return jsonError(
      c,
      500,
      "register_failed",
      err instanceof Error ? err.message : "Registration failed.",
    );
  }
});

api.post("/auth/login", async (c) => {
  const body = await readJson<{ email?: string; password?: string }>(c);
  if (!body?.email || !body?.password) {
    return jsonError(c, 400, "invalid_body", "Email and password are required.");
  }
  const result = await loginUser(c, body.email, body.password);
  if (!result.ok) return jsonError(c, result.status, result.code, result.message);
  setSessionCookie(c, result.token);
  const user = await getPublicUser(c.env, result.userId);
  return c.json({ user });
});

api.post("/auth/logout", async (c) => {
  const cookies = parseCookies(c.req.header("cookie"));
  const token = cookies[USER_SESSION_COOKIE];
  if (token) await revokeUserSession(c.env, token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

api.post("/auth/verify-email", async (c) => {
  const body = await readJson<{ token?: string }>(c);
  if (!body?.token) return jsonError(c, 400, "invalid_body", "Token required.");
  const result = await verifyEmailToken(c.env, body.token);
  return c.json(result, result.ok ? 200 : 400);
});

api.post("/auth/resend-verification", async (c) => {
  const userId = c.get("userId");
  if (!userId) return jsonError(c, 401, "unauthorized", "Sign in required.");
  const rl = await checkRateLimit(c.env, `resendverify:${userId}`, 3, 3600);
  if (!rl.allowed) return jsonError(c, 429, "rate_limited", "Too many requests.");
  const user = await getPublicUser(c.env, userId);
  if (!user) return jsonError(c, 404, "not_found", "User not found.");
  if (user.emailVerified) return c.json({ ok: true, message: "Already verified." });
  const send = await issueVerificationEmail(c.env, userId, user.email, getPublicUrl(c));
  if (!send.ok) {
    return jsonError(c, 503, "email_failed", "Unable to send verification email.", {
      detail: send.error,
    });
  }
  return c.json({ ok: true, message: "Verification email sent." });
});

api.post("/auth/forgot-password", async (c) => {
  const body = await readJson<{ email?: string }>(c);
  if (!body?.email) return jsonError(c, 400, "invalid_body", "Email required.");
  const result = await requestPasswordReset(c, body.email);
  if (!result.ok && result.emailError) {
    return jsonError(c, 503, "email_failed", result.message);
  }
  return c.json({ ok: true, message: result.message });
});

api.post("/auth/reset-password", async (c) => {
  const body = await readJson<{ token?: string; password?: string }>(c);
  if (!body?.token || !body?.password) {
    return jsonError(c, 400, "invalid_body", "Token and password required.");
  }
  const result = await resetPasswordWithToken(c.env, body.token, body.password);
  return c.json(result, result.ok ? 200 : 400);
});

api.patch("/account", async (c) => {
  const userId = c.get("userId");
  if (!userId) return jsonError(c, 401, "unauthorized", "Sign in required.");
  const body = await readJson<{ displayName?: string }>(c);
  if (body?.displayName != null) {
    await c.env.DB.prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`)
      .bind(body.displayName, nowIso(), userId)
      .run();
  }
  const user = await getPublicUser(c.env, userId);
  return c.json({ user });
});

api.post("/account/change-password", async (c) => {
  const userId = c.get("userId");
  if (!userId) return jsonError(c, 401, "unauthorized", "Sign in required.");
  const body = await readJson<{ currentPassword?: string; newPassword?: string }>(c);
  if (!body?.currentPassword || !body?.newPassword) {
    return jsonError(c, 400, "invalid_body", "Current and new password required.");
  }
  if (body.newPassword.length < 8) {
    return jsonError(c, 400, "weak_password", "Password must be at least 8 characters.");
  }
  const row = await c.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
    return jsonError(c, 401, "invalid_credentials", "Current password is incorrect.");
  }
  const passwordHash = await hashPassword(body.newPassword);
  await c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
    .bind(passwordHash, nowIso(), userId)
    .run();
  return c.json({ ok: true });
});

function ownerFromCtx(c: HonoCtx) {
  const userId = c.get("userId");
  const guestId = c.get("guestId");
  if (userId) return { type: "user" as const, userId, guestId };
  return { type: "guest" as const, guestId: guestId!, userId: undefined };
}

api.get("/trips", async (c) => {
  const owner = ownerFromCtx(c);
  const trips = await listTripsForOwner(c.env, {
    userId: owner.userId,
    guestId: owner.type === "guest" ? owner.guestId : undefined,
  });
  return c.json({ trips });
});

api.post("/trips", async (c) => {
  const body = (await readJson(c)) ?? {};
  const prefs = TripPreferencesSchema.safeParse(body);
  if (!prefs.success) return jsonError(c, 400, "invalid_body", "Invalid trip preferences.");
  const owner = ownerFromCtx(c);
  const id = await createTrip(
    c.env,
    owner.type === "user"
      ? { type: "user", userId: owner.userId }
      : { type: "guest", guestId: owner.guestId },
    prefs.data,
  );
  const trip = await getTripForOwner(c.env, id, {
    userId: owner.userId,
    guestId: owner.guestId,
  });
  return c.json({ trip: tripToClient(trip!) }, 201);
});

api.get("/trips/:id", async (c) => {
  const owner = ownerFromCtx(c);
  const trip = await getTripForOwner(c.env, c.req.param("id"), {
    userId: owner.userId,
    guestId: owner.guestId,
  });
  if (!trip) return jsonError(c, 404, "not_found", "Trip not found.");
  const messages = await listMessages(c.env, trip.id);
  return c.json({ trip: tripToClient(trip), messages });
});

api.patch("/trips/:id", async (c) => {
  const owner = ownerFromCtx(c);
  const trip = await getTripForOwner(c.env, c.req.param("id"), {
    userId: owner.userId,
    guestId: owner.guestId,
  });
  if (!trip) return jsonError(c, 404, "not_found", "Trip not found.");
  const body = TripPreferencesSchema.safeParse((await readJson(c)) ?? {});
  if (!body.success) return jsonError(c, 400, "invalid_body", "Invalid trip update.");
  const p = body.data;
  await updateTripFields(c.env, trip.id, {
    title: p.title,
    destination: p.destination,
    start_date: p.startDate,
    end_date: p.endDate,
    duration_days: p.durationDays,
    travelers_adults: p.travelersAdults,
    travelers_children: p.travelersChildren,
    children_ages: p.childrenAges ? JSON.stringify(p.childrenAges) : undefined,
    budget_amount: p.budgetAmount,
    budget_currency: p.budgetCurrency,
    interests: p.interests ? JSON.stringify(p.interests) : undefined,
    travel_pace: p.travelPace,
    special_requirements: p.specialRequirements,
  });
  const updated = await getTripForOwner(c.env, trip.id, {
    userId: owner.userId,
    guestId: owner.guestId,
  });
  return c.json({ trip: tripToClient(updated!) });
});

api.delete("/trips/:id", async (c) => {
  const owner = ownerFromCtx(c);
  const trip = await getTripForOwner(c.env, c.req.param("id"), {
    userId: owner.userId,
    guestId: owner.guestId,
  });
  if (!trip) return jsonError(c, 404, "not_found", "Trip not found.");
  await deleteTrip(c.env, trip.id);
  return c.json({ ok: true });
});

api.post("/trips/:id/chat", async (c) => {
  const owner = ownerFromCtx(c);
  const rlKey = owner.userId
    ? `chat:user:${owner.userId}`
    : `chat:guest:${owner.guestId}`;
  const limit = owner.userId ? 60 : 25;
  const rl = await checkRateLimit(c.env, rlKey, limit, 3600);
  if (!rl.allowed) {
    return jsonError(c, 429, "rate_limited", "Chat rate limit reached. Please wait and try again.");
  }

  const trip = await getTripForOwner(c.env, c.req.param("id"), {
    userId: owner.userId,
    guestId: owner.guestId,
  });
  if (!trip) return jsonError(c, 404, "not_found", "Trip not found.");

  const body = await readJson<{ message?: string }>(c);
  if (!body?.message?.trim()) {
    return jsonError(c, 400, "invalid_body", "Message required.");
  }
  if (body.message.length > 8000) {
    return jsonError(c, 400, "too_large", "Message too long.");
  }

  const result = await handleChatMessage(c.env, trip, body.message.trim());
  return c.json(result);
});

api.put("/trips/:id/itinerary", async (c) => {
  const owner = ownerFromCtx(c);
  const trip = await getTripForOwner(c.env, c.req.param("id"), {
    userId: owner.userId,
    guestId: owner.guestId,
  });
  if (!trip) return jsonError(c, 404, "not_found", "Trip not found.");
  const body = await readJson(c);
  try {
    const saved = await saveItinerary(c.env, trip.id, body as never);
    return c.json({ itinerary: saved });
  } catch {
    return jsonError(c, 400, "invalid_itinerary", "Itinerary failed validation.");
  }
});

api.patch("/trips/:id/itinerary/activities", async (c) => {
  const owner = ownerFromCtx(c);
  const trip = await getTripForOwner(c.env, c.req.param("id"), {
    userId: owner.userId,
    guestId: owner.guestId,
  });
  if (!trip) return jsonError(c, 404, "not_found", "Trip not found.");
  const itinerary = parseItinerary(trip.itinerary_json);
  if (!itinerary) return jsonError(c, 400, "no_itinerary", "No itinerary to edit.");

  const body = z
    .object({
      action: z.enum(["remove", "reorder", "replace"]),
      day: z.number().int().positive(),
      activityId: z.string().optional(),
      activityIds: z.array(z.string()).optional(),
      activity: z.record(z.string(), z.unknown()).optional(),
    })
    .safeParse(await readJson(c));
  if (!body.success) return jsonError(c, 400, "invalid_body", "Invalid edit.");

  const day = itinerary.days.find((d) => d.day === body.data.day);
  if (!day) return jsonError(c, 404, "day_not_found", "Day not found.");

  if (body.data.action === "remove" && body.data.activityId) {
    day.activities = day.activities.filter((a) => a.id !== body.data.activityId);
  } else if (body.data.action === "reorder" && body.data.activityIds) {
    const map = new Map(day.activities.map((a) => [a.id, a]));
    day.activities = body.data.activityIds
      .map((id) => map.get(id))
      .filter(Boolean) as typeof day.activities;
  } else if (body.data.action === "replace" && body.data.activityId && body.data.activity) {
    day.activities = day.activities.map((a) =>
      a.id === body.data.activityId ? ({ ...a, ...body.data.activity, id: a.id } as typeof a) : a,
    );
  }

  const saved = await saveItinerary(c.env, trip.id, itinerary);
  return c.json({ itinerary: saved });
});

api.get("/places/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return jsonError(c, 400, "invalid_query", "q required");
  const owner = ownerFromCtx(c);
  const rl = await checkRateLimit(
    c.env,
    `places:${owner.userId ?? owner.guestId}`,
    owner.userId ? 40 : 15,
    3600,
  );
  if (!rl.allowed) return jsonError(c, 429, "rate_limited", "Places rate limit reached.");
  const result = await searchPlaces(c.env, {
    query: q,
    ownerType: owner.type,
    ownerUserId: owner.userId,
    ownerGuestId: owner.guestId,
  });
  return c.json(result);
});

api.get("/places/geocode", async (c) => {
  const q = c.req.query("q");
  if (!q) return jsonError(c, 400, "invalid_query", "q required");
  const owner = ownerFromCtx(c);
  const result = await geocodeDestination(c.env, q, {
    ownerType: owner.type,
    ownerUserId: owner.userId,
    ownerGuestId: owner.guestId,
  });
  return c.json({ result });
});

// Maps JS key proxy for client map tiles only when same key is usable — prefer Leaflet OSM.
api.get("/maps/client-config", (c) => {
  return c.json({
    provider: "leaflet-osm",
    googleConfiguredServerSide: !!c.env.GOOGLE_MAPS_API_KEY,
  });
});

export { api };
