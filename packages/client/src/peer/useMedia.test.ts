// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GetUserMedia } from "./useMedia.js";
import { useMedia } from "./useMedia.js";
import type { MediaCall, MediaPeer } from "./usePeer.js";

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
  const peer = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    call,
    connect: vi.fn(),
    destroy: vi.fn(),
  } as unknown as MediaPeer;

  return { peer, handlers, call, outbound };
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
  const view = renderHook(
    ({ active, peer }: { active: boolean; peer: MediaPeer | null }) =>
      useMedia({ active, peer, getUserMedia }),
    { initialProps: { active: true, peer: peerFake.peer } },
  );

  await waitFor(() => expect(view.result.current.localStream).toBe(stream));

  return { ...view, stream, tracks, peerFake, getUserMedia };
}

describe("useMedia", () => {
  it("holds no camera or remote stream while inactive", () => {
    const { stream } = createStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));

    const { result } = renderHook(() => useMedia({ active: false, peer: null, getUserMedia }));

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.localStream).toBeNull();
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("captures the local stream once active, independently of the peer being ready", async () => {
    const { stream } = createStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));

    const { result } = renderHook(() => useMedia({ active: true, peer: null, getUserMedia }));

    await waitFor(() => expect(result.current.localStream).toBe(stream));
  });

  it("keeps the camera when the caller passes a fresh getUserMedia identity", async () => {
    const { stream, tracks } = createStream();
    const peerFake = createPeerFake();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    const { result, rerender } = renderHook(
      ({ gum }: { gum: GetUserMedia }) =>
        useMedia({ active: true, peer: peerFake.peer, getUserMedia: gum }),
      { initialProps: { gum: getUserMedia } },
    );

    await waitFor(() => expect(result.current.localStream).toBe(stream));

    const freshGetUserMedia = vi.fn(() => Promise.resolve(createStream().stream));
    rerender({ gum: freshGetUserMedia });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(freshGetUserMedia).not.toHaveBeenCalled();
    for (const track of tracks) {
      expect(track.stop).not.toHaveBeenCalled();
    }
    expect(result.current.localStream).toBe(stream);
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

  it("calls a given peer only once while that call is live, however often callPeer fires", async () => {
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

  it("does not call a peer until the local stream exists, then does", async () => {
    const gum = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => gum.promise);
    const peerFake = createPeerFake();

    const { result } = renderHook(() =>
      useMedia({ active: true, peer: peerFake.peer, getUserMedia }),
    );

    act(() => {
      result.current.callPeer("remote-1");
    });

    expect(peerFake.call).not.toHaveBeenCalled();

    const { stream } = createStream();
    await act(async () => {
      gum.resolve(stream);
    });
    act(() => {
      result.current.callPeer("remote-1");
    });

    expect(peerFake.call).toHaveBeenCalledTimes(1);
    expect(peerFake.call).toHaveBeenCalledWith("remote-1", stream);
  });

  it("does not call a peer that is not yet known", async () => {
    const { stream } = createStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));

    const { result } = renderHook(() => useMedia({ active: true, peer: null, getUserMedia }));
    await waitFor(() => expect(result.current.localStream).toBe(stream));

    act(() => {
      result.current.callPeer("remote-1");
    });
  });

  it("does not call a peer once it has gone inactive", async () => {
    const { result, rerender, peerFake } = await renderActive();

    rerender({ active: false, peer: peerFake.peer });
    act(() => {
      result.current.callPeer("remote-1");
    });

    expect(peerFake.call).not.toHaveBeenCalled();
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

  it("holds an inbound call that arrives before capture resolves and answers once it does", async () => {
    const gum = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => gum.promise);
    const peerFake = createPeerFake();

    renderHook(() => useMedia({ active: true, peer: peerFake.peer, getUserMedia }));

    const inbound = createCall();
    fire(peerFake.handlers, "call", inbound.call);
    expect(inbound.answer).not.toHaveBeenCalled();

    const { stream } = createStream();
    await act(async () => {
      gum.resolve(stream);
    });

    expect(inbound.answer).toHaveBeenCalledWith(stream);
  });

  it("closes an inbound call that arrives while a call is live", async () => {
    const { result, peerFake } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    const outbound = peerFake.outbound[0];
    const inbound = createCall();

    fire(peerFake.handlers, "call", inbound.call);

    expect(inbound.answer).not.toHaveBeenCalled();
    expect(inbound.close).toHaveBeenCalledTimes(1);
    expect(outbound.close).not.toHaveBeenCalled();

    const remote = createStream().stream;
    fire(outbound.handlers, "stream", remote);

    expect(result.current.remoteStream).toBe(remote);
  });

  it("does not place an outbound call once an inbound one was answered", async () => {
    const { result, peerFake } = await renderActive();
    const inbound = createCall();

    fire(peerFake.handlers, "call", inbound.call);
    act(() => {
      result.current.callPeer("remote-1");
    });

    expect(peerFake.call).not.toHaveBeenCalled();
    expect(inbound.close).not.toHaveBeenCalled();
  });

  it("places a new call for a fresh peer id once the live call has closed", async () => {
    const { result, peerFake, stream } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    fire(peerFake.outbound[0].handlers, "close");

    act(() => {
      result.current.callPeer("remote-2");
    });

    expect(peerFake.call).toHaveBeenCalledTimes(2);
    expect(peerFake.call).toHaveBeenLastCalledWith("remote-2", stream);

    const remote = createStream().stream;
    fire(peerFake.outbound[1].handlers, "stream", remote);

    expect(result.current.remoteStream).toBe(remote);
  });

  it("answers an inbound call that arrives once the live call has closed", async () => {
    const { result, peerFake, stream } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    fire(peerFake.outbound[0].handlers, "close");

    const inbound = createCall();
    fire(peerFake.handlers, "call", inbound.call);

    expect(inbound.answer).toHaveBeenCalledWith(stream);
    expect(inbound.close).not.toHaveBeenCalled();

    const remote = createStream().stream;
    fire(inbound.handlers, "stream", remote);

    expect(result.current.remoteStream).toBe(remote);
  });

  it("reports a capture failure", async () => {
    const getUserMedia = vi.fn(() => Promise.reject(new Error("NotAllowedError")));

    const { result } = renderHook(() => useMedia({ active: true, peer: null, getUserMedia }));

    await waitFor(() =>
      expect(result.current.error).toBe("Could not access the camera or microphone."),
    );
    expect(result.current.localStream).toBeNull();
  });

  it("reports a call error without dropping the local stream", async () => {
    const { result, peerFake, stream, tracks } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    fire(peerFake.outbound[0].handlers, "error", new Error("negotiation"));

    expect(result.current.error).toBe("The video connection failed.");
    expect(result.current.localStream).toBe(stream);
    for (const track of tracks) {
      expect(track.stop).not.toHaveBeenCalled();
    }
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

  it("clears a stale call-ended error once a new call is tracked, via an inbound call", async () => {
    const { result, peerFake } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    fire(peerFake.outbound[0].handlers, "close");
    expect(result.current.error).toBe("The video call ended.");

    const inbound = createCall();
    fire(peerFake.handlers, "call", inbound.call);

    expect(result.current.error).toBeNull();
  });

  it("clears a stale call-ended error once a new call is tracked, via callPeer", async () => {
    const { result, peerFake } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    fire(peerFake.outbound[0].handlers, "close");
    expect(result.current.error).toBe("The video call ended.");

    act(() => {
      result.current.callPeer("remote-2");
    });

    expect(result.current.error).toBeNull();
  });

  it("does not clear the error when an inbound call is closed and never tracked", async () => {
    const { result, peerFake } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    fire(peerFake.outbound[0].handlers, "error", new Error("negotiation"));
    expect(result.current.error).toBe("The video connection failed.");

    const inbound = createCall();
    fire(peerFake.handlers, "call", inbound.call);

    expect(inbound.close).toHaveBeenCalledTimes(1);
    expect(inbound.answer).not.toHaveBeenCalled();
    expect(result.current.error).toBe("The video connection failed.");
  });

  it("closes the live call and stops every track when it goes inactive", async () => {
    const { result, rerender, peerFake, tracks } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    const outbound = peerFake.outbound[0];

    rerender({ active: false, peer: peerFake.peer });

    expect(outbound.close).toHaveBeenCalledTimes(1);
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(result.current.localStream).toBeNull();
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("tears down in the same order on unmount", async () => {
    const { result, unmount, peerFake, tracks } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    const outbound = peerFake.outbound[0];

    unmount();

    expect(outbound.close).toHaveBeenCalledTimes(1);
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores call events once teardown has begun", async () => {
    const { result, rerender, peerFake } = await renderActive();

    act(() => {
      result.current.callPeer("remote-1");
    });
    const outbound = peerFake.outbound[0];
    outbound.close.mockImplementation(() => {
      outbound.handlers.get("close")?.(undefined as never);
    });

    rerender({ active: false, peer: peerFake.peer });

    expect(result.current.error).toBeNull();
    expect(result.current.remoteStream).toBeNull();

    fire(outbound.handlers, "close");
    fire(outbound.handlers, "stream", createStream().stream);
    fire(peerFake.handlers, "call", createCall().call);

    expect(result.current.error).toBeNull();
    expect(result.current.remoteStream).toBeNull();
  });

  it("stops a stream that arrives after it went inactive, and does not call the peer", async () => {
    const gum = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => gum.promise);
    const peerFake = createPeerFake();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useMedia({ active, peer: peerFake.peer, getUserMedia }),
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
    expect(peerFake.call).not.toHaveBeenCalled();
  });
});
