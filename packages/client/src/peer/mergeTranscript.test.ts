import { describe, expect, it } from "vitest";
import { mergeTranscript } from "./mergeTranscript.js";
import type { ChatMessage } from "./mergeTranscript.js";

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    sender: "provider",
    text: "hi",
    sentAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeTranscript", () => {
  it("returns an empty array when both sides are empty", () => {
    expect(mergeTranscript([], [])).toEqual([]);
  });

  it("returns the other side unchanged when one side is empty", () => {
    const a = [message({ id: "1", sentAt: "2026-01-01T00:00:00.000Z" })];
    expect(mergeTranscript(a, [])).toEqual(a);
    expect(mergeTranscript([], a)).toEqual(a);
  });

  it("merges disjoint sets and orders the result by sentAt", () => {
    const early = message({ id: "1", sentAt: "2026-01-01T00:00:00.000Z" });
    const late = message({ id: "2", sentAt: "2026-01-01T00:05:00.000Z" });

    expect(mergeTranscript([late], [early])).toEqual([early, late]);
    expect(mergeTranscript([early], [late])).toEqual([early, late]);
  });

  it("deduplicates a message present on both sides by id", () => {
    const shared = message({ id: "1", sentAt: "2026-01-01T00:00:00.000Z" });

    expect(mergeTranscript([shared], [shared])).toEqual([shared]);
  });

  it("returns an identical transcript unchanged when merged with itself", () => {
    const transcript = [
      message({ id: "1", sentAt: "2026-01-01T00:00:00.000Z" }),
      message({ id: "2", sentAt: "2026-01-01T00:05:00.000Z" }),
    ];

    expect(mergeTranscript(transcript, transcript)).toEqual(transcript);
  });

  it("orders out-of-order arrivals correctly regardless of side", () => {
    const first = message({ id: "1", sentAt: "2026-01-01T00:00:00.000Z" });
    const second = message({ id: "2", sentAt: "2026-01-01T00:01:00.000Z" });
    const third = message({ id: "3", sentAt: "2026-01-01T00:02:00.000Z" });

    expect(mergeTranscript([third, first], [second])).toEqual([first, second, third]);
  });

  it("produces the same ordered array whichever side is passed first", () => {
    const a = [
      message({ id: "1", sentAt: "2026-01-01T00:00:00.000Z" }),
      message({ id: "3", sentAt: "2026-01-01T00:02:00.000Z" }),
    ];
    const b = [message({ id: "2", sentAt: "2026-01-01T00:01:00.000Z" })];

    expect(mergeTranscript(a, b)).toEqual(mergeTranscript(b, a));
  });

  it("breaks a tied sentAt by id so the order is stable", () => {
    const sameTime = "2026-01-01T00:00:00.000Z";
    const one = message({ id: "b", sentAt: sameTime });
    const two = message({ id: "a", sentAt: sameTime });

    const merged = mergeTranscript([one], [two]);

    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
    expect(mergeTranscript([two], [one]).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("keeps every message from both sides once each when the sets overlap partially", () => {
    const shared = message({ id: "1", sentAt: "2026-01-01T00:00:00.000Z" });
    const onlyA = message({ id: "2", sentAt: "2026-01-01T00:01:00.000Z" });
    const onlyB = message({ id: "3", sentAt: "2026-01-01T00:02:00.000Z" });

    const merged = mergeTranscript([shared, onlyA], [shared, onlyB]);

    expect(merged).toEqual([shared, onlyA, onlyB]);
  });
});
