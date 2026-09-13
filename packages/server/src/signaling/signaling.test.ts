import { type Server as HttpServer, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import type {
  ClientToServerEvents,
  ErrorPayload,
  ServerToClientEvents,
  SessionStatePayload,
} from "@coviu/shared";
import type { DefaultEventsMap } from "socket.io";
import { Server } from "socket.io";
import { type Socket as ClientSocket, io as ioClient } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../persistence/schema.js";
import { createSqliteSessionRepository } from "../persistence/sessionRepository.js";
import { type SessionService, createSessionService } from "../services/sessionService.js";
import { SessionRegistry } from "../session/sessionRegistry.js";
import { type SocketData, attachSignaling } from "./signaling.js";

let httpServer: HttpServer;
let io: Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
let registry: SessionRegistry;
let services: SessionService;
let baseUrl: string;
const sockets: ClientSocket[] = [];

function connect(key: string): ClientSocket {
  const socket = ioClient(baseUrl, { auth: { key }, reconnection: false });
  sockets.push(socket);
  return socket;
}

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

beforeEach(async () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  const repository = createSqliteSessionRepository(db);
  registry = new SessionRegistry();
  services = createSessionService(repository, registry, "https://example.test");

  httpServer = createServer();
  io = new Server(httpServer, { pingInterval: 10_000, pingTimeout: 20_000 });
  attachSignaling(io, services, registry);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const socket of sockets) {
    socket.close();
  }
  sockets.length = 0;
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("handshake middleware", () => {
  it("refuses a junk key with unknown_key", async () => {
    const socket = connect("junk-key");

    const error = await waitForEvent<Error & { data?: ErrorPayload }>(socket, "connect_error");

    expect(error.data).toEqual({ code: "unknown_key", message: expect.any(String) });
  });

  it("refuses a second connection for a role that is already connected", async () => {
    const created = services.createSession();
    const first = connect(created.providerKey);
    await waitForEvent(first, "connect");

    const second = connect(created.providerKey);
    const error = await waitForEvent<Error & { data?: ErrorPayload }>(second, "connect_error");

    expect(error.data).toEqual({ code: "role_already_connected", message: expect.any(String) });
  });

  it("refuses a connection to an ENDED session", async () => {
    const created = services.createSession();
    services.endInterruptedSessions();

    const socket = connect(created.providerKey);
    const error = await waitForEvent<Error & { data?: ErrorPayload }>(socket, "connect_error");

    expect(error.data).toEqual({ code: "session_ended", message: expect.any(String) });
  });

  it("accepts a valid provider key, marks the provider present, and emits session:state", async () => {
    const created = services.createSession();
    const socket = connect(created.providerKey);

    const state = await waitForEvent<SessionStatePayload>(socket, "session:state");

    expect(state).toMatchObject({
      state: "CREATED",
      reason: null,
      presence: { provider: true, patient: false },
    });
  });

  it("moves the session to WAITING when the patient connects, and broadcasts session:state", async () => {
    const created = services.createSession();
    const provider = connect(created.providerKey);
    await waitForEvent(provider, "session:state");

    const providerStateUpdate = waitForEvent<SessionStatePayload>(provider, "session:state");
    const patient = connect(created.patientKey);
    const patientState = await waitForEvent<SessionStatePayload>(patient, "session:state");

    expect(patientState).toMatchObject({ state: "WAITING", presence: { patient: true } });
    await expect(providerStateUpdate).resolves.toMatchObject({
      state: "WAITING",
      presence: { patient: true },
    });
  });

  it("broadcasts presence.provider to a patient already in the room", async () => {
    const created = services.createSession();
    const patient = connect(created.patientKey);
    await waitForEvent(patient, "session:state");

    const patientStateUpdate = waitForEvent<SessionStatePayload>(patient, "session:state");
    connect(created.providerKey);

    await expect(patientStateUpdate).resolves.toMatchObject({
      presence: { provider: true, patient: true },
    });
  });
});

describe("admit", () => {
  it("moves WAITING to ACTIVE and broadcasts to both sockets", async () => {
    const created = services.createSession();
    const provider = connect(created.providerKey);
    await waitForEvent(provider, "session:state");
    const patient = connect(created.patientKey);
    await waitForEvent(patient, "session:state");

    const providerUpdate = waitForEvent<SessionStatePayload>(provider, "session:state");
    const patientUpdate = waitForEvent<SessionStatePayload>(patient, "session:state");
    provider.emit("admit", {});

    await expect(providerUpdate).resolves.toMatchObject({ state: "ACTIVE" });
    await expect(patientUpdate).resolves.toMatchObject({ state: "ACTIVE" });
  });

  it("rejects admit from the patient with not_allowed_in_state", async () => {
    const created = services.createSession();
    const patient = connect(created.patientKey);
    await waitForEvent(patient, "session:state");

    const error = waitForEvent<ErrorPayload>(patient, "error");
    patient.emit("admit", {});

    await expect(error).resolves.toEqual({
      code: "not_allowed_in_state",
      message: expect.any(String),
    });
  });

  it("rejects admit in CREATED with not_allowed_in_state", async () => {
    const created = services.createSession();
    const provider = connect(created.providerKey);
    await waitForEvent(provider, "session:state");

    const error = waitForEvent<ErrorPayload>(provider, "error");
    provider.emit("admit", {});

    await expect(error).resolves.toEqual({
      code: "not_allowed_in_state",
      message: expect.any(String),
    });
  });
});

describe("end-session", () => {
  it("moves any non-ENDED state to ENDED with reason provider_ended, broadcast to both sockets", async () => {
    const created = services.createSession();
    const provider = connect(created.providerKey);
    await waitForEvent(provider, "session:state");
    const patient = connect(created.patientKey);
    await waitForEvent(patient, "session:state");

    const providerUpdate = waitForEvent<SessionStatePayload>(provider, "session:state");
    const patientUpdate = waitForEvent<SessionStatePayload>(patient, "session:state");
    provider.emit("end-session", {});

    await expect(providerUpdate).resolves.toMatchObject({
      state: "ENDED",
      reason: "provider_ended",
    });
    await expect(patientUpdate).resolves.toMatchObject({
      state: "ENDED",
      reason: "provider_ended",
    });
  });

  it("rejects end-session from the patient with not_allowed_in_state", async () => {
    const created = services.createSession();
    const patient = connect(created.patientKey);
    await waitForEvent(patient, "session:state");

    const error = waitForEvent<ErrorPayload>(patient, "error");
    patient.emit("end-session", {});

    await expect(error).resolves.toEqual({
      code: "not_allowed_in_state",
      message: expect.any(String),
    });
  });
});

describe("patient:leave", () => {
  it("sets presence.patient false without ending the session, broadcast to both sockets", async () => {
    const created = services.createSession();
    const provider = connect(created.providerKey);
    await waitForEvent(provider, "session:state");
    const patient = connect(created.patientKey);
    await waitForEvent(patient, "session:state");

    const providerUpdate = waitForEvent<SessionStatePayload>(provider, "session:state");
    patient.emit("patient:leave", {});

    await expect(providerUpdate).resolves.toMatchObject({
      state: "WAITING",
      presence: { provider: true, patient: false },
    });
  });

  it("rejects patient:leave from the provider with not_allowed_in_state", async () => {
    const created = services.createSession();
    const provider = connect(created.providerKey);
    await waitForEvent(provider, "session:state");
    const patient = connect(created.patientKey);
    await waitForEvent(patient, "session:state");

    const error = waitForEvent<ErrorPayload>(provider, "error");
    provider.emit("patient:leave", {});

    await expect(error).resolves.toEqual({
      code: "not_allowed_in_state",
      message: expect.any(String),
    });
  });

  it("rejects patient:leave once the session has ended, with session_ended", async () => {
    const created = services.createSession();
    const provider = connect(created.providerKey);
    await waitForEvent(provider, "session:state");
    const patient = connect(created.patientKey);
    await waitForEvent(patient, "session:state");

    const patientEndedUpdate = waitForEvent(patient, "session:state");
    provider.emit("end-session", {});
    await patientEndedUpdate;

    const error = waitForEvent<ErrorPayload>(patient, "error");
    patient.emit("patient:leave", {});

    await expect(error).resolves.toEqual({
      code: "session_ended",
      message: expect.any(String),
    });
  });
});
