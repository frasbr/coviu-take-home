// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionConnection } from "../session/useSession.js";
import { useSession } from "../session/useSession.js";
import { ProviderView } from "./ProviderView.js";

vi.mock("../session/useSession.js", () => ({ useSession: vi.fn() }));

const admit = vi.fn();
const endSession = vi.fn();
const leave = vi.fn();
const sendPeerId = vi.fn();

function mockConnection(connection: SessionConnection) {
  vi.mocked(useSession).mockReturnValue({
    connection,
    remotePeerId: null,
    admit,
    endSession,
    leave,
    sendPeerId,
  });
}

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
});
