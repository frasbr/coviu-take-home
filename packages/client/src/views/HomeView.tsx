import type { CreateSessionResponse } from "@coviu/shared";
import { useState } from "react";
import { HttpError, createHttpClient } from "../session/httpClient.js";

export interface HomeViewProps {
  baseUrl: string;
}

type CreateState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "created"; session: CreateSessionResponse }
  | { phase: "error"; message: string };

export function HomeView({ baseUrl }: HomeViewProps) {
  const [state, setState] = useState<CreateState>({ phase: "idle" });

  const createSession = () => {
    setState({ phase: "creating" });
    createHttpClient(baseUrl)
      .createSession()
      .then((session) => setState({ phase: "created", session }))
      .catch((err: unknown) => {
        setState({
          phase: "error",
          message: err instanceof HttpError ? err.payload.message : "could not create session",
        });
      });
  };

  return (
    <div>
      <h1>Start a consultation</h1>
      <button type="button" onClick={createSession} disabled={state.phase === "creating"}>
        Create session
      </button>
      {state.phase === "error" && <p role="alert">{state.message}</p>}
      {state.phase === "created" && (
        <ul>
          <li>
            Provider link: <a href={state.session.providerUrl}>{state.session.providerUrl}</a>
          </li>
          <li>
            Patient link: <a href={state.session.patientUrl}>{state.session.patientUrl}</a>
          </li>
        </ul>
      )}
    </div>
  );
}
