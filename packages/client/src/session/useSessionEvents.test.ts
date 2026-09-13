// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionEvents } from "./useSessionEvents.js";

const BASE_URL = "https://example.test";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSessionEvents", () => {
  it("stays idle and does not fetch while disabled", () => {
    const { result } = renderHook(() => useSessionEvents(BASE_URL, "pk", false));

    expect(result.current).toEqual({ status: "idle" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads events once enabled", async () => {
    const events = [
      { id: 1, type: "session_created", occurredAt: "2024-01-01T00:00:00.000Z", data: null },
      {
        id: 2,
        type: "session_ended",
        occurredAt: "2024-01-01T00:05:00.000Z",
        data: { reason: "provider_ended" },
      },
    ];
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { events }));

    const { result } = renderHook(() => useSessionEvents(BASE_URL, "pk", true));

    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current).toEqual({ status: "loaded", events }));

    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/api/sessions/pk/events`);
  });

  it("reports the server's error message on failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, { code: "unknown_key", message: "no session has that key" }),
    );

    const { result } = renderHook(() => useSessionEvents(BASE_URL, "pk", true));

    await waitFor(() =>
      expect(result.current).toEqual({ status: "error", message: "no session has that key" }),
    );
  });

  it("does not fetch again on re-render once loaded", async () => {
    const events = [
      { id: 1, type: "session_created", occurredAt: "2024-01-01T00:00:00.000Z", data: null },
    ];
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { events }));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSessionEvents(BASE_URL, "pk", enabled),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current).toEqual({ status: "loaded", events }));

    rerender({ enabled: true });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores a response that resolves after the hook is disabled again", async () => {
    let resolveFetch!: (res: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSessionEvents(BASE_URL, "pk", enabled),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });
    resolveFetch(jsonResponse(200, { events: [] }));

    await new Promise((r) => setTimeout(r, 0));

    expect(result.current).toEqual({ status: "loading" });
  });
});
