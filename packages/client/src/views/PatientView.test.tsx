// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionConnection } from "../session/useSession.js";
import { useSession } from "../session/useSession.js";
import { PatientView } from "./PatientView.js";

vi.mock("../session/useSession.js", () => ({ useSession: vi.fn() }));

const admit = vi.fn();
const endSession = vi.fn();
const leave = vi.fn();

function mockConnection(connection: SessionConnection) {
  vi.mocked(useSession).mockReturnValue({ connection, admit, endSession, leave });
}

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
});
