import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../persistence/schema.js";
import {
  type SessionRepository,
  createSqliteSessionRepository,
} from "../persistence/sessionRepository.js";
import { SessionRegistry } from "../session/sessionRegistry.js";
import { attachEventRecorder } from "./eventRecorder.js";

let repository: SessionRepository;
let registry: SessionRegistry;

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  repository = createSqliteSessionRepository(db);
  registry = new SessionRegistry();
  attachEventRecorder(registry, repository);

  // Mirrors what Services.createSession does: write the first row directly,
  // since only that path holds the keys.
  repository.upsertSession({
    id: "session-1",
    providerKey: "provider-key-1",
    patientKey: "patient-key-1",
    status: "CREATED",
    createdAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    endedReason: null,
  });
  repository.recordEvent("session-1", "session_created");
  registry.createSession("session-1");
});

describe("attachEventRecorder", () => {
  it("records the transition's event and updates the persisted session row", () => {
    registry.patientConnected("session-1");

    const events = repository.getEvents("session-1");
    expect(events.map((event) => event.type)).toEqual([
      "session_created",
      "patient_joined_waiting_room",
    ]);

    const session = repository.getSession("session-1");
    expect(session).toMatchObject({ status: "WAITING" });
  });

  it("preserves the keys it never held, since it reads the existing row before updating it", () => {
    registry.patientConnected("session-1");

    const session = repository.getSession("session-1");
    expect(session).toMatchObject({
      providerKey: "provider-key-1",
      patientKey: "patient-key-1",
    });
  });

  it("records a patient drop and return as rows, leaving the session status alone", () => {
    registry.patientConnected("session-1");
    registry.admit("session-1");

    registry.patientDisconnected("session-1");
    registry.patientReconnected("session-1");

    const events = repository.getEvents("session-1");
    expect(events.map((event) => event.type)).toEqual([
      "session_created",
      "patient_joined_waiting_room",
      "patient_admitted",
      "patient_disconnected",
      "patient_reconnected",
    ]);

    const session = repository.getSession("session-1");
    expect(session).toMatchObject({ status: "ACTIVE", endedAt: null, endedReason: null });
  });

  it("records the reason and sets endedAt and endedReason on a session_ended transition", () => {
    registry.endSession("session-1");

    const events = repository.getEvents("session-1");
    expect(events.at(-1)).toMatchObject({
      type: "session_ended",
      data: { reason: "provider_ended" },
    });

    const session = repository.getSession("session-1");
    expect(session).toMatchObject({
      status: "ENDED",
      endedReason: "provider_ended",
      endedAt: expect.any(String),
    });
  });
});
