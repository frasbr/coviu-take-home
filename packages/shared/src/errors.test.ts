import { describe, expect, it } from "vitest";
import { ErrorCodeSchema } from "./errors.js";

describe("ErrorCodeSchema", () => {
  it("accepts every documented error code", () => {
    for (const code of [
      "unknown_key",
      "session_ended",
      "role_already_connected",
      "invalid_message",
      "not_allowed_in_state",
    ]) {
      expect(ErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
