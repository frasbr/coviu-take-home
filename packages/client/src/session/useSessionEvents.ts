import type { Event } from "@coviu/shared";
import { useEffect, useState } from "react";
import { HttpError, createHttpClient } from "./httpClient.js";

export type SessionEventsResult =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; events: Event[] }
  | { status: "error"; message: string };

/**
 * Fetches the session's event log over HTTP. Separate from `useSession` because
 * it is a one-shot read, not part of the live socket state.
 */
export function useSessionEvents(
  baseUrl: string,
  providerKey: string,
  enabled: boolean,
): SessionEventsResult {
  const [result, setResult] = useState<SessionEventsResult>({ status: "idle" });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    setResult({ status: "loading" });

    createHttpClient(baseUrl)
      .getSessionEvents(providerKey)
      .then((response) => {
        if (!cancelled) {
          setResult({ status: "loaded", events: response.events });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setResult({
          status: "error",
          message:
            err instanceof HttpError ? err.payload.message : "could not load the session history",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [baseUrl, providerKey, enabled]);

  return result;
}
