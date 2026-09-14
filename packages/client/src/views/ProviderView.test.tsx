// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { SessionStatePayload } from "@coviu/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseMediaResult } from "../media/useMedia.js";
import { useMedia } from "../media/useMedia.js";
import type { SessionConnection } from "../session/useSession.js";
import { useSession } from "../session/useSession.js";
import type { SessionEventsResult } from "../session/useSessionEvents.js";
import { useSessionEvents } from "../session/useSessionEvents.js";
import { ProviderView } from "./ProviderView.js";

vi.mock("../session/useSession.js", () => ({ useSession: vi.fn() }));
vi.mock("../session/useSessionEvents.js", () => ({ useSessionEvents: vi.fn() }));
vi.mock("../media/useMedia.js", () => ({ useMedia: vi.fn() }));
vi.mock("../media/peerFactory.js", () => ({ createBrowserPeer: vi.fn() }));

const admit = vi.fn();
const endSession = vi.fn();
const leave = vi.fn();
const sendPeerId = vi.fn();
const callPeer = vi.fn();

function mockConnection(connection: SessionConnection, remotePeerId: string | null = null) {
  vi.mocked(useSession).mockReturnValue({
    connection,
    remotePeerId,
    admit,
    endSession,
    leave,
    sendPeerId,
  });
}

function mockMedia(overrides: Partial<UseMediaResult> = {}) {
  vi.mocked(useMedia).mockReturnValue({
    localStream: null,
    remoteStream: null,
    localPeerId: null,
    error: null,
    callPeer,
    ...overrides,
  });
}

function mockEvents(result: SessionEventsResult) {
  vi.mocked(useSessionEvents).mockReturnValue(result);
}

function providerIn(state: SessionStatePayload["state"]): SessionConnection {
  return {
    status: "connected",
    role: "provider",
    state: {
      state,
      since: "2026-01-01T00:00:00.000Z",
      reason: null,
      presence: { provider: true, patient: true },
    },
  };
}

beforeEach(() => {
  mockMedia();
  mockEvents({ status: "idle" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProviderView", () => {
  it("shows a loading state while resolving", () => {
    mockConnection({ status: "resolving" });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.getByText("Loading session…")).toBeVisible();
  });

  it("shows a terminal error screen on connect_error, with no retry control", () => {
    mockConnection({
      status: "error",
      error: { code: "session_ended", message: "this session has ended" },
    });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.getByRole("alert")).toHaveTextContent("this session has ended");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an admit button in WAITING and calls admit on click", async () => {
    mockConnection({
      status: "connected",
      role: "provider",
      state: {
        state: "WAITING",
        since: "2026-01-01T00:00:00.000Z",
        reason: null,
        presence: { provider: true, patient: true },
      },
    });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);
    await userEvent.click(screen.getByRole("button", { name: "Admit patient" }));

    expect(admit).toHaveBeenCalled();
  });

  it("hides the admit button once ACTIVE and calls endSession on click", async () => {
    mockConnection({
      status: "connected",
      role: "provider",
      state: {
        state: "ACTIVE",
        since: "2026-01-01T00:00:00.000Z",
        reason: null,
        presence: { provider: true, patient: true },
      },
    });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.queryByRole("button", { name: "Admit patient" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "End session" }));

    expect(endSession).toHaveBeenCalled();
  });

  it("shows no action buttons once ENDED", () => {
    mockConnection({
      status: "connected",
      role: "provider",
      state: {
        state: "ENDED",
        since: "2026-01-01T00:00:00.000Z",
        reason: "provider_ended",
        presence: { provider: false, patient: false },
      },
    });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("fetches the event log only once ENDED", () => {
    mockConnection(providerIn("ACTIVE"));

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(useSessionEvents).toHaveBeenCalledWith("https://example.test", "pk", false);
  });

  it("shows a loading state for the event log while ENDED", () => {
    mockConnection(providerIn("ENDED"));
    mockEvents({ status: "loading" });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(useSessionEvents).toHaveBeenCalledWith("https://example.test", "pk", true);
    expect(screen.getByText("Loading session history…")).toBeVisible();
  });

  it("lists the events once loaded", () => {
    mockConnection(providerIn("ENDED"));
    mockEvents({
      status: "loaded",
      events: [
        { id: 1, type: "session_created", occurredAt: "2026-01-01T00:00:00.000Z", data: null },
        {
          id: 2,
          type: "session_ended",
          occurredAt: "2026-01-01T00:05:00.000Z",
          data: { reason: "provider_ended" },
        },
      ],
    });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("session_created");
    expect(items[1]).toHaveTextContent("session_ended");
  });

  it("shows an error if the event log fails to load", () => {
    mockConnection(providerIn("ENDED"));
    mockEvents({ status: "error", message: "no session has that key" });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.getByRole("alert")).toHaveTextContent("no session has that key");
  });

  it("activates media only once the session is ACTIVE", () => {
    mockConnection(providerIn("ACTIVE"));

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(useMedia).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it("leaves media inactive while WAITING", () => {
    mockConnection(providerIn("WAITING"));

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(useMedia).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it("sends its own peer id once the local peer is open", () => {
    mockConnection(providerIn("ACTIVE"));
    mockMedia({ localPeerId: "local-peer" });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(sendPeerId).toHaveBeenCalledWith("local-peer");
  });

  it("calls the remote peer once both peer ids are known", () => {
    mockConnection(providerIn("ACTIVE"), "remote-peer");
    mockMedia({ localPeerId: "local-peer" });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(callPeer).toHaveBeenCalledWith("remote-peer");
  });

  it("does not call the remote peer before its own peer is open", () => {
    mockConnection(providerIn("ACTIVE"), "remote-peer");
    mockMedia({ localPeerId: null });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(callPeer).not.toHaveBeenCalled();
  });

  it("places the call on the render where its own peer opens, if the remote id came first", () => {
    mockConnection(providerIn("ACTIVE"), "remote-peer");
    mockMedia({ localPeerId: null });

    const { rerender } = render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);
    expect(callPeer).not.toHaveBeenCalled();

    mockMedia({ localPeerId: "local-peer" });
    rerender(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(callPeer).toHaveBeenCalledWith("remote-peer");
  });

  it("shows a media error without disabling the session controls", async () => {
    mockConnection(providerIn("ACTIVE"));
    mockMedia({ error: "Could not access the camera or microphone." });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not access the camera or microphone.",
    );
    expect(screen.getByText("State: ACTIVE")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "End session" }));

    expect(endSession).toHaveBeenCalled();
  });

  it("renders no h1 on the call screen", () => {
    mockConnection(providerIn("WAITING"));

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("renders the video feeds alongside the bar while on the call screen", () => {
    mockConnection(providerIn("WAITING"));

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.getByLabelText("Remote video")).toBeInTheDocument();
    expect(screen.getByLabelText("Local video")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admit patient" })).toBeInTheDocument();
  });

  it("shows both buttons and the presence readout together while WAITING", () => {
    mockConnection(providerIn("WAITING"));

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.getByRole("button", { name: "Admit patient" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument();
    expect(screen.getByText("Patient: connected")).toBeVisible();
  });

  it("shows no video and no control bar once ended, only a centred history panel", () => {
    mockConnection(providerIn("ENDED"));
    mockEvents({ status: "loaded", events: [] });

    render(<ProviderView baseUrl="https://example.test" sessionKey="pk" />);

    expect(screen.queryByLabelText("Remote video")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Local video")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Session history" })).toBeVisible();
  });
});
