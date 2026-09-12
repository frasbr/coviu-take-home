import { useSession } from "../session/useSession.js";

export interface ProviderViewProps {
  baseUrl: string;
  sessionKey: string;
}

export function ProviderView({ baseUrl, sessionKey }: ProviderViewProps) {
  const { connection, admit, endSession } = useSession(baseUrl, sessionKey);

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
    </div>
  );
}
