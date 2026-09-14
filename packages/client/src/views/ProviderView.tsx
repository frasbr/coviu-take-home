import { useEffect, type ReactNode } from "react";
import { createBrowserPeer } from "../media/peerFactory.js";
import { useMedia } from "../media/useMedia.js";
import { useSession } from "../session/useSession.js";
import { useSessionEvents } from "../session/useSessionEvents.js";
import type { SessionEventsResult } from "../session/useSessionEvents.js";
import { CallScreenShell } from "./CallScreenShell.js";
import { ControlBar } from "./ControlBar.js";
import { VideoPanel } from "./VideoPanel.js";

export interface ProviderViewProps {
  baseUrl: string;
  sessionKey: string;
}

function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-neutral-950 text-white">
      {children}
    </div>
  );
}

function SessionHistory({ eventsResult }: { eventsResult: SessionEventsResult }) {
  return (
    <section
      aria-label="Session history"
      className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-neutral-900 p-6"
    >
      <h2 className="mb-4 text-lg font-semibold">Session history</h2>
      <div className="min-h-0 overflow-y-auto">
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
      </div>
    </section>
  );
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
    return (
      <CenteredScreen>
        <p>Loading session…</p>
      </CenteredScreen>
    );
  }

  if (connection.status === "error") {
    return (
      <CenteredScreen>
        <div role="alert">
          <h1>Session unavailable</h1>
          <p>{connection.error.message}</p>
        </div>
      </CenteredScreen>
    );
  }

  const { state } = connection;

  if (state.state === "ENDED") {
    return (
      <CenteredScreen>
        <SessionHistory eventsResult={eventsResult} />
      </CenteredScreen>
    );
  }

  return (
    <CallScreenShell
      video={
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          error={error}
          localRole="Provider"
          remoteRole="Patient"
        />
      }
      bar={
        <ControlBar
          status={
            <>
              <p>State: {state.state}</p>
              <p>Patient: {state.presence.patient ? "connected" : "not connected"}</p>
            </>
          }
          actions={
            <>
              {state.state === "WAITING" && (
                <button type="button" onClick={admit}>
                  Admit patient
                </button>
              )}
              <button
                type="button"
                onClick={endSession}
                className="bg-red-600 hover:bg-red-700 text-white rounded px-3 py-1.5"
              >
                End session
              </button>
            </>
          }
        />
      }
    />
  );
}
