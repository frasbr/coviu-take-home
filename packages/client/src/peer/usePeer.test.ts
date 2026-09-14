// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaPeer } from "./usePeer.js";
import { usePeer } from "./usePeer.js";

type Handler = (payload?: never) => void;

function createPeerFake() {
  const handlers = new Map<string, Handler>();
  const destroy = vi.fn();
  const peer = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    call: vi.fn(),
    connect: vi.fn(),
    destroy,
  } as unknown as MediaPeer;

  return { peer, handlers, destroy };
}

function fire(handlers: Map<string, Handler>, event: string, payload?: unknown) {
  act(() => {
    handlers.get(event)?.(payload as never);
  });
}

describe("usePeer", () => {
  it("creates no peer while inactive", () => {
    const createPeer = vi.fn(() => createPeerFake().peer);

    const { result } = renderHook(() => usePeer({ active: false, createPeer }));

    expect(createPeer).not.toHaveBeenCalled();
    expect(result.current.peer).toBeNull();
    expect(result.current.localPeerId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("creates a peer immediately once active and hands it out", () => {
    const peerFake = createPeerFake();
    const createPeer = vi.fn(() => peerFake.peer);

    const { result } = renderHook(() => usePeer({ active: true, createPeer }));

    expect(createPeer).toHaveBeenCalledTimes(1);
    expect(result.current.peer).toBe(peerFake.peer);
  });

  it("surfaces the peer id from the open event", () => {
    const peerFake = createPeerFake();
    const createPeer = vi.fn(() => peerFake.peer);

    const { result } = renderHook(() => usePeer({ active: true, createPeer }));
    fire(peerFake.handlers, "open", "peer-abc");

    expect(result.current.localPeerId).toBe("peer-abc");
  });

  it("reports a peer error", () => {
    const peerFake = createPeerFake();
    const createPeer = vi.fn(() => peerFake.peer);

    const { result } = renderHook(() => usePeer({ active: true, createPeer }));
    fire(peerFake.handlers, "error", new Error("network"));

    expect(result.current.error).toBe("The video connection failed.");
  });

  it("reports a peer that fails to be created as a connection error", () => {
    const createPeer = vi.fn((): MediaPeer => {
      throw new Error("no websocket");
    });

    const { result } = renderHook(() => usePeer({ active: true, createPeer }));

    expect(result.current.error).toBe("The video connection failed.");
    expect(result.current.peer).toBeNull();
  });

  it("destroys the peer and clears state on deactivation", () => {
    const peerFake = createPeerFake();
    const createPeer = vi.fn(() => peerFake.peer);

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => usePeer({ active, createPeer }),
      { initialProps: { active: true } },
    );
    fire(peerFake.handlers, "open", "peer-abc");

    rerender({ active: false });

    expect(peerFake.destroy).toHaveBeenCalledTimes(1);
    expect(result.current.peer).toBeNull();
    expect(result.current.localPeerId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("destroys the peer on unmount", () => {
    const peerFake = createPeerFake();
    const createPeer = vi.fn(() => peerFake.peer);

    const { unmount } = renderHook(() => usePeer({ active: true, createPeer }));

    unmount();

    expect(peerFake.destroy).toHaveBeenCalledTimes(1);
  });

  it("ignores late events from a peer that has already been torn down", () => {
    const peerFake = createPeerFake();
    const createPeer = vi.fn(() => peerFake.peer);

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => usePeer({ active, createPeer }),
      { initialProps: { active: true } },
    );

    rerender({ active: false });

    fire(peerFake.handlers, "open", "late-id");
    fire(peerFake.handlers, "error", new Error("late"));

    expect(result.current.localPeerId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("creates a fresh peer for each activation", () => {
    const firstPeer = createPeerFake();
    const secondPeer = createPeerFake();
    const createPeer = vi
      .fn()
      .mockReturnValueOnce(firstPeer.peer)
      .mockReturnValueOnce(secondPeer.peer);

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => usePeer({ active, createPeer }),
      { initialProps: { active: true } },
    );
    rerender({ active: false });
    rerender({ active: true });

    expect(createPeer).toHaveBeenCalledTimes(2);
    expect(firstPeer.destroy).toHaveBeenCalledTimes(1);
    expect(secondPeer.destroy).not.toHaveBeenCalled();
  });
});
