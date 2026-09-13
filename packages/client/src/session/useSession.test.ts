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

  it("ignores a connect_error that arrives after the socket has connected", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "CREATED" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.has("connect")).toBe(true));

    handlers.get("connect")?.(undefined);

    const statePayload = {
      state: "ACTIVE",
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

    const err = new Error("transport close");
    handlers.get("connect_error")?.(err);

    expect(result.current.connection).toEqual({
      status: "connected",
      role: "provider",
      state: statePayload,
    });
  });

  it("treats a connect_error carrying a payload as terminal even after connecting", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "CREATED" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.has("connect")).toBe(true));

    handlers.get("connect")?.(undefined);

    const statePayload = {
      state: "DISCONNECTED_GRACE",
      since: "2026-01-01T00:00:00.000Z",
      reason: null,
      presence: { provider: false, patient: true },
    };
    handlers.get("session:state")?.(statePayload);

    await waitFor(() =>
      expect(result.current.connection).toEqual({
        status: "connected",
        role: "provider",
        state: statePayload,
      }),
    );

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

  it("still treats a server-sent error as terminal once connected", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "CREATED" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.has("connect")).toBe(true));

    handlers.get("connect")?.(undefined);

    const statePayload = {
      state: "ACTIVE",
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

    handlers.get("error")?.({ code: "session_ended", message: "this session has ended" });

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

  it("is null before any peer:id arrives", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "WAITING" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.size).toBeGreaterThan(0));

    expect(result.current.remotePeerId).toBeNull();
  });

  it("latches a peer:id that arrives before session:state", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "WAITING" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.has("peer:id")).toBe(true));

    handlers.get("peer:id")?.({ peerId: "abc" });

    await waitFor(() => expect(result.current.remotePeerId).toBe("abc"));

    expect(result.current.connection).toEqual({ status: "resolving" });
  });

  it("replaces the remote peer id when a second peer:id arrives", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "WAITING" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.has("peer:id")).toBe(true));

    handlers.get("peer:id")?.({ peerId: "abc" });
    await waitFor(() => expect(result.current.remotePeerId).toBe("abc"));

    handlers.get("peer:id")?.({ peerId: "def" });
    await waitFor(() => expect(result.current.remotePeerId).toBe("def"));
  });

  it("emits peer:id on sendPeerId", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "WAITING" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.size).toBeGreaterThan(0));

    result.current.sendPeerId("abc");

    expect(emit).toHaveBeenCalledWith("peer:id", { peerId: "abc" });
  });

  it("sendPeerId before the socket exists is a silent no-op", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));

    expect(result.current.connection).toEqual({ status: "resolving" });
    expect(() => result.current.sendPeerId("abc")).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it("keeps a stable identity for admit and sendPeerId across a re-render", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "WAITING" }));

    const { result } = renderHook(() => useSession(BASE_URL, "pk"));
    await waitFor(() => expect(handlers.has("session:state")).toBe(true));

    const admit = result.current.admit;
    const sendPeerId = result.current.sendPeerId;

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

    expect(result.current.admit).toBe(admit);
    expect(result.current.sendPeerId).toBe(sendPeerId);
  });
});
