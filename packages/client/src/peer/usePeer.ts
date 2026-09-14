import { useEffect, useRef, useState } from "react";

export interface MediaCall {
  on(event: "stream", handler: (stream: MediaStream) => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  answer(stream: MediaStream): void;
  close(): void;
}

export interface MediaChannel {
  on(event: "open", handler: () => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "data", handler: (data: unknown) => void): void;
  send(data: unknown): void;
  close(): void;
}

export interface MediaPeer {
  on(event: "open", handler: (id: string) => void): void;
  on(event: "call", handler: (call: MediaCall) => void): void;
  on(event: "connection", handler: (channel: MediaChannel) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  call(peerId: string, stream: MediaStream): MediaCall;
  connect(peerId: string): MediaChannel;
  destroy(): void;
}

export type CreatePeer = () => MediaPeer;

export interface UsePeerOptions {
  active: boolean;
  createPeer: CreatePeer;
}

export interface UsePeerResult {
  peer: MediaPeer | null;
  localPeerId: string | null;
  error: string | null;
}

const CONNECTION_ERROR = "The video connection failed.";

/**
 * Owns the PeerJS peer's lifecycle: create it on activation, destroy it on
 * deactivation, and hand the live instance to every consumer that rides it
 * (media, chat) without either one knowing about the other.
 */
export function usePeer({ active, createPeer }: UsePeerOptions): UsePeerResult {
  const [peer, setPeer] = useState<MediaPeer | null>(null);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createPeerRef = useRef(createPeer);
  createPeerRef.current = createPeer;

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;

    try {
      const created = createPeerRef.current();

      created.on("open", (id) => {
        if (!cancelled) {
          setLocalPeerId(id);
        }
      });
      created.on("error", () => {
        if (!cancelled) {
          setError(CONNECTION_ERROR);
        }
      });

      setPeer(created);

      return () => {
        cancelled = true;
        created.destroy();
        setPeer(null);
        setLocalPeerId(null);
        setError(null);
      };
    } catch {
      setError(CONNECTION_ERROR);
      return undefined;
    }
  }, [active]);

  return { peer, localPeerId, error };
}
