import {
  AdmitPayloadSchema,
  type ClientToServerEvents,
  EndSessionPayloadSchema,
  type ErrorPayload,
  PatientLeavePayloadSchema,
  type Role,
  type ServerToClientEvents,
  type SessionStatus,
} from "@coviu/shared";
import type { DefaultEventsMap, Server, Socket } from "socket.io";
import type { SessionService } from "../services/sessionService.js";
import type { SessionRegistry } from "../session/sessionRegistry.js";

export interface SocketData {
  sessionId: string;
  role: Role;
}

export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>;

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

function roomName(sessionId: string): string {
  return `session:${sessionId}`;
}

function refuse(next: (err?: Error) => void, code: ErrorPayload["code"], message: string): void {
  const err = new Error(message) as Error & { data: ErrorPayload };
  err.data = { code, message };
  next(err);
}

function sendSocketError(socket: AppSocket, code: ErrorPayload["code"], message: string): void {
  socket.emit("error", { code, message });
}

const ADMIT_ALLOWED_STATES: readonly SessionStatus[] = ["WAITING"];
const END_SESSION_ALLOWED_STATES: readonly SessionStatus[] = [
  "CREATED",
  "WAITING",
  "ACTIVE",
  "DISCONNECTED_GRACE",
];
const PATIENT_LEAVE_ALLOWED_STATES: readonly SessionStatus[] = [
  "WAITING",
  "ACTIVE",
  "DISCONNECTED_GRACE",
];

export function attachSignaling(
  io: AppServer,
  services: SessionService,
  registry: SessionRegistry,
): void {
  // Tracks which socket currently holds each role for a session, so a second
  // connection for an already-connected role can be refused. This is
  // transport bookkeeping, not session state, so it lives here rather than
  // in the registry.
  const connectedSockets = new Map<string, Partial<Record<Role, string>>>();

  io.use((socket, next) => {
    const key = socket.handshake.auth?.key;
    if (typeof key !== "string") {
      refuse(next, "unknown_key", "no session has that key");
      return;
    }

    const resolved = services.resolveKey(key);
    if (!resolved) {
      refuse(next, "unknown_key", "no session has that key");
      return;
    }

    if (resolved.status === "ENDED") {
      refuse(next, "session_ended", "this session has ended");
      return;
    }

    if (connectedSockets.get(resolved.sessionId)?.[resolved.role]) {
      refuse(next, "role_already_connected", `${resolved.role} is already connected`);
      return;
    }

    socket.data.sessionId = resolved.sessionId;
    socket.data.role = resolved.role;
    next();
  });

  /**
   * Checks role and current-state legality for a provider- or patient-only message.
   * Sends the matching error and returns false when the message should be dropped;
   * the caller only runs the registry command on true.
   */
  function checkLegal(
    socket: AppSocket,
    requiredRole: Role,
    allowedStates: readonly SessionStatus[],
  ): boolean {
    const { sessionId, role } = socket.data;

    if (role !== requiredRole) {
      sendSocketError(socket, "not_allowed_in_state", `only the ${requiredRole} can do that`);
      return false;
    }

    const entry = registry.getSession(sessionId);
    if (!entry || entry.status === "ENDED") {
      sendSocketError(socket, "session_ended", "this session has ended");
      return false;
    }

    if (!allowedStates.includes(entry.status)) {
      sendSocketError(
        socket,
        "not_allowed_in_state",
        `this message is not allowed in state ${entry.status}`,
      );
      return false;
    }

    return true;
  }

  io.on("connection", (socket: AppSocket) => {
    const { sessionId, role } = socket.data;

    const roles = connectedSockets.get(sessionId) ?? {};
    roles[role] = socket.id;
    connectedSockets.set(sessionId, roles);

    socket.join(roomName(sessionId));

    if (role === "patient" && registry.getSession(sessionId)?.status === "CREATED") {
      registry.patientConnected(sessionId);
    }
    if (role === "provider") {
      registry.providerConnected(sessionId);
    }

    const entry = registry.getSession(sessionId);
    if (entry) {
      socket.emit("session:state", {
        state: entry.status,
        since: new Date().toISOString(),
        reason: null,
        presence: entry.presence,
      });
    }

    socket.on("admit", (payload) => {
      if (!AdmitPayloadSchema.safeParse(payload).success) {
        sendSocketError(socket, "invalid_message", "invalid admit payload");
        return;
      }
      if (checkLegal(socket, "provider", ADMIT_ALLOWED_STATES)) {
        registry.admit(sessionId);
      }
    });

    socket.on("end-session", (payload) => {
      if (!EndSessionPayloadSchema.safeParse(payload).success) {
        sendSocketError(socket, "invalid_message", "invalid end-session payload");
        return;
      }
      if (checkLegal(socket, "provider", END_SESSION_ALLOWED_STATES)) {
        registry.endSession(sessionId);
      }
    });

    socket.on("patient:leave", (payload) => {
      if (!PatientLeavePayloadSchema.safeParse(payload).success) {
        sendSocketError(socket, "invalid_message", "invalid patient:leave payload");
        return;
      }
      if (checkLegal(socket, "patient", PATIENT_LEAVE_ALLOWED_STATES)) {
        registry.patientLeft(sessionId);
      }
    });

    socket.on("disconnect", () => {
      const current = connectedSockets.get(sessionId);
      if (current?.[role] === socket.id) {
        delete current[role];
      }
    });
  });

  registry.on("transition", ({ sessionId, to, endedReason, presence }) => {
    io.to(roomName(sessionId)).emit("session:state", {
      state: to,
      since: new Date().toISOString(),
      reason: to === "ENDED" ? (endedReason ?? null) : null,
      presence,
    });
  });

  registry.on("presence", ({ sessionId, presence }) => {
    const entry = registry.getSession(sessionId);
    if (!entry) {
      return;
    }

    io.to(roomName(sessionId)).emit("session:state", {
      state: entry.status,
      since: new Date().toISOString(),
      reason: null,
      presence,
    });
  });
}
