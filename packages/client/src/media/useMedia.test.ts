// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaCall, MediaPeer } from "./useMedia.js";
import { useMedia } from "./useMedia.js";

type Handler = (payload?: never) => void;

function createStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
}

function createCall() {
  const handlers = new Map<string, Handler>();
  const answer = vi.fn();
  const close = vi.fn();
  const call = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    answer,
    close,
  } as unknown as MediaCall;

  return { call, handlers, answer, close };
}

type FakeCall = ReturnType<typeof createCall>;

function createPeerFake() {
  const handlers = new Map<string, Handler>();
  const outbound: FakeCall[] = [];
  const call = vi.fn((_peerId: string, _stream: MediaStream) => {
    const fake = createCall();
    outbound.push(fake);
    return fake.call;
  });
  const destroy = vi.fn();
  const peer = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    call,
    destroy,
  } as unknown as MediaPeer;

  return { peer, handlers, call, destroy, outbound };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fire(handlers: Map<string, Handler>, event: string, payload?: unknown) {
  act(() => {
    handlers.get(event)?.(payload as never);
  });
}

async function renderActive() {
  const { stream, tracks } = createStream();
  const peerFake = createPeerFake();
  const getUserMedia = vi.fn(() => Promise.resolve(stream));
  const createPeer = vi.fn(() => peerFake.peer);
  const view = renderHook(
    ({ active }: { active: boolean }) => useMedia({ active, createPeer, getUserMedia }),
    { initialProps: { active: true } },
  );

  await waitFor(() => expect(view.result.current.localStream).toBe(stream));

  return { ...view, stream, tracks, peerFake, getUserMedia, createPeer };
}

describe("useMedia", () => {
  it("holds no camera, microphone or peer while inactive", () => {
    const { stream } = createStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    const createPeer = vi.fn(() => createPeerFake().peer);

    const { result } = renderHook(() => useMedia({ active: false, createPeer, getUserMedia }));

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(createPeer).not.toHaveBeenCalled();
    expect(result.current.localStream).toBeNull();
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.localPeerId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("acquires the local stream before it creates the peer", async () => {
    const { stream } = createStream();
    const gum = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => gum.promise);
    const peerFake = createPeerFake();
    const createPeer = vi.fn(() => peerFake.peer);

    const { result } = renderHook(() => useMedia({ active: true, createPeer, getUserMedia }));

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(createPeer).not.toHaveBeenCalled();

    await act(async () => {
      gum.resolve(stream);
    });

    expect(createPeer).toHaveBeenCalledTimes(1);
    expect(result.current.localStream).toBe(stream);
  });

  it("surfaces the peer id from the peer's open event", async () => {
    const { result, peerFake } = await renderActive();

    fire(peerFake.handlers, "open", "peer-abc");

    expect(result.current.localPeerId).toBe("peer-abc");
  });

  it("calls a remote peer with the local stream and surfaces the remote stream", async () => {
    const { result, peerFake, stream } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });

    expect(peerFake.call).toHaveBeenCalledTimes(1);
    expect(peerFake.call).toHaveBeenCalledWith("remote-1", stream);

    const remote = createStream().stream;
    fire(peerFake.outbound[0].handlers, "stream", remote);

    expect(result.current.remoteStream).toBe(remote);
  });

  it("calls a given peer only once, however often callPeer fires", async () => {
    const { result, peerFake } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
      result.current.callPeer("remote-1");
    });
    act(() => {
      result.current.callPeer("remote-1");
      result.current.callPeer("remote-2");
    });

    expect(peerFake.call).toHaveBeenCalledTimes(1);
    expect(peerFake.call).toHaveBeenCalledWith("remote-1", expect.anything());
  });

  it("does not call a peer before the local stream exists", async () => {
    const gum = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => gum.promise);
    const peerFake = createPeerFake();
    const createPeer = vi.fn(() => peerFake.peer);

    const { result } = renderHook(() => useMedia({ active: true, createPeer, getUserMedia }));

    act(() => {
      result.current.callPeer("remote-1");
    });

    expect(peerFake.call).not.toHaveBeenCalled();

    const { stream } = createStream();
    await act(async () => {
      gum.resolve(stream);
    });
  });

  it("answers an inbound call with the local stream and surfaces the remote stream", async () => {
    const { result, peerFake, stream } = await renderActive();
    const inbound = createCall();

    fire(peerFake.handlers, "call", inbound.call);

    expect(inbound.answer).toHaveBeenCalledTimes(1);
    expect(inbound.answer).toHaveBeenCalledWith(stream);

    const remote = createStream().stream;
    fire(inbound.handlers, "stream", remote);

    expect(result.current.remoteStream).toBe(remote);
  });

  it("reports a capture failure and never creates a peer", async () => {
    const getUserMedia = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    const createPeer = vi.fn(() => createPeerFake().peer);

    const { result } = renderHook(() => useMedia({ active: true, createPeer, getUserMedia }));

    await waitFor(() =>
      expect(result.current.error).toBe("Could not access the camera or microphone."),
    );
    expect(createPeer).not.toHaveBeenCalled();
    expect(result.current.localStream).toBeNull();
  });

  it("reports a peer error without dropping the local stream", async () => {
    const { result, peerFake, stream } = await renderActive();

    fire(peerFake.handlers, "error", new Error("network"));

    expect(result.current.error).toBe("The video connection failed.");
    expect(result.current.localStream).toBe(stream);
    expect(peerFake.destroy).not.toHaveBeenCalled();
  });

  it("reports a call error without dropping the local stream", async () => {
    const { result, peerFake, stream } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    fire(peerFake.outbound[0].handlers, "error", new Error("negotiation"));

    expect(result.current.error).toBe("The video connection failed.");
    expect(result.current.localStream).toBe(stream);
  });

  it("clears the remote stream and reports the end when a live call closes", async () => {
    const { result, peerFake } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    const outbound = peerFake.outbound[0];
    fire(outbound.handlers, "stream", createStream().stream);
    expect(result.current.remoteStream).not.toBeNull();

    fire(outbound.handlers, "close");

    expect(result.current.remoteStream).toBeNull();
    expect(result.current.error).toBe("The video call ended.");
  });

  it("stops every track, destroys the peer and clears state when it goes inactive", async () => {
    const { result, rerender, peerFake, tracks } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    const outbound = peerFake.outbound[0];

    rerender({ active: false });

    expect(outbound.close).toHaveBeenCalledTimes(1);
    expect(peerFake.destroy).toHaveBeenCalledTimes(1);
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(result.current.localStream).toBeNull();
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.localPeerId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("tears down the same way on unmount", async () => {
    const { unmount, peerFake, tracks } = await renderActive();

    unmount();

    expect(peerFake.destroy).toHaveBeenCalledTimes(1);
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("stops a stream that arrives after it went inactive, and creates no peer", async () => {
    const gum = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => gum.promise);
    const createPeer = vi.fn(() => createPeerFake().peer);
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useMedia({ active, createPeer, getUserMedia }),
      { initialProps: { active: true } },
    );

    rerender({ active: false });

    const { stream, tracks } = createStream();
    await act(async () => {
      gum.resolve(stream);
    });

    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(createPeer).not.toHaveBeenCalled();
  });
});
