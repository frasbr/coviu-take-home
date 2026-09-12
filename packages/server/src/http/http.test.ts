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

beforeEach(async () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  const repository = createSqliteSessionRepository(db);
  const registry = new SessionRegistry();
  const services = createSessionService(repository, registry, "https://example.test");

  const app = createHttpApp(services);
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
