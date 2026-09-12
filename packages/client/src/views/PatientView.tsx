import { useSession } from "../session/useSession.js";

export interface PatientViewProps {
  baseUrl: string;
  sessionKey: string;
}

export function PatientView({ baseUrl, sessionKey }: PatientViewProps) {
  const { connection, leave } = useSession(baseUrl, sessionKey);

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
    </div>
  );
}
