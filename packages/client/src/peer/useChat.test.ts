// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredTranscript } from "./chatStorage.js";
import type { ChatMessage } from "./mergeTranscript.js";
import { useChat } from "./useChat.js";
import type { MediaChannel, MediaPeer } from "./usePeer.js";

type Handler = (payload?: never) => void;

function createChannel() {
  const handlers = new Map<string, Handler>();
  const send = vi.fn();
  const close = vi.fn();
  const channel = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    send,
    close,
  } as unknown as MediaChannel;

  return { channel, handlers, send, close };
}

type FakeChannel = ReturnType<typeof createChannel>;

function createPeerFake() {
  const handlers = new Map<string, Handler>();
  const outbound: FakeChannel[] = [];
  const connect = vi.fn((_peerId: string) => {
    const fake = createChannel();
    outbound.push(fake);
    return fake.channel;
  });
  const peer = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    call: vi.fn(),
    connect,
    destroy: vi.fn(),
  } as unknown as MediaPeer;

  return { peer, handlers, connect, outbound };
}

function fire(handlers: Map<string, Handler>, event: string, payload?: unknown) {
  act(() => {
    handlers.get(event)?.(payload as never);
  });
}

function openChannel(fake: FakeChannel) {
  fire(fake.handlers, "open");
}

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    sender: "patient",
    text: "hi",
    sentAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("useChat", () => {
  it("starts with an empty transcript and a closed channel", () => {
    const { result } = renderHook(() =>
      useChat({ active: true, peer: null, role: "provider", sessionKey: "session-1" }),
    );

    expect(result.current.transcript).toEqual([]);
    expect(result.current.isOpen).toBe(false);
  });

  it("connects to a remote peer id and opens the channel", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
    });

    expect(peerFake.connect).toHaveBeenCalledWith("remote-1");
    expect(result.current.isOpen).toBe(false);

    openChannel(peerFake.outbound[0]);

    expect(result.current.isOpen).toBe(true);
  });

  it("takes an inbound connection and opens the channel", () => {
    const peerFake = createPeerFake();
    renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "patient", sessionKey: "session-1" }),
    );

    const inbound = createChannel();
    fire(peerFake.handlers, "connection", inbound.channel);
    openChannel(inbound);

    expect(inbound.close).not.toHaveBeenCalled();
  });

  it("sends the full local transcript once the channel opens", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
    });
    const outbound = peerFake.outbound[0];

    act(() => {
      result.current.sendMessage("hello");
    });
    // A message sent before the channel opens is refused, so nothing queued.
    expect(outbound.send).not.toHaveBeenCalled();

    openChannel(outbound);

    expect(outbound.send).toHaveBeenCalledWith([]);
  });

  it("refuses to send while the channel is not open, and does not queue it", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.sendMessage("too early");
    });

    expect(result.current.transcript).toEqual([]);

    act(() => {
      result.current.connectTo("remote-1");
    });
    openChannel(peerFake.outbound[0]);

    expect(result.current.transcript).toEqual([]);
  });

  it("adds a sent message to the local transcript and sends it on the wire", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
    });
    const outbound = peerFake.outbound[0];
    openChannel(outbound);
    outbound.send.mockClear();

    act(() => {
      result.current.sendMessage("hello");
    });

    expect(result.current.transcript).toHaveLength(1);
    expect(result.current.transcript[0]).toMatchObject({ sender: "provider", text: "hello" });
    expect(outbound.send).toHaveBeenCalledTimes(1);
    expect(outbound.send).toHaveBeenCalledWith([result.current.transcript[0]]);
  });

  it("merges an inbound transcript into the local one", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
    });
    const outbound = peerFake.outbound[0];
    openChannel(outbound);

    const remoteTranscript = [
      message({ id: "1", sender: "patient", sentAt: "2026-01-01T00:00:00.000Z" }),
      message({ id: "2", sender: "patient", sentAt: "2026-01-01T00:01:00.000Z" }),
    ];
    fire(outbound.handlers, "data", remoteTranscript);

    expect(result.current.transcript).toEqual(remoteTranscript);
  });

  it("drops a malformed inbound payload and leaves the transcript unchanged", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
    });
    const outbound = peerFake.outbound[0];
    openChannel(outbound);

    fire(outbound.handlers, "data", { not: "a transcript" });
    fire(outbound.handlers, "data", "just a string");
    fire(outbound.handlers, "data", [{ id: "1" }]);

    expect(result.current.transcript).toEqual([]);
  });

  it("ends up with the same transcript on both sides after an exchange", () => {
    const providerPeer = createPeerFake();
    const patientPeer = createPeerFake();

    const provider = renderHook(() =>
      useChat({
        active: true,
        peer: providerPeer.peer,
        role: "provider",
        sessionKey: "provider-key",
      }),
    );
    const patient = renderHook(() =>
      useChat({
        active: true,
        peer: patientPeer.peer,
        role: "patient",
        sessionKey: "patient-key",
      }),
    );

    act(() => {
      patient.result.current.sendMessage("hi from patient, before connect");
    });

    act(() => {
      provider.result.current.connectTo("patient-peer-id");
    });
    const providerChannel = providerPeer.outbound[0];
    const patientChannel = createChannel();
    fire(patientPeer.handlers, "connection", patientChannel.channel);

    openChannel(providerChannel);
    openChannel(patientChannel);

    // Each side's "on open" send is what the other receives.
    fire(patientChannel.handlers, "data", providerChannel.send.mock.calls[0]?.[0]);
    fire(providerChannel.handlers, "data", patientChannel.send.mock.calls[0]?.[0]);

    expect(provider.result.current.transcript).toEqual(patient.result.current.transcript);
  });

  it("marks the channel closed and refuses further sends once it closes", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
    });
    const outbound = peerFake.outbound[0];
    openChannel(outbound);
    expect(result.current.isOpen).toBe(true);

    fire(outbound.handlers, "close");

    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.sendMessage("too late");
    });

    expect(result.current.transcript).toEqual([]);
  });

  it("closes an inbound channel that arrives while one is already live", () => {
    const peerFake = createPeerFake();
    renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "patient", sessionKey: "session-1" }),
    );

    const first = createChannel();
    fire(peerFake.handlers, "connection", first.channel);

    const second = createChannel();
    fire(peerFake.handlers, "connection", second.channel);

    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("allows a new connectTo once the previous channel has closed", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
    });
    fire(peerFake.outbound[0].handlers, "close");

    act(() => {
      result.current.connectTo("remote-2");
    });

    expect(peerFake.connect).toHaveBeenCalledTimes(2);
    expect(peerFake.connect).toHaveBeenLastCalledWith("remote-2");
  });

  it("resets the transcript and closes the channel on deactivation", () => {
    const peerFake = createPeerFake();
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useChat({ active, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
      { initialProps: { active: true } },
    );

    act(() => {
      result.current.connectTo("remote-1");
    });
    const outbound = peerFake.outbound[0];
    openChannel(outbound);
    act(() => {
      result.current.sendMessage("hello");
    });

    rerender({ active: false });

    expect(outbound.close).toHaveBeenCalledTimes(1);
    expect(result.current.transcript).toEqual([]);
    expect(result.current.isOpen).toBe(false);
  });

  it("does nothing while inactive", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: false, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
      result.current.sendMessage("hello");
    });

    expect(peerFake.connect).not.toHaveBeenCalled();
    expect(result.current.transcript).toEqual([]);
  });

  it("restores a transcript saved under the session key on mount", () => {
    const stored = [message({ id: "1", sender: "provider", text: "saved earlier" })];
    sessionStorage.setItem("coviu:chat:session-1", JSON.stringify(stored));

    const { result } = renderHook(() =>
      useChat({ active: true, peer: null, role: "patient", sessionKey: "session-1" }),
    );

    expect(result.current.transcript).toEqual(stored);
  });

  it("does not restore a transcript saved under a different session key", () => {
    sessionStorage.setItem("coviu:chat:other-session", JSON.stringify([message({ id: "1" })]));

    const { result } = renderHook(() =>
      useChat({ active: true, peer: null, role: "patient", sessionKey: "session-1" }),
    );

    expect(result.current.transcript).toEqual([]);
  });

  it("persists a sent message under the session key", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
    });
    openChannel(peerFake.outbound[0]);
    act(() => {
      result.current.sendMessage("hello");
    });

    expect(readStoredTranscript("session-1")).toEqual(result.current.transcript);
  });

  it("persists a merged inbound transcript under the session key", () => {
    const peerFake = createPeerFake();
    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    act(() => {
      result.current.connectTo("remote-1");
    });
    const outbound = peerFake.outbound[0];
    openChannel(outbound);

    fire(outbound.handlers, "data", [message({ id: "1", sender: "patient" })]);

    expect(readStoredTranscript("session-1")).toEqual(result.current.transcript);
  });

  it("a client that reloads while the other peer is away still shows its messages", () => {
    const peerFake = createPeerFake();
    const beforeReload = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );
    act(() => {
      beforeReload.result.current.connectTo("remote-1");
    });
    openChannel(peerFake.outbound[0]);
    act(() => {
      beforeReload.result.current.sendMessage("see you tomorrow");
    });
    beforeReload.unmount();

    // Simulates a reload: a fresh hook instance, the other peer not yet back.
    const afterReload = renderHook(() =>
      useChat({ active: true, peer: null, role: "provider", sessionKey: "session-1" }),
    );

    expect(afterReload.result.current.transcript).toHaveLength(1);
    expect(afterReload.result.current.transcript[0]).toMatchObject({ text: "see you tomorrow" });
  });

  it("keeps chat working when sessionStorage throws on every call", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const peerFake = createPeerFake();

    const { result } = renderHook(() =>
      useChat({ active: true, peer: peerFake.peer, role: "provider", sessionKey: "session-1" }),
    );

    expect(result.current.transcript).toEqual([]);

    act(() => {
      result.current.connectTo("remote-1");
    });
    openChannel(peerFake.outbound[0]);
    act(() => {
      result.current.sendMessage("hello");
    });

    expect(result.current.transcript).toHaveLength(1);
    expect(result.current.transcript[0]).toMatchObject({ text: "hello" });
    expect(peerFake.outbound[0].send).toHaveBeenCalledWith([result.current.transcript[0]]);
  });
});
