import { type ReactNode, useEffect } from "react";
import { createBrowserPeer } from "../peer/peerFactory.js";
import { useChat } from "../peer/useChat.js";
import { useMedia } from "../peer/useMedia.js";
import { usePeer } from "../peer/usePeer.js";
import { useSession } from "../session/useSession.js";
import { CallScreenShell } from "./CallScreenShell.js";
import { ChatPanel } from "./ChatPanel.js";
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

  const {
    peer,
    localPeerId,
    error: peerError,
  } = usePeer({
    active,
    createPeer: () => createBrowserPeer(baseUrl),
  });

  const {
    localStream,
    remoteStream,
    error: mediaError,
  } = useMedia({
    active,
    peer,
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true, video: true }),
  });

  const error = peerError ?? mediaError;

  // The patient never calls connectTo: the provider connects and this side
  // takes the peer's 'connection' event, handled entirely inside useChat.
  const {
    transcript,
    isOpen: chatOpen,
    sendMessage,
  } = useChat({
    active,
    peer,
    role: "patient",
    sessionKey,
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
      chat={
        // Chat only exists in ACTIVE (architecture §4.3): the waiting room is
        // presence-only, so no chat affordance renders while `active` is false.
        active && (
          <ChatPanel
            transcript={transcript}
            isOpen={chatOpen}
            localRole="patient"
            onSend={sendMessage}
          />
        )
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
