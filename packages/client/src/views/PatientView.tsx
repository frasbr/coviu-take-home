import { useEffect, type ReactNode } from "react";
import { createBrowserPeer } from "../media/peerFactory.js";
import { useMedia } from "../media/useMedia.js";
import { useSession } from "../session/useSession.js";
import { CallScreenShell } from "./CallScreenShell.js";
import { ControlBar } from "./ControlBar.js";
import { VideoPanel } from "./VideoPanel.js";

export interface PatientViewProps {
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

export function PatientView({ baseUrl, sessionKey }: PatientViewProps) {
  const { connection, leave, sendPeerId } = useSession(baseUrl, sessionKey);

  // Derived from the session state alone: the two connections fail independently,
  // so a socket reconnect must not tear a live call down.
  const active =
    connection.status === "connected" &&
    connection.state.state === "ACTIVE" &&
    connection.state.presence.patient;

  const { localStream, remoteStream, localPeerId, error } = useMedia({
    active,
    createPeer: () => createBrowserPeer(baseUrl),
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true, video: true }),
  });

  // The patient only ever publishes its own peer id. The provider places the
  // call and useMedia answers it, so there is no inbound half here.
  useEffect(() => {
    if (localPeerId) {
      sendPeerId(localPeerId);
    }
  }, [localPeerId, sendPeerId]);

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
        <p>The session has ended.</p>
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
          localRole="Patient"
          remoteRole="Provider"
        />
      }
      bar={
        <ControlBar
          status={<p>State: {state.state}</p>}
          actions={
            <button type="button" onClick={leave}>
              Leave
            </button>
          }
        />
      }
    />
  );
}
