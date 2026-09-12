import { describe, expect, it } from "vitest";
import { CreateSessionResponseSchema, GetSessionResponseSchema } from "./http.js";

describe("CreateSessionResponseSchema", () => {
  it("parses a session creation response", () => {
    const value = {
      providerKey: "p-key",
      patientKey: "pa-key",
      providerUrl: "https://example.test/p/p-key",
      patientUrl: "https://example.test/w/pa-key",
    };
    expect(CreateSessionResponseSchema.parse(value)).toEqual(value);
  });
});

describe("GetSessionResponseSchema", () => {
  it("parses a session lookup response", () => {
    expect(GetSessionResponseSchema.parse({ role: "provider", status: "WAITING" })).toEqual({
      role: "provider",
      status: "WAITING",
    });
  });
});
