import type {
  ClientToServerEvents,
  ErrorPayload,
  Role,
  ServerToClientEvents,
  SessionStatePayload,
} from "@coviu/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Socket, io } from "socket.io-client";
import { HttpError, createHttpClient } from "./httpClient.js";

export type SessionConnection =
  | { status: "resolving" }
  | { status: "error"; error: ErrorPayload }
  | { status: "connected"; role: Role; state: SessionStatePayload };

export interface UseSessionResult {
  connection: SessionConnection;
  remotePeerId: string | null;
  admit: () => void;
  endSession: () => void;
  leave: () => void;
  sendPeerId: (peerId: string) => void;
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
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConnection({ status: "resolving" });
    setRemotePeerId(null);

    createHttpClient(baseUrl)
      .getSession(key)
      .then((resolved) => {
        if (cancelled) {
          return;
        }

        const socket: AppSocket = io(baseUrl, { auth: { key } });
        socketRef.current = socket;
        const hasConnectedRef = { current: false };

        socket.on("connect", () => {
          hasConnectedRef.current = true;
        });

        socket.on("session:state", (payload) => {
          setConnection({ status: "connected", role: resolved.role, state: payload });
        });

        socket.on("peer:id", (payload) => {
          setRemotePeerId(payload.peerId);
        });

        socket.on("error", (payload) => {
          setConnection({ status: "error", error: payload });
        });

        socket.on("connect_error", (err) => {
          const payload = (err as Error & { data?: ErrorPayload }).data;
          if (hasConnectedRef.current && !payload) {
            // socket.io-client also fires connect_error for a failed reconnection
            // attempt, not only the initial handshake refusal. Once connected, the
            // socket and peer connections fail independently, so a payload-less
            // connect_error must not tear a live call down. A payload-carrying one
            // is a middleware refusal and is always terminal.
            return;
          }
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

  const admit = useCallback(() => socketRef.current?.emit("admit", {}), []);
  const endSession = useCallback(() => socketRef.current?.emit("end-session", {}), []);
  const leave = useCallback(() => socketRef.current?.emit("patient:leave", {}), []);
  const sendPeerId = useCallback(
    (peerId: string) => socketRef.current?.emit("peer:id", { peerId }),
    [],
  );

  return {
    connection,
    remotePeerId,
    admit,
    endSession,
    leave,
    sendPeerId,
  };
}
