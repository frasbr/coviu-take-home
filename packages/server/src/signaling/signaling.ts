import type { ClientToServerEvents, ErrorPayload, Role, ServerToClientEvents } from "@coviu/shared";
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

  io.on("connection", (socket: AppSocket) => {
    const { sessionId, role } = socket.data;

    const roles = connectedSockets.get(sessionId) ?? {};
    roles[role] = socket.id;
    connectedSockets.set(sessionId, roles);

    socket.join(roomName(sessionId));

    if (role === "patient" && registry.getSession(sessionId)?.status === "CREATED") {
      registry.patientConnected(sessionId);
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

    socket.on("disconnect", () => {
      const current = connectedSockets.get(sessionId);
      if (current?.[role] === socket.id) {
        delete current[role];
      }
    });
  });

  registry.on("transition", ({ sessionId, to, presence }) => {
    io.to(roomName(sessionId)).emit("session:state", {
      state: to,
      since: new Date().toISOString(),
      reason: null,
      presence,
    });
  });
}
