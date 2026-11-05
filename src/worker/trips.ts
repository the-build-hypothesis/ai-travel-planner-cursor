import { randomId, nowIso } from "../shared/crypto";
import { ItinerarySchema, type Itinerary, type TripPreferences } from "../shared/types";
import type { Env } from "./env";

export interface TripRow {
  id: string;
  owner_type: "user" | "guest";
  owner_user_id: string | null;
  owner_guest_id: string | null;
  title: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  travelers_adults: number | null;
  travelers_children: number | null;
  children_ages: string | null;
  budget_amount: number | null;
  budget_currency: string | null;
  interests: string | null;
  travel_pace: string | null;
  special_requirements: string | null;
  status: string;
  itinerary_json: string | null;
  created_at: string;
  updated_at: string;
}

export function parseItinerary(json: string | null): Itinerary | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    const result = ItinerarySchema.safeParse(parsed);
    return result.success ? result.data : (parsed as Itinerary);
  } catch {
    return null;
  }
}

export function tripToClient(row: TripRow) {
  const itinerary = parseItinerary(row.itinerary_json);
  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    durationDays: row.duration_days,
    travelersAdults: row.travelers_adults,
    travelersChildren: row.travelers_children,
    childrenAges: row.children_ages ? JSON.parse(row.children_ages) : [],
    budgetAmount: row.budget_amount,
    budgetCurrency: row.budget_currency ?? "USD",
    interests: row.interests ? JSON.parse(row.interests) : [],
    travelPace: row.travel_pace,
    specialRequirements: row.special_requirements,
    status: row.status,
    itinerary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerType: row.owner_type,
  };
}

export async function createTrip(
  env: Env,
  owner: { type: "user" | "guest"; userId?: string; guestId?: string },
  prefs: TripPreferences = {},
) {
  const id = randomId();
  const now = nowIso();
  const title =
    prefs.title ||
    (prefs.destination ? `Trip to ${prefs.destination}` : "New trip");
  await env.DB.prepare(
    `INSERT INTO trips (
      id, owner_type, owner_user_id, owner_guest_id, title, destination,
      start_date, end_date, duration_days, travelers_adults, travelers_children,
      children_ages, budget_amount, budget_currency, interests, travel_pace,
      special_requirements, status, itinerary_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)`,
  )
    .bind(
      id,
      owner.type,
      owner.type === "user" ? owner.userId ?? null : null,
      owner.type === "guest" ? owner.guestId ?? null : null,
      title,
      prefs.destination ?? null,
      prefs.startDate ?? null,
      prefs.endDate ?? null,
      prefs.durationDays ?? null,
      prefs.travelersAdults ?? 1,
      prefs.travelersChildren ?? 0,
      prefs.childrenAges ? JSON.stringify(prefs.childrenAges) : null,
      prefs.budgetAmount ?? null,
      prefs.budgetCurrency ?? "USD",
      prefs.interests ? JSON.stringify(prefs.interests) : null,
      prefs.travelPace ?? null,
      prefs.specialRequirements ?? null,
      now,
      now,
    )
    .run();
  return id;
}

export async function getTripForOwner(
  env: Env,
  tripId: string,
  owner: { userId?: string; guestId?: string },
): Promise<TripRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM trips WHERE id = ?`)
    .bind(tripId)
    .first<TripRow>();
  if (!row) return null;
  if (row.owner_type === "user" && row.owner_user_id === owner.userId) return row;
  if (row.owner_type === "guest" && row.owner_guest_id === owner.guestId) return row;
  return null;
}

export async function listTripsForOwner(
  env: Env,
  owner: { userId?: string; guestId?: string },
) {
  let rows: TripRow[] = [];
  if (owner.userId) {
    rows = (
      await env.DB.prepare(
        `SELECT * FROM trips WHERE owner_user_id = ? ORDER BY updated_at DESC`,
      )
        .bind(owner.userId)
        .all<TripRow>()
    ).results;
  } else if (owner.guestId) {
    rows = (
      await env.DB.prepare(
        `SELECT * FROM trips WHERE owner_guest_id = ? ORDER BY updated_at DESC`,
      )
        .bind(owner.guestId)
        .all<TripRow>()
    ).results;
  }
  return rows.map((r) => {
    const itinerary = parseItinerary(r.itinerary_json);
    return {
      id: r.id,
      title: r.title,
      destination: r.destination,
      status: r.status,
      startDate: r.start_date,
      endDate: r.end_date,
      durationDays: r.duration_days,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ownerType: r.owner_type,
      itineraryDayCount: itinerary?.days?.length ?? 0,
    };
  });
}

export async function updateTripFields(
  env: Env,
  tripId: string,
  fields: Partial<{
    title: string;
    destination: string | null;
    start_date: string | null;
    end_date: string | null;
    duration_days: number | null;
    travelers_adults: number | null;
    travelers_children: number | null;
    children_ages: string | null;
    budget_amount: number | null;
    budget_currency: string | null;
    interests: string | null;
    travel_pace: string | null;
    special_requirements: string | null;
    status: string;
    itinerary_json: string | null;
  }>,
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    values.push(v);
  }
  sets.push("updated_at = ?");
  values.push(nowIso());
  values.push(tripId);
  await env.DB.prepare(`UPDATE trips SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function saveItinerary(env: Env, tripId: string, itinerary: Itinerary) {
  const validated = ItinerarySchema.parse({
    ...itinerary,
    version: 1,
    updatedAt: nowIso(),
  });
  await updateTripFields(env, tripId, {
    itinerary_json: JSON.stringify(validated),
    status: "planned",
    destination: validated.destination ?? undefined,
  });
  return validated;
}

export async function addMessage(
  env: Env,
  tripId: string,
  role: "user" | "assistant" | "system",
  content: string,
  metadata?: Record<string, unknown>,
) {
  const id = randomId();
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO messages (id, trip_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, tripId, role, content, metadata ? JSON.stringify(metadata) : null, createdAt)
    .run();
  await env.DB.prepare(`UPDATE trips SET updated_at = ? WHERE id = ?`)
    .bind(createdAt, tripId)
    .run();
  return { id, role, content, createdAt, metadata };
}

export async function listMessages(env: Env, tripId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, role, content, metadata_json, created_at FROM messages WHERE trip_id = ? ORDER BY created_at ASC`,
  )
    .bind(tripId)
    .all<{
      id: string;
      role: "user" | "assistant" | "system";
      content: string;
      metadata_json: string | null;
      created_at: string;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
  }));
}

export async function deleteTrip(env: Env, tripId: string) {
  await env.DB.prepare(`DELETE FROM trips WHERE id = ?`).bind(tripId).run();
}
