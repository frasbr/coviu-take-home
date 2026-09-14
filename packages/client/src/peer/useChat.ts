import type { Role } from "@coviu/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { readStoredTranscript, writeStoredTranscript } from "./chatStorage.js";
import type { ChatMessage } from "./mergeTranscript.js";
import { mergeTranscript } from "./mergeTranscript.js";
import type { MediaChannel, MediaPeer } from "./usePeer.js";

export interface UseChatOptions {
  active: boolean;
  peer: MediaPeer | null;
  role: Role;
  sessionKey: string;
}

export interface UseChatResult {
  transcript: ChatMessage[];
  isOpen: boolean;
  sendMessage: (text: string) => void;
  connectTo: (peerId: string) => void;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.sender === "provider" || candidate.sender === "patient") &&
    typeof candidate.text === "string" &&
    typeof candidate.sentAt === "string"
  );
}

// Every wire payload is a ChatMessage[]: the open handshake sends the full
// transcript and a live send sends a single-element array, so the receiver
// has one shape to parse and mergeTranscript handles both uniformly.
function parseInboundTranscript(data: unknown): ChatMessage[] | null {
  if (!Array.isArray(data) || !data.every(isChatMessage)) {
    return null;
  }
  return data;
}

/**
 * The chat module of the peer layer. It owns the data channel and the
 * transcript, and never imports the media module or the socket layer: the
 * channel's own open/close is the only source of "can I send a message".
 */
export function useChat({ active, peer, role, sessionKey }: UseChatOptions): UseChatResult {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  // Kept in step with every transcript mutation explicitly (by persistMerge
  // and the activation read below), not by mirroring the `transcript` state
  // each render: a channel event can fire between renders and needs the
  // latest value synchronously, before React has re-rendered.
  const transcriptRef = useRef<ChatMessage[]>([]);

  const channelRef = useRef<MediaChannel | null>(null);
  const openRef = useRef(false);
  const trackChannelRef = useRef<((channel: MediaChannel) => void) | null>(null);

  const roleRef = useRef(role);
  roleRef.current = role;

  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;

  // A merge is applied and persisted together, at every site that changes the
  // transcript, rather than through a derived effect keyed on `transcript`:
  // an effect would also fire on the very first render of an activation,
  // before the sessionStorage read below has been applied, and clobber a
  // saved transcript with the stale initial []. Persistence is therefore
  // synchronous with the state update that causes it, never inferred after.
  const persistMerge = useCallback((incoming: ChatMessage[]) => {
    const merged = mergeTranscript(transcriptRef.current, incoming);
    transcriptRef.current = merged;
    setTranscript(merged);
    writeStoredTranscript(sessionKeyRef.current, merged);
    return merged;
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;

    const stored = readStoredTranscript(sessionKeyRef.current);
    transcriptRef.current = stored;
    setTranscript(stored);

    const trackChannel = (channel: MediaChannel) => {
      channelRef.current = channel;
      channel.on("open", () => {
        if (cancelled) {
          return;
        }
        openRef.current = true;
        setIsOpen(true);
        channel.send(transcriptRef.current);
      });
      channel.on("data", (data) => {
        if (cancelled) {
          return;
        }
        const inbound = parseInboundTranscript(data);
        if (!inbound) {
          return;
        }
        persistMerge(inbound);
      });
      channel.on("close", () => {
        if (channelRef.current === channel) {
          channelRef.current = null;
        }
        openRef.current = false;
        if (!cancelled) {
          setIsOpen(false);
        }
      });
    };
    trackChannelRef.current = trackChannel;

    return () => {
      cancelled = true;
      trackChannelRef.current = null;
      channelRef.current?.close();
      channelRef.current = null;
      openRef.current = false;
      transcriptRef.current = [];
      setTranscript([]);
      setIsOpen(false);
    };
  }, [active, persistMerge]);

  useEffect(() => {
    if (!active || !peer) {
      return;
    }

    let cancelled = false;

    peer.on("connection", (channel) => {
      if (cancelled) {
        return;
      }
      const trackChannel = trackChannelRef.current;
      if (channelRef.current || !trackChannel) {
        channel.close();
        return;
      }
      trackChannel(channel);
    });

    return () => {
      cancelled = true;
    };
  }, [active, peer]);

  const connectTo = useCallback(
    (peerId: string) => {
      const trackChannel = trackChannelRef.current;
      if (!peer || !trackChannel || channelRef.current) {
        return;
      }
      trackChannel(peer.connect(peerId));
    },
    [peer],
  );

  const sendMessage = useCallback(
    (text: string) => {
      const channel = channelRef.current;
      if (!channel || !openRef.current) {
        return;
      }

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        sender: roleRef.current,
        text,
        sentAt: new Date().toISOString(),
      };

      persistMerge([message]);
      channel.send([message]);
    },
    [persistMerge],
  );

  return { transcript, isOpen, sendMessage, connectTo };
}
