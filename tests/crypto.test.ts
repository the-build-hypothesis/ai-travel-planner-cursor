import { describe, expect, it } from "vitest";
import {
  hashPassword,
  normalizeEmail,
  sha256Hex,
  verifyPassword,
} from "../src/shared/crypto";
import { estimateLlmCost, estimatePlacesCost } from "../src/shared/pricing";
import { ItinerarySchema } from "../src/shared/types";

describe("crypto", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("normalizes emails case-insensitively", () => {
    expect(normalizeEmail("  Foo@Example.COM ")).toBe("foo@example.com");
  });

  it("hashes tokens with sha256", async () => {
    const a = await sha256Hex("token");
    const b = await sha256Hex("token");
    const c = await sha256Hex("other");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });
});

describe("pricing", () => {
  it("estimates LLM costs from tokens", () => {
    const { cost, pricing } = estimateLlmCost("openai", "gpt-4o-mini", 1_000_000, 1_000_000);
    expect(pricing.version).toBeTruthy();
    expect(cost).toBeCloseTo(0.15 + 0.6, 6);
  });

  it("estimates Places costs by endpoint", () => {
    const a = estimatePlacesCost("places.googleapis.com/v1/places:searchText", 2);
    const b = estimatePlacesCost("maps.googleapis.com/maps/api/geocode", 1);
    expect(a.cost).toBeCloseTo(0.064, 6);
    expect(b.cost).toBeCloseTo(0.005, 6);
    expect(a.pricing.sku).not.toBe(b.pricing.sku);
  });
});

describe("itinerary schema", () => {
  it("validates structured itineraries", () => {
    const parsed = ItinerarySchema.parse({
      version: 1,
      destination: "Tokyo",
      days: [
        {
          day: 1,
          title: "Arrival",
          activities: [
            {
              id: "a1",
              name: "Sushi lunch",
              estimatedCost: 40,
              costIsEstimate: true,
            },
          ],
        },
      ],
    });
    expect(parsed.days[0].activities[0].name).toBe("Sushi lunch");
  });

  it("rejects invalid day numbers", () => {
    expect(() =>
      ItinerarySchema.parse({
        version: 1,
        days: [{ day: 0, activities: [] }],
      }),
    ).toThrow();
  });
});
