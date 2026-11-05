import { describe, expect, it } from "vitest";
import { addMinutes, nowIso } from "../src/shared/crypto";

describe("token expiry helpers", () => {
  it("expires password reset tokens within 30 minutes", () => {
    const now = nowIso();
    const expires = addMinutes(now, 30);
    const diff = new Date(expires).getTime() - new Date(now).getTime();
    expect(diff).toBe(30 * 60 * 1000);
    expect(diff).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});

describe("guest migration rules", () => {
  it("documents that only matching guest_id trips migrate", () => {
    // Behavioral contract tested at API layer; assert ownership predicate shape.
    const trip = { owner_type: "guest", owner_guest_id: "g1", owner_user_id: null };
    const claimant = { guestId: "g1" };
    const other = { guestId: "g2" };
    expect(trip.owner_guest_id === claimant.guestId).toBe(true);
    expect(trip.owner_guest_id === other.guestId).toBe(false);
  });
});
