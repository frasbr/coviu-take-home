import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../persistence/schema.js";
import {
  type SessionRepository,
  createSqliteSessionRepository,
} from "../persistence/sessionRepository.js";
import { SessionRegistry } from "../session/sessionRegistry.js";
import { createSessionService } from "./sessionService.js";

let repository: SessionRepository;
let registry: SessionRegistry;
let services: ReturnType<typeof createSessionService>;

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  repository = createSqliteSessionRepository(db);
  registry = new SessionRegistry();
  services = createSessionService(repository, registry, "https://example.test");
});

describe("createSession", () => {
  it("returns the two keys and the two links, and no sessionId", () => {
    const result = services.createSession();

    expect(result.providerKey).toBeTruthy();
    expect(result.patientKey).toBeTruthy();
    expect(result.providerUrl).toBe(`https://example.test/p/${result.providerKey}`);
    expect(result.patientUrl).toBe(`https://example.test/w/${result.patientKey}`);
    expect(result).not.toHaveProperty("sessionId");
  });

  it("writes the first sessions row and a session_created event", () => {
    const result = services.createSession();

    const session = repository.getSessionByKey(result.providerKey);
    expect(session).toMatchObject({ status: "CREATED" });

    const events = repository.getEvents(session!.id);
    expect(events.map((event) => event.type)).toEqual(["session_created"]);
  });

  it("adds the session to the registry", () => {
    const result = services.createSession();
    const session = repository.getSessionByKey(result.providerKey);

    expect(registry.getSession(session!.id)).toMatchObject({ status: "CREATED" });
  });

  it("makes different keys and ids on each call", () => {
    const first = services.createSession();
    const second = services.createSession();

    expect(first.providerKey).not.toBe(second.providerKey);
    expect(first.patientKey).not.toBe(second.patientKey);
  });
});

describe("resolveKey", () => {
  it("returns the sessionId, role, and status for a provider key", () => {
    const created = services.createSession();

    expect(services.resolveKey(created.providerKey)).toEqual({
      sessionId: expect.any(String),
      role: "provider",
      status: "CREATED",
    });
  });

  it("returns the role 'patient' for a patient key", () => {
    const created = services.createSession();

    expect(services.resolveKey(created.patientKey)).toMatchObject({ role: "patient" });
  });

  it("returns undefined for a key no session has", () => {
    expect(services.resolveKey("no-such-key")).toBeUndefined();
  });
});

describe("endInterruptedSessions", () => {
  it("moves every non-ENDED session to ENDED with reason interrupted, and writes the event", () => {
    const created = services.createSession();
    const session = repository.getSessionByKey(created.providerKey)!;

    services.endInterruptedSessions();

    const updated = repository.getSession(session.id);
    expect(updated).toMatchObject({ status: "ENDED", endedReason: "interrupted" });

    const events = repository.getEvents(session.id);
    expect(events.map((event) => event.type)).toEqual(["session_created", "session_ended"]);
    expect(events.at(-1)?.data).toEqual({ reason: "interrupted" });
  });

  it("leaves an already-ENDED session untouched", () => {
    const created = services.createSession();
    const session = repository.getSessionByKey(created.providerKey)!;
    services.endInterruptedSessions();
    const eventsAfterFirstSweep = repository.getEvents(session.id).length;

    services.endInterruptedSessions();

    expect(repository.getEvents(session.id)).toHaveLength(eventsAfterFirstSweep);
  });

  it("does not touch the registry", () => {
    const created = services.createSession();
    const session = repository.getSessionByKey(created.providerKey)!;

    services.endInterruptedSessions();

    expect(registry.getSession(session.id)).toMatchObject({ status: "CREATED" });
  });

  it("a key for a session ended by the sweep then resolves to status ENDED", () => {
    const created = services.createSession();

    services.endInterruptedSessions();

    expect(services.resolveKey(created.providerKey)).toMatchObject({ status: "ENDED" });
  });
});
