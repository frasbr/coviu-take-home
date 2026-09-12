import { describe, expect, it } from "vitest";
import { SessionStatePayloadSchema } from "./socket.js";

describe("SessionStatePayloadSchema", () => {
  it("requires reason to be null or a valid ended reason", () => {
    const base = {
      state: "ACTIVE",
      since: "2026-01-01T00:00:00Z",
      presence: { provider: true, patient: true },
    };
    expect(SessionStatePayloadSchema.parse({ ...base, reason: null }).reason).toBeNull();
    expect(SessionStatePayloadSchema.safeParse({ ...base, reason: "bogus" }).success).toBe(false);
  });
});
