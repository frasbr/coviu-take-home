import { useEffect } from "react";
import { createBrowserPeer } from "../media/peerFactory.js";
import { useMedia } from "../media/useMedia.js";
import { useSession } from "../session/useSession.js";
import { VideoPanel } from "./VideoPanel.js";

export interface PatientViewProps {
  baseUrl: string;
  sessionKey: string;
}

export function PatientView({ baseUrl, sessionKey }: PatientViewProps) {
  const { connection, leave, sendPeerId } = useSession(baseUrl, sessionKey);

  // Derived from the session state alone: the two connections fail independently,
  // so a socket reconnect must not tear a live call down.
  const active = connection.status === "connected" && connection.state.state === "ACTIVE";

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
      <h1>Patient</h1>
      <p>State: {state.state}</p>
      {state.state !== "ENDED" && (
        <button type="button" onClick={leave}>
          Leave
        </button>
      )}
      <VideoPanel localStream={localStream} remoteStream={remoteStream} error={error} />
    </div>
  );
}
