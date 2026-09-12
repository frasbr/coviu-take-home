import { describe, expect, it } from "vitest";
import { ChatMessageEventDataSchema, EventSchema } from "./events.js";

describe("EventSchema", () => {
  it("parses a session_ended row", () => {
    const row = {
      id: 1,
      type: "session_ended",
      occurredAt: "2026-01-01T00:00:00Z",
      data: { reason: "provider_ended" },
    };
    expect(EventSchema.parse(row)).toEqual(row);
  });

  it("parses a row with no data", () => {
    const row = {
      id: 2,
      type: "patient_joined_waiting_room",
      occurredAt: "2026-01-01T00:00:00Z",
      data: null,
    };
    expect(EventSchema.parse(row)).toEqual(row);
  });
});

describe("ChatMessageEventDataSchema", () => {
  it("parses a chat_message_sent payload", () => {
    expect(ChatMessageEventDataSchema.parse({ sender: "patient", text: "hi" })).toEqual({
      sender: "patient",
      text: "hi",
    });
  });
});
