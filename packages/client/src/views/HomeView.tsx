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
    <div className="flex h-screen w-full items-center justify-center bg-neutral-950 text-white">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg bg-neutral-900 p-8">
        <h1 className="text-xl font-semibold">Start a consultation</h1>
        <button
          type="button"
          onClick={createSession}
          disabled={state.phase === "creating"}
          className="rounded bg-blue-600 px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
        >
          Create session
        </button>
        {state.phase === "error" && <p role="alert">{state.message}</p>}
        {state.phase === "created" && (
          <ul className="flex flex-col gap-3">
            <li>
              <p className="text-sm text-neutral-400">Provider link</p>
              <a
                href={state.session.providerUrl}
                className="block break-all rounded bg-neutral-800 px-3 py-2 text-sm text-white underline-offset-2 hover:underline"
              >
                {state.session.providerUrl}
              </a>
            </li>
            <li>
              <p className="text-sm text-neutral-400">Patient link</p>
              <a
                href={state.session.patientUrl}
                className="block break-all rounded bg-neutral-800 px-3 py-2 text-sm text-white underline-offset-2 hover:underline"
              >
                {state.session.patientUrl}
              </a>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
