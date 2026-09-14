// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredTranscript, writeStoredTranscript } from "./chatStorage.js";
import type { ChatMessage } from "./mergeTranscript.js";

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    sender: "provider",
    text: "hi",
    sentAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("readStoredTranscript", () => {
  it("returns an empty array when nothing is stored", () => {
    expect(readStoredTranscript("session-1")).toEqual([]);
  });

  it("returns a transcript written for that session key", () => {
    const transcript = [message({ id: "1" })];
    writeStoredTranscript("session-1", transcript);

    expect(readStoredTranscript("session-1")).toEqual(transcript);
  });

  it("keeps transcripts for different session keys separate", () => {
    writeStoredTranscript("session-1", [message({ id: "1" })]);
    writeStoredTranscript("session-2", [message({ id: "2" })]);

    expect(readStoredTranscript("session-1").map((m) => m.id)).toEqual(["1"]);
    expect(readStoredTranscript("session-2").map((m) => m.id)).toEqual(["2"]);
  });

  it("returns an empty array for unparseable JSON rather than throwing", () => {
    sessionStorage.setItem("coviu:chat:session-1", "not json");

    expect(readStoredTranscript("session-1")).toEqual([]);
  });

  it("returns an empty array for a value that is not a transcript", () => {
    sessionStorage.setItem("coviu:chat:session-1", JSON.stringify({ not: "a transcript" }));
    expect(readStoredTranscript("session-1")).toEqual([]);

    sessionStorage.setItem("coviu:chat:session-1", JSON.stringify([{ id: "1" }]));
    expect(readStoredTranscript("session-1")).toEqual([]);
  });

  it("returns an empty array when sessionStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(readStoredTranscript("session-1")).toEqual([]);
  });
});

describe("writeStoredTranscript", () => {
  it("silently does nothing when sessionStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => writeStoredTranscript("session-1", [message({ id: "1" })])).not.toThrow();
  });
});
