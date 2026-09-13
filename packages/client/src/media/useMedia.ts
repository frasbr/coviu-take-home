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
  const trackCallRef = useRef<((call: MediaCall) => void) | null>(null);

  // The injected dependencies live in refs so that `active` is the only thing
  // that can restart capture. Keeping them in the dependency array would make the
  // camera's lifetime hang on the caller passing stable function identities: one
  // inline arrow in a view and every render would destroy the peer, drop the call
  // and re-prompt for permission.
  const createPeerRef = useRef(createPeer);
  const getUserMediaRef = useRef(getUserMedia);
  createPeerRef.current = createPeer;
  getUserMediaRef.current = getUserMedia;

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;

    const trackCall = (call: MediaCall) => {
      callRef.current = call;
      call.on("stream", (stream) => {
        if (!cancelled) {
          setRemoteStream(stream);
        }
      });
      call.on("close", () => {
        if (callRef.current === call) {
          callRef.current = null;
        }
        if (!cancelled) {
          setRemoteStream(null);
          setError(CALL_ENDED_ERROR);
        }
      });
      call.on("error", () => {
        if (!cancelled) {
          setError(CONNECTION_ERROR);
        }
      });
    };
    trackCallRef.current = trackCall;

    getUserMediaRef
      .current()
      .then(
        (stream) => {
          if (cancelled) {
            stopTracks(stream);
            return;
          }

          streamRef.current = stream;
          setLocalStream(stream);

          // The peer is created only once capture has resolved, so an inbound call
          // can always be answered immediately. Capturing in parallel would need a
          // queue for a call that beats the stream, and buys nothing.
          const peer = createPeerRef.current();
          peerRef.current = peer;

          peer.on("open", (id) => {
            if (!cancelled) {
              setLocalPeerId(id);
            }
          });
          peer.on("call", (call) => {
            if (cancelled) {
              return;
            }
            if (callRef.current) {
              call.close();
              return;
            }
            trackCall(call);
            call.answer(stream);
          });
          peer.on("error", () => {
            if (!cancelled) {
              setError(CONNECTION_ERROR);
            }
          });
        },
        () => {
          if (!cancelled) {
            setError(CAPTURE_ERROR);
          }
        },
      )
      // Only a getUserMedia rejection is a capture failure; a throw from peer
      // creation or handler registration reaches here instead.
      .catch(() => {
        if (!cancelled) {
          setError(CONNECTION_ERROR);
        }
      });

    return () => {
      cancelled = true;
      trackCallRef.current = null;
      callRef.current?.close();
      callRef.current = null;
      peerRef.current?.destroy();
      peerRef.current = null;
      stopTracks(streamRef.current);
      streamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setLocalPeerId(null);
      setError(null);
    };
  }, [active]);

  // The guard is "a call is live", not "a call was placed": when the other side
  // reloads, its old call closes and it sends a fresh peer ID, and this side has to
  // be able to place a new call. A once-per-activation flag would leave the video
  // black for the rest of the session.
  const callPeer = useCallback((peerId: string) => {
    const peer = peerRef.current;
    const stream = streamRef.current;
    const trackCall = trackCallRef.current;
    if (!peer || !stream || !trackCall || callRef.current) {
      return;
    }

    trackCall(peer.call(peerId, stream));
  }, []);

  return { localStream, remoteStream, localPeerId, error, callPeer };
}
