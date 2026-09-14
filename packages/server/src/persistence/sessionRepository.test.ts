import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "./schema.js";
import { type SessionRepository, createSqliteSessionRepository } from "./sessionRepository.js";
import type { Session } from "./types.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    providerKey: "provider-key-1",
    patientKey: "patient-key-1",
    status: "CREATED",
    createdAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    endedReason: null,
    ...overrides,
  };
}

let repository: SessionRepository;

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  repository = createSqliteSessionRepository(db);
});

describe("upsertSession / getSession", () => {
  it("returns undefined for a session that does not exist", () => {
    expect(repository.getSession("no-such-id")).toBeUndefined();
  });

  it("inserts a new session and reads it back", () => {
    repository.upsertSession(makeSession());
    expect(repository.getSession("session-1")).toEqual(makeSession());
  });

  it("updates an existing session in place rather than duplicating it", () => {
    repository.upsertSession(makeSession());
    repository.upsertSession(
      makeSession({
        status: "ENDED",
        endedAt: "2026-01-01T01:00:00.000Z",
        endedReason: "provider_ended",
      }),
    );

    expect(repository.getSession("session-1")).toEqual(
      makeSession({
        status: "ENDED",
        endedAt: "2026-01-01T01:00:00.000Z",
        endedReason: "provider_ended",
      }),
    );
    expect(repository.listOpenSessions()).toHaveLength(0);
  });
});

describe("getSessionByKey", () => {
  it("returns undefined for a key that matches no session", () => {
    expect(repository.getSessionByKey("no-such-key")).toBeUndefined();
  });

  it("finds a session by its provider key", () => {
    repository.upsertSession(makeSession());
    expect(repository.getSessionByKey("provider-key-1")).toEqual(makeSession());
  });

  it("finds a session by its patient key", () => {
    repository.upsertSession(makeSession());
    expect(repository.getSessionByKey("patient-key-1")).toEqual(makeSession());
  });
});

describe("listOpenSessions", () => {
  it("returns every session whose status is not ENDED", () => {
    repository.upsertSession(makeSession({ id: "s1", status: "CREATED" }));
    repository.upsertSession(
      makeSession({ id: "s2", providerKey: "pk2", patientKey: "pak2", status: "ACTIVE" }),
    );
    repository.upsertSession(
      makeSession({
        id: "s3",
        providerKey: "pk3",
        patientKey: "pak3",
        status: "ENDED",
        endedAt: "2026-01-01T01:00:00.000Z",
        endedReason: "timeout",
      }),
    );

    const open = repository.listOpenSessions().map((session) => session.id);
    expect(open.sort()).toEqual(["s1", "s2"]);
  });

  it("returns an empty array when there are no sessions", () => {
    expect(repository.listOpenSessions()).toEqual([]);
  });
});

describe("recordEvent / getEvents", () => {
  it("returns an empty array for a session with no events", () => {
    repository.upsertSession(makeSession());
    expect(repository.getEvents("session-1")).toEqual([]);
  });

  it("records an event with no data as null", () => {
    repository.upsertSession(makeSession());
    repository.recordEvent("session-1", "session_created");

    const events = repository.getEvents("session-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "session_created", data: null });
  });

  it("records an event with data and parses it back from JSON", () => {
    repository.upsertSession(makeSession());
    repository.recordEvent("session-1", "session_ended", {
      reason: "provider_ended",
    });

    const events = repository.getEvents("session-1");
    expect(events[0]?.data).toEqual({ reason: "provider_ended" });
  });

  it("returns events in id order, oldest first", () => {
    repository.upsertSession(makeSession());
    repository.recordEvent("session-1", "session_created");
    repository.recordEvent("session-1", "patient_joined_waiting_room");
    repository.recordEvent("session-1", "patient_admitted");

    const types = repository.getEvents("session-1").map((event) => event.type);
    expect(types).toEqual(["session_created", "patient_joined_waiting_room", "patient_admitted"]);
  });

  it("rejects an event for a session_id that has no sessions row", () => {
    expect(() => repository.recordEvent("no-such-session", "session_created")).toThrow();
  });

  it("only returns events for the requested session", () => {
    repository.upsertSession(makeSession({ id: "s1" }));
    repository.upsertSession(makeSession({ id: "s2", providerKey: "pk2", patientKey: "pak2" }));
    repository.recordEvent("s1", "session_created");
    repository.recordEvent("s2", "session_created");

    expect(repository.getEvents("s1")).toHaveLength(1);
    expect(repository.getEvents("s2")).toHaveLength(1);
  });
});
