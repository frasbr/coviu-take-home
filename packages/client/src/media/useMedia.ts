import { useCallback, useEffect, useRef, useState } from "react";

export interface MediaCall {
  on(event: "stream", handler: (stream: MediaStream) => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  answer(stream: MediaStream): void;
  close(): void;
}

export interface MediaPeer {
  on(event: "open", handler: (id: string) => void): void;
  on(event: "call", handler: (call: MediaCall) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  call(peerId: string, stream: MediaStream): MediaCall;
  destroy(): void;
}

export type CreatePeer = () => MediaPeer;
export type GetUserMedia = () => Promise<MediaStream>;

export interface UseMediaOptions {
  active: boolean;
  createPeer: CreatePeer;
  getUserMedia: GetUserMedia;
}

export interface UseMediaResult {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  localPeerId: string | null;
  error: string | null;
  callPeer: (peerId: string) => void;
}

const CAPTURE_ERROR = "Could not access the camera or microphone.";
const CONNECTION_ERROR = "The video connection failed.";
const CALL_ENDED_ERROR = "The video call ended.";

function stopTracks(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

/**
 * The media layer. It wraps one PeerJS peer and the local capture, and knows
 * nothing about the socket: the two connections fail independently, so a socket
 * reconnect must never tear the peer down.
 */
export function useMedia({ active, createPeer, getUserMedia }: UseMediaOptions): UseMediaResult {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<MediaPeer | null>(null);
  const callRef = useRef<MediaCall | null>(null);
  const calledPeerIdRef = useRef<string | null>(null);

  const trackCall = useCallback((call: MediaCall) => {
    callRef.current = call;
    call.on("stream", (stream) => setRemoteStream(stream));
    call.on("close", () => {
      setRemoteStream(null);
      setError(CALL_ENDED_ERROR);
    });
    call.on("error", () => setError(CONNECTION_ERROR));
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;

    getUserMedia()
      .then((stream) => {
        if (cancelled) {
          stopTracks(stream);
          return;
        }

        streamRef.current = stream;
        setLocalStream(stream);

        // The peer is created only once capture has resolved, so an inbound call
        // can always be answered immediately. Capturing in parallel would need a
        // queue for a call that beats the stream, and buys nothing.
        const peer = createPeer();
        peerRef.current = peer;

        peer.on("open", (id) => setLocalPeerId(id));
        peer.on("call", (call) => {
          call.answer(stream);
          trackCall(call);
        });
        peer.on("error", () => setError(CONNECTION_ERROR));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setError(CAPTURE_ERROR);
      });

    return () => {
      cancelled = true;
      callRef.current?.close();
      callRef.current = null;
      peerRef.current?.destroy();
      peerRef.current = null;
      stopTracks(streamRef.current);
      streamRef.current = null;
      calledPeerIdRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setLocalPeerId(null);
      setError(null);
    };
  }, [active, createPeer, getUserMedia, trackCall]);

  const callPeer = useCallback(
    (peerId: string) => {
      const peer = peerRef.current;
      const stream = streamRef.current;
      if (!peer || !stream || calledPeerIdRef.current !== null) {
        return;
      }

      calledPeerIdRef.current = peerId;
      trackCall(peer.call(peerId, stream));
    },
    [trackCall],
  );

  return { localStream, remoteStream, localPeerId, error, callPeer };
}
