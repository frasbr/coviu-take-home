import { useEffect } from "react";
import { createBrowserPeer } from "../media/peerFactory.js";
import { useMedia } from "../media/useMedia.js";
import { useSession } from "../session/useSession.js";
import { useSessionEvents } from "../session/useSessionEvents.js";
import { VideoPanel } from "./VideoPanel.js";

export interface ProviderViewProps {
  baseUrl: string;
  sessionKey: string;
}

export function ProviderView({ baseUrl, sessionKey }: ProviderViewProps) {
  const { connection, remotePeerId, admit, endSession, sendPeerId } = useSession(
    baseUrl,
    sessionKey,
  );

  // Derived from the session state alone: the two connections fail independently,
  // so a socket reconnect must not tear a live call down.
  const active = connection.status === "connected" && connection.state.state === "ACTIVE";
  const ended = connection.status === "connected" && connection.state.state === "ENDED";

  const eventsResult = useSessionEvents(baseUrl, sessionKey, ended);

  const { localStream, remoteStream, localPeerId, error, callPeer } = useMedia({
    active,
    createPeer: () => createBrowserPeer(baseUrl),
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true, video: true }),
  });

  useEffect(() => {
    if (localPeerId) {
      sendPeerId(localPeerId);
    }
  }, [localPeerId, sendPeerId]);

  // Depending on both ids means the effect re-runs on the render where each is
  // known, so either arrival order reaches a live call.
  useEffect(() => {
    if (remotePeerId && localPeerId) {
      callPeer(remotePeerId);
    }
  }, [remotePeerId, localPeerId, callPeer]);

  if (connection.status === "resolving") {
    return <p>Loading session…</p>;
  }

  if (connection.status === "error") {
    return (
      <div role="alert">
        <h1>Session unavailable</h1>
        <p>{connection.error.message}</p>
      </div>
    );
  }

  const { state } = connection;

  return (
    <div>
      <h1>Provider</h1>
      <p>State: {state.state}</p>
      <p>Patient: {state.presence.patient ? "connected" : "not connected"}</p>
      {state.state === "WAITING" && (
        <button type="button" onClick={admit}>
          Admit patient
        </button>
      )}
      {state.state !== "ENDED" && (
        <button type="button" onClick={endSession}>
          End session
        </button>
      )}
      {state.state === "ENDED" && (
        <section aria-label="Session history">
          <h2>Session history</h2>
          {eventsResult.status === "loading" && <p>Loading session history…</p>}
          {eventsResult.status === "error" && <p role="alert">{eventsResult.message}</p>}
          {eventsResult.status === "loaded" && (
            <ul>
              {eventsResult.events.map((event) => (
                <li key={event.id}>
                  {new Date(event.occurredAt).toLocaleString()} — {event.type}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <VideoPanel
        localStream={localStream}
        remoteStream={remoteStream}
        error={error}
        localRole="Provider"
        remoteRole="Patient"
      />
    </div>
  );
}
