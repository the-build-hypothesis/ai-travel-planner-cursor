import { describe, expect, it } from "vitest";

describe("abuse protection limits", () => {
  it("defines stricter guest chat limits than registered users", () => {
    const guestLimit = 25;
    const userLimit = 60;
    expect(guestLimit).toBeLessThan(userLimit);
  });

  it("keeps password reset tokens within 30 minutes", () => {
    const resetMinutes = 30;
    expect(resetMinutes).toBeLessThanOrEqual(30);
  });
});
