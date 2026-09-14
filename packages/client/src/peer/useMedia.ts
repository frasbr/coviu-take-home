import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaCall, MediaPeer } from "./usePeer.js";

export type GetUserMedia = () => Promise<MediaStream>;

export interface UseMediaOptions {
  active: boolean;
  peer: MediaPeer | null;
  getUserMedia: GetUserMedia;
}

export interface UseMediaResult {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
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
 * The media module of the peer layer. It owns local capture and the call
 * that rides a peer handed to it by usePeer; it never creates or destroys
 * that peer, so a second module (chat) can share the same one.
 */
export function useMedia({ active, peer, getUserMedia }: UseMediaOptions): UseMediaResult {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<MediaCall | null>(null);
  const trackCallRef = useRef<((call: MediaCall) => void) | null>(null);
  const pendingCallRef = useRef<MediaCall | null>(null);

  const getUserMediaRef = useRef(getUserMedia);
  getUserMediaRef.current = getUserMedia;

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;

    const trackCall = (call: MediaCall) => {
      setError(null);
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

          const pending = pendingCallRef.current;
          if (pending) {
            pendingCallRef.current = null;
            trackCall(pending);
            pending.answer(stream);
          }
        },
        () => {
          if (!cancelled) {
            setError(CAPTURE_ERROR);
          }
        },
      )
      .catch(() => {
        if (!cancelled) {
          setError(CONNECTION_ERROR);
        }
      });

    return () => {
      cancelled = true;
      trackCallRef.current = null;
      pendingCallRef.current = null;
      callRef.current?.close();
      callRef.current = null;
      stopTracks(streamRef.current);
      streamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setError(null);
    };
  }, [active]);

  // A second effect over `peer` rather than folding this into the capture
  // effect: usePeer creates the peer independently of capture completing, so
  // an inbound call can arrive before the local stream is ready. It is held
  // in pendingCallRef and answered once capture resolves.
  useEffect(() => {
    if (!active || !peer) {
      return;
    }

    let cancelled = false;

    peer.on("call", (call) => {
      if (cancelled) {
        return;
      }
      if (callRef.current || pendingCallRef.current) {
        call.close();
        return;
      }
      const trackCall = trackCallRef.current;
      const stream = streamRef.current;
      if (trackCall && stream) {
        trackCall(call);
        call.answer(stream);
      } else {
        pendingCallRef.current = call;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [active, peer]);

  // The guard is "a call is live", not "a call was placed": when the other side
  // reloads, its old call closes and it sends a fresh peer ID, and this side has to
  // be able to place a new call. A once-per-activation flag would leave the video
  // black for the rest of the session.
  const callPeer = useCallback(
    (peerId: string) => {
      const stream = streamRef.current;
      const trackCall = trackCallRef.current;
      if (!peer || !stream || !trackCall || callRef.current) {
        return;
      }

      trackCall(peer.call(peerId, stream));
    },
    [peer],
  );

  return { localStream, remoteStream, error, callPeer };
}
