// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { useSession } from "./session/useSession.js";

vi.mock("./session/useSession.js", () => ({ useSession: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders the home view for the root path", () => {
    render(<App baseUrl="https://example.test" pathname="/" />);

    expect(screen.getByText("Start a consultation")).toBeVisible();
  });

  it("renders the provider view for /p/:key", () => {
    vi.mocked(useSession).mockReturnValue({
      connection: { status: "resolving" },
      admit: vi.fn(),
      endSession: vi.fn(),
      leave: vi.fn(),
    });

    render(<App baseUrl="https://example.test" pathname="/p/pk" />);

    expect(useSession).toHaveBeenCalledWith("https://example.test", "pk");
  });

  it("renders the patient view for /w/:key", () => {
    vi.mocked(useSession).mockReturnValue({
      connection: { status: "resolving" },
      admit: vi.fn(),
      endSession: vi.fn(),
      leave: vi.fn(),
    });

    render(<App baseUrl="https://example.test" pathname="/w/wk" />);

    expect(useSession).toHaveBeenCalledWith("https://example.test", "wk");
  });
});
