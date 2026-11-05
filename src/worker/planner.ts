import { randomId } from "../shared/crypto";
import { ItinerarySchema, type Itinerary } from "../shared/types";
import type { Env } from "./env";
import { LlmError, runChat } from "./llm";
import { geocodeDestination, searchPlaces } from "./places";
import {
  addMessage,
  listMessages,
  parseItinerary,
  saveItinerary,
  tripToClient,
  updateTripFields,
  type TripRow,
} from "./trips";
import { recordLlmUsage, recordOpsEvent } from "./usage";

const SYSTEM_PROMPT = `You are AI Travel Planner, a polished travel concierge.
Help users plan trips through natural conversation.
Rules:
- Ask clarifying questions when essential details are missing (destination, dates/duration, travelers, budget, interests).
- Generate practical day-by-day itineraries that are geographically and temporally realistic.
- When modifying an itinerary, preserve unrelated days/activities unless the user asks for a full rewrite.
- Clearly distinguish verified facts from estimates/suggestions. Never invent opening hours, prices, or availability as verified facts.
- Costs are estimates unless explicitly verified.
- Keep responses warm, concise, and actionable.
- When you produce or update an itinerary, include a JSON object in a fenced block tagged itinerary-json matching the schema described.
Schema for itinerary-json:
{
  "version": 1,
  "destination": string,
  "summary": string,
  "currency": "USD",
  "estimatedTotalCost": number (optional),
  "costDisclaimer": string,
  "days": [{
    "day": number,
    "date": string (optional),
    "title": string,
    "summary": string,
    "estimatedDailyCost": number (optional),
    "activities": [{
      "id": string,
      "name": string,
      "description": string,
      "category": string,
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "durationMinutes": number,
      "location": { "name": string, "address": string, "lat": number, "lng": number },
      "estimatedCost": number,
      "costIsEstimate": true,
      "notes": string,
      "transportation": string
    }]
  }],
  "tips": [string]
}
Always assign unique activity ids. Prefer 3-5 activities per day unless the user requests otherwise.
Also include a brief conversational reply outside the JSON block.`;

export async function handleChatMessage(
  env: Env,
  trip: TripRow,
  userMessage: string,
): Promise<{
  assistantMessage: { id: string; role: "assistant"; content: string; createdAt: string };
  trip: ReturnType<typeof tripToClient>;
  itineraryUpdated: boolean;
}> {
  await addMessage(env, trip.id, "user", userMessage);

  // Soft-extract preferences from message for trip metadata
  await maybeUpdatePrefsFromMessage(env, trip, userMessage);

  const history = await listMessages(env, trip.id);
  const currentItinerary = parseItinerary(trip.itinerary_json);

  let placeContext = "";
  if (trip.destination && /restaurant|attraction|museum|hotel|near|map|place|food/i.test(userMessage)) {
    const geo = await geocodeDestination(env, trip.destination, {
      ownerType: trip.owner_type,
      ownerUserId: trip.owner_user_id,
      ownerGuestId: trip.owner_guest_id,
      tripId: trip.id,
    });
    const search = await searchPlaces(env, {
      query: `${userMessage} in ${trip.destination}`,
      locationBias: geo ? { lat: geo.lat, lng: geo.lng } : undefined,
      ownerType: trip.owner_type,
      ownerUserId: trip.owner_user_id,
      ownerGuestId: trip.owner_guest_id,
      tripId: trip.id,
    });
    if (search.places.length) {
      placeContext =
        "Verified places from Google Places (treat as verified location data; prices/hours still estimates unless stated):\n" +
        search.places
          .slice(0, 6)
          .map(
            (p) =>
              `- ${p.name}${p.address ? ` @ ${p.address}` : ""}${p.lat != null ? ` (${p.lat},${p.lng})` : ""}${p.rating != null ? ` rating ${p.rating}` : ""}`,
          )
          .join("\n");
      if (search.note) placeContext += `\nNote: ${search.note}`;
    } else if (search.note) {
      placeContext = search.note;
    }
  }

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    {
      role: "system" as const,
      content: `Current trip state:\n${JSON.stringify(
        {
          title: trip.title,
          destination: trip.destination,
          startDate: trip.start_date,
          endDate: trip.end_date,
          durationDays: trip.duration_days,
          adults: trip.travelers_adults,
          children: trip.travelers_children,
          childrenAges: trip.children_ages,
          budget: trip.budget_amount,
          currency: trip.budget_currency,
          interests: trip.interests,
          pace: trip.travel_pace,
          special: trip.special_requirements,
          itinerary: currentItinerary,
        },
        null,
        2,
      )}${placeContext ? `\n\n${placeContext}` : ""}`,
    },
    ...history.slice(-20).map((m) => ({
      role: m.role === "system" ? ("system" as const) : (m.role as "user" | "assistant"),
      content: m.content,
    })),
  ];

  const started = Date.now();
  let content = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let model = env.LLM_MODEL ?? "unknown";
  let status = "ok";
  let errorInfo: string | undefined;

  try {
    const result = await runChat(env, { messages, temperature: 0.7, maxTokens: 4500 });
    content = result.content;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    model = result.model;
  } catch (err) {
    status = "error";
    errorInfo = err instanceof Error ? err.message : "LLM failure";
    await recordOpsEvent(env, {
      kind: "llm_error",
      message: errorInfo,
      tripId: trip.id,
      ownerUserId: trip.owner_user_id,
      ownerGuestId: trip.owner_guest_id,
    });
    if (err instanceof LlmError) {
      content =
        "I couldn't reach the travel planning model right now. Please try again in a moment. Your trip data is safe.";
    } else {
      content = "Something went wrong generating a response. Please try again.";
    }
  }

  await recordLlmUsage(env, {
    model,
    operationType: "trip_chat",
    status,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - started,
    errorInfo,
    ownerType: trip.owner_type,
    ownerUserId: trip.owner_user_id,
    ownerGuestId: trip.owner_guest_id,
    tripId: trip.id,
  });

  let itineraryUpdated = false;
  const extracted = extractItineraryJson(content);
  if (extracted) {
    try {
      const merged = mergeItinerary(currentItinerary, extracted);
      const withIds = ensureActivityIds(merged);
      await saveItinerary(env, trip.id, withIds);
      itineraryUpdated = true;
      // Strip raw JSON fence from user-visible reply for cleaner UI
      content = content.replace(/```itinerary-json[\s\S]*?```/gi, "").trim();
      if (!content) {
        content = `I've updated your itinerary for ${withIds.destination ?? "your trip"}. Review the plan on the right and tell me what you'd like to change.`;
      }
    } catch {
      // keep conversational content; ignore malformed structured block
    }
  }

  const assistantMessage = await addMessage(env, trip.id, "assistant", content, {
    itineraryUpdated,
  });

  const refreshed = await env.DB.prepare(`SELECT * FROM trips WHERE id = ?`)
    .bind(trip.id)
    .first<TripRow>();

  return {
    assistantMessage: {
      id: assistantMessage.id,
      role: "assistant",
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt,
    },
    trip: tripToClient(refreshed!),
    itineraryUpdated,
  };
}

