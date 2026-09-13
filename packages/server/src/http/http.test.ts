import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import type { CreateSessionResponse } from "@coviu/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../persistence/schema.js";
import { createSqliteSessionRepository } from "../persistence/sessionRepository.js";
import { createSessionService } from "../services/sessionService.js";
import { SessionRegistry } from "../session/sessionRegistry.js";
import { createHttpApp } from "./http.js";

let server: Server;
let baseUrl: string;
let repository: ReturnType<typeof createSqliteSessionRepository>;

beforeEach(async () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  repository = createSqliteSessionRepository(db);
  const registry = new SessionRegistry();
  const services = createSessionService(repository, registry, "https://example.test");

  const app = createHttpApp(services, "https://client.example.test");
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/sessions", () => {
  it("returns the four fields and no sessionId", async () => {
    const response = await fetch(`${baseUrl}/api/sessions`, { method: "POST" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      providerKey: expect.any(String),
      patientKey: expect.any(String),
      providerUrl: expect.any(String),
      patientUrl: expect.any(String),
    });
    expect(body).not.toHaveProperty("sessionId");
  });
});

describe("CORS", () => {
  it("allows the configured client origin on a cross-origin request", async () => {
    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { Origin: "https://client.example.test" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("https://client.example.test");
  });
});

describe("GET /api/sessions/:key", () => {
  it("returns the role and status for a provider key", async () => {
    const created = (await (
      await fetch(`${baseUrl}/api/sessions`, { method: "POST" })
    ).json()) as CreateSessionResponse;

    const response = await fetch(`${baseUrl}/api/sessions/${created.providerKey}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "provider", status: "CREATED" });
  });

  it("returns the role and status for a patient key", async () => {
    const created = (await (
      await fetch(`${baseUrl}/api/sessions`, { method: "POST" })
    ).json()) as CreateSessionResponse;

    const response = await fetch(`${baseUrl}/api/sessions/${created.patientKey}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "patient", status: "CREATED" });
  });

  it("returns 404 unknown_key for a key no session has", async () => {
    const response = await fetch(`${baseUrl}/api/sessions/no-such-key`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "unknown_key", message: expect.any(String) });
  });
});

describe("GET /api/sessions/:providerKey/events", () => {
  it("returns the event log for a provider key, in order, and not shadowed by GET /api/sessions/:key", async () => {
    const created = (await (
      await fetch(`${baseUrl}/api/sessions`, { method: "POST" })
    ).json()) as CreateSessionResponse;
    const session = repository.getSessionByKey(created.providerKey);
    if (!session) {
      throw new Error("expected the session created above to exist");
    }
    repository.recordEvent(session.id, "patient_joined_waiting_room");

    const response = await fetch(`${baseUrl}/api/sessions/${created.providerKey}/events`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      events: [
        expect.objectContaining({ type: "session_created" }),
        expect.objectContaining({ type: "patient_joined_waiting_room" }),
      ],
    });
    expect(body).not.toHaveProperty("role");
    expect(body).not.toHaveProperty("status");
  });

  it("returns 404 unknown_key for a patient key", async () => {
    const created = (await (
      await fetch(`${baseUrl}/api/sessions`, { method: "POST" })
    ).json()) as CreateSessionResponse;

    const response = await fetch(`${baseUrl}/api/sessions/${created.patientKey}/events`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "unknown_key",
      message: "no session has that key",
    });
  });

  it("returns 404 unknown_key for a key no session has", async () => {
    const response = await fetch(`${baseUrl}/api/sessions/no-such-key/events`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "unknown_key",
      message: "no session has that key",
    });
  });

  it("returns 200 with an empty events array for a provider key with no logged events", async () => {
    repository.upsertSession({
      id: "empty-log-session",
      providerKey: "empty-log-provider-key",
      patientKey: "empty-log-patient-key",
      status: "CREATED",
      createdAt: new Date().toISOString(),
      endedAt: null,
      endedReason: null,
    });

    const response = await fetch(`${baseUrl}/api/sessions/empty-log-provider-key/events`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [] });
  });
});
