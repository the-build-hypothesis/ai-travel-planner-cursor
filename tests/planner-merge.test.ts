import { describe, expect, it } from "vitest";
import { ItinerarySchema, type Itinerary } from "../src/shared/types";

/** Mirror of merge logic used by planner for unit coverage. */
function mergeItinerary(current: Itinerary | null, incoming: Itinerary): Itinerary {
  if (!current) return incoming;
  const incomingDays = new Map(incoming.days.map((d) => [d.day, d]));
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

function day(n: number, title: string): Itinerary["days"][number] {
  return {
    day: n,
    title,
    activities: [{ id: `d${n}`, name: title, costIsEstimate: true }],
  };
}

describe("itinerary merge", () => {
  it("preserves unrelated days on partial updates", () => {
    const current = ItinerarySchema.parse({
      version: 1,
      destination: "Tokyo",
      days: [day(1, "A"), day(2, "B"), day(3, "C"), day(4, "D"), day(5, "E")],
    });
    const incoming = ItinerarySchema.parse({
      version: 1,
      days: [day(3, "C-cheaper")],
    });
    const merged = mergeItinerary(current, incoming);
    expect(merged.days).toHaveLength(5);
    expect(merged.days.find((d) => d.day === 3)?.title).toBe("C-cheaper");
    expect(merged.days.find((d) => d.day === 1)?.title).toBe("A");
    expect(merged.days.find((d) => d.day === 5)?.title).toBe("E");
  });

  it("replaces full itineraries", () => {
    const current = ItinerarySchema.parse({
      version: 1,
      days: [day(1, "A"), day(2, "B")],
    });
    const incoming = ItinerarySchema.parse({
      version: 1,
      destination: "Kyoto",
      days: [day(1, "X"), day(2, "Y"), day(3, "Z")],
    });
    const merged = mergeItinerary(current, incoming);
    expect(merged.destination).toBe("Kyoto");
    expect(merged.days.map((d) => d.title)).toEqual(["X", "Y", "Z"]);
  });
});
