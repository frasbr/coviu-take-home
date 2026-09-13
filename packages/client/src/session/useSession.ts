import type {
  ClientToServerEvents,
  ErrorPayload,
  Role,
  ServerToClientEvents,
  SessionStatePayload,
} from "@coviu/shared";
import { useEffect, useRef, useState } from "react";
import { type Socket, io } from "socket.io-client";
import { HttpError, createHttpClient } from "./httpClient.js";

export type SessionConnection =
  | { status: "resolving" }
  | { status: "error"; error: ErrorPayload }
  | { status: "connected"; role: Role; state: SessionStatePayload };

export interface UseSessionResult {
  connection: SessionConnection;
  admit: () => void;
  endSession: () => void;
  leave: () => void;
}

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const GENERIC_ERROR: ErrorPayload = { code: "unknown_key", message: "could not join the session" };

/**
 * The session and socket layer. It wraps the HTTP calls
 * and the one Socket.IO connection, and turns socket events into React state. It
 * holds no reconnect or backoff code - socket.io-client does that - and a handshake
 * refusal (connect_error) is terminal rather than retried.
 */
export function useSession(baseUrl: string, key: string): UseSessionResult {
  const [connection, setConnection] = useState<SessionConnection>({ status: "resolving" });
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConnection({ status: "resolving" });

    createHttpClient(baseUrl)
      .getSession(key)
      .then((resolved) => {
        if (cancelled) {
          return;
        }

        const socket: AppSocket = io(baseUrl, { auth: { key } });
        socketRef.current = socket;

        socket.on("session:state", (payload) => {
          setConnection({ status: "connected", role: resolved.role, state: payload });
        });

        socket.on("error", (payload) => {
          setConnection({ status: "error", error: payload });
        });

        socket.on("connect_error", (err) => {
          const payload = (err as Error & { data?: ErrorPayload }).data;
          setConnection({ status: "error", error: payload ?? GENERIC_ERROR });
        });
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setConnection({
          status: "error",
          error: err instanceof HttpError ? err.payload : GENERIC_ERROR,
        });
      });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [baseUrl, key]);

  return {
    connection,
    admit: () => socketRef.current?.emit("admit", {}),
    endSession: () => socketRef.current?.emit("end-session", {}),
    leave: () => socketRef.current?.emit("patient:leave", {}),
  };
}
