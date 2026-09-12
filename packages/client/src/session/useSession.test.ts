// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "./useSession.js";

const BASE_URL = "https://example.test";

const handlers = new Map<string, (payload: unknown) => void>();
const emit = vi.fn();
const disconnect = vi.fn();
const on = vi.fn((event: string, handler: (payload: unknown) => void) => {
  handlers.set(event, handler);
});

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({ on, emit, disconnect })),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  handlers.clear();
  emit.mockClear();
  disconnect.mockClear();
  on.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSession", () => {
  it("starts resolving, then connects and reflects session:state", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "CREATED" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    expect(result.current.connection).toEqual({ status: "resolving" });

    await waitFor(() => expect(handlers.has("session:state")).toBe(true));

    const statePayload = {
      state: "WAITING",
      since: "2026-01-01T00:00:00.000Z",
      reason: null,
      presence: { provider: true, patient: true },
    };
    handlers.get("session:state")?.(statePayload);

    await waitFor(() =>
      expect(result.current.connection).toEqual({
        status: "connected",
        role: "provider",
        state: statePayload,
      }),
    );
  });

  it("reports an error when the key does not resolve", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, { code: "unknown_key", message: "no session has that key" }),
    );

    const { result } = renderHook(() => useSession(BASE_URL, "nope"));

    await waitFor(() =>
      expect(result.current.connection).toEqual({
        status: "error",
        error: { code: "unknown_key", message: "no session has that key" },
      }),
    );
  });

  it("treats a connect_error as terminal, using the server's error data", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "patient", status: "CREATED" }));

    const { result } = renderHook(() => useSession(BASE_URL, "wk"));
    await waitFor(() => expect(handlers.has("connect_error")).toBe(true));

    const err = Object.assign(new Error("refused"), {
      data: { code: "session_ended", message: "this session has ended" },
    });
    handlers.get("connect_error")?.(err);

    await waitFor(() =>
      expect(result.current.connection).toEqual({
        status: "error",
        error: { code: "session_ended", message: "this session has ended" },
      }),
    );
  });

  it("emits admit, end-session, and patient:leave on the one socket", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "WAITING" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.size).toBeGreaterThan(0));

    result.current.admit();
    result.current.endSession();
    result.current.leave();

    expect(emit).toHaveBeenCalledWith("admit", {});
    expect(emit).toHaveBeenCalledWith("end-session", {});
    expect(emit).toHaveBeenCalledWith("patient:leave", {});
  });

  it("disconnects the socket on unmount", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "WAITING" }));

    const { unmount } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.size).toBeGreaterThan(0));

    unmount();

    expect(disconnect).toHaveBeenCalled();
  });
});
