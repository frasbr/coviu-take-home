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
import { PatientView } from "./PatientView.js";

vi.mock("../session/useSession.js", () => ({ useSession: vi.fn() }));
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

function patientIn(state: SessionStatePayload["state"]): SessionConnection {
  return {
    status: "connected",
    role: "patient",
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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PatientView", () => {
  it("shows a loading state while resolving", () => {
    mockConnection({ status: "resolving" });

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(screen.getByText("Loading session…")).toBeVisible();
  });

  it("shows a terminal error screen on connect_error, with no retry control", () => {
    mockConnection({
      status: "error",
      error: { code: "unknown_key", message: "no session has that key" },
    });

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(screen.getByRole("alert")).toHaveTextContent("no session has that key");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the received state and calls leave on click", async () => {
    mockConnection({
      status: "connected",
      role: "patient",
      state: {
        state: "WAITING",
        since: "2026-01-01T00:00:00.000Z",
        reason: null,
        presence: { provider: true, patient: true },
      },
    });

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);
    expect(screen.getByText("State: WAITING")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(leave).toHaveBeenCalled();
  });

  it("shows no action buttons once ENDED", () => {
    mockConnection({
      status: "connected",
      role: "patient",
      state: {
        state: "ENDED",
        since: "2026-01-01T00:00:00.000Z",
        reason: "timeout",
        presence: { provider: false, patient: false },
      },
    });

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a centred message with no video once ENDED", () => {
    mockConnection({
      status: "connected",
      role: "patient",
      state: {
        state: "ENDED",
        since: "2026-01-01T00:00:00.000Z",
        reason: "timeout",
        presence: { provider: false, patient: false },
      },
    });

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(screen.getByText("The session has ended.")).toBeVisible();
    expect(screen.queryByLabelText("Remote video")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Local video")).not.toBeInTheDocument();
  });

  it("renders no h1 on the call screen", () => {
    mockConnection(patientIn("WAITING"));

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("renders the video feeds alongside the bar while on the call screen", () => {
    mockConnection(patientIn("WAITING"));

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(screen.getByLabelText("Remote video")).toBeInTheDocument();
    expect(screen.getByLabelText("Local video")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
  });

  it("activates media only once the session is ACTIVE", () => {
    mockConnection(patientIn("ACTIVE"));

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(useMedia).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it("leaves media inactive while WAITING", () => {
    mockConnection(patientIn("WAITING"));

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(useMedia).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it("activates media when ACTIVE and the patient is present", () => {
    mockConnection({
      status: "connected",
      role: "patient",
      state: {
        state: "ACTIVE",
        since: "2026-01-01T00:00:00.000Z",
        reason: null,
        presence: { provider: true, patient: true },
      },
    });

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(useMedia).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it("deactivates media when ACTIVE but the patient's presence has dropped", () => {
    mockConnection({
      status: "connected",
      role: "patient",
      state: {
        state: "ACTIVE",
        since: "2026-01-01T00:00:00.000Z",
        reason: null,
        presence: { provider: true, patient: false },
      },
    });

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(useMedia).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it("sends its own peer id once the local peer is open", () => {
    mockConnection(patientIn("ACTIVE"));
    mockMedia({ localPeerId: "local-peer" });

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(sendPeerId).toHaveBeenCalledWith("local-peer");
  });

  it("never places a call, whichever peer ids are known", () => {
    for (const [localPeerId, remotePeerId] of [
      [null, null],
      ["local-peer", null],
      [null, "remote-peer"],
      ["local-peer", "remote-peer"],
    ] as const) {
      mockConnection(patientIn("ACTIVE"), remotePeerId);
      mockMedia({ localPeerId });

      render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);
      cleanup();
    }

    expect(callPeer).not.toHaveBeenCalled();
  });

  it("shows a media error without disabling the leave control", async () => {
    mockConnection(patientIn("ACTIVE"));
    mockMedia({ error: "Could not access the camera or microphone." });

    render(<PatientView baseUrl="https://example.test" sessionKey="wk" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not access the camera or microphone.",
    );
    expect(screen.getByText("State: ACTIVE")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Leave" }));

    expect(leave).toHaveBeenCalled();
  });
});
