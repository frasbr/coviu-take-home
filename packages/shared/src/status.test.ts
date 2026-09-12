import { describe, expect, it } from "vitest";
import { SessionStatusSchema } from "./status.js";

describe("SessionStatusSchema", () => {
  it("accepts every documented session status", () => {
    for (const status of ["CREATED", "WAITING", "ACTIVE", "DISCONNECTED_GRACE", "ENDED"]) {
      expect(SessionStatusSchema.parse(status)).toBe(status);
    }
  });

  it("rejects an unknown status", () => {
    expect(SessionStatusSchema.safeParse("PENDING").success).toBe(false);
  });
});