function extractItineraryJson(content: string): Itinerary | null {
  const fence = content.match(/```itinerary-json\s*([\s\S]*?)```/i);
  const raw = fence?.[1]?.trim() ?? null;
  if (!raw) {
    // fallback: look for a top-level JSON object with days
    const start = content.indexOf('{');
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const obj = JSON.parse(content.slice(start, end + 1));
        if (obj && Array.isArray(obj.days)) {
          const parsed = ItinerarySchema.safeParse({ version: 1, ...obj });
          return parsed.success ? parsed.data : null;
        }
      } catch {
        return null;
      }
    }
    return null;
  }
  try {
    const obj = JSON.parse(raw);
    const parsed = ItinerarySchema.safeParse({ version: 1, ...obj });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function mergeItinerary(current: Itinerary | null, incoming: Itinerary): Itinerary {
  if (!current) return incoming;
  // Prefer incoming days that are provided; keep current days not mentioned only if incoming looks like a partial day list with fewer days AND has overlapping day numbers only?
  // Spec: preserve unrelated portions. If incoming has full day coverage (>= current length or includes day 1..n), replace.
  // If incoming has subset of days, merge by day number.
  const incomingDays = new Map(incoming.days.map((d) => [d.day, d]));
  const maxIncoming = Math.max(0, ...incoming.days.map((d) => d.day));
  const looksPartial =
    current.days.length > 0 &&
    incoming.days.length < current.days.length &&
    incoming.days.length <= 3;

  if (looksPartial) {
    const mergedDays = current.days.map((d) => incomingDays.get(d.day) ?? d);
    for (const [day, plan] of incomingDays) {
      if (!mergedDays.some((d) => d.day === day)) mergedDays.push(plan);
    }
    mergedDays.sort((a, b) => a.day - b.day);
    return {
      ...current,
      ...incoming,
      days: mergedDays,
      destination: incoming.destination ?? current.destination,
      summary: incoming.summary ?? current.summary,
    };
  }

  return {
    ...current,
    ...incoming,
    days: incoming.days.length ? incoming.days : current.days,
  };
}

function ensureActivityIds(itinerary: Itinerary): Itinerary {
  return {
    ...itinerary,
    days: itinerary.days.map((day) => ({
      ...day,
      activities: day.activities.map((a) => ({
        ...a,
        id: a.id || randomId(),
        costIsEstimate: a.costIsEstimate !== false,
      })),
    })),
  };
}

async function maybeUpdatePrefsFromMessage(env: Env, trip: TripRow, message: string) {
  const updates: Parameters<typeof updateTripFields>[2] = {};
  const dest = message.match(
    /(?:to|in|for)\s+([A-Z][A-Za-z\s]{2,40}?)(?:\s+in\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|\d)|[.!,]|$)/,
  );
  if (!trip.destination && dest?.[1]) {
    updates.destination = dest[1].trim();
    updates.title = `Trip to ${dest[1].trim()}`;
  }
  const days = message.match(/(\d+)\s*-?\s*day/i);
  if (!trip.duration_days && days) {
    updates.duration_days = Number(days[1]);
  }
  const budget = message.match(/\$\s?([\d,]+)/);
  if (trip.budget_amount == null && budget) {
    updates.budget_amount = Number(budget[1].replace(/,/g, ""));
  }
  if (Object.keys(updates).length) {
    await updateTripFields(env, trip.id, updates);
    Object.assign(trip, {
      destination: updates.destination ?? trip.destination,
      title: updates.title ?? trip.title,
      duration_days: updates.duration_days ?? trip.duration_days,
      budget_amount: updates.budget_amount ?? trip.budget_amount,
    });
  }
}
