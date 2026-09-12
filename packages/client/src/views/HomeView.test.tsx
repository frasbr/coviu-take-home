// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeView } from "./HomeView.js";

const BASE_URL = "https://example.test";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("HomeView", () => {
  it("creates a session and shows the two links", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        providerKey: "pk",
        patientKey: "wk",
        providerUrl: "https://example.test/p/pk",
        patientUrl: "https://example.test/w/wk",
      }),
    );

    render(<HomeView baseUrl={BASE_URL} />);
    await userEvent.click(screen.getByRole("button", { name: "Create session" }));

    expect(await screen.findByRole("link", { name: "https://example.test/p/pk" })).toBeVisible();
    expect(screen.getByRole("link", { name: "https://example.test/w/wk" })).toBeVisible();
  });

  it("shows an error message when creation fails", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(400, { code: "invalid_message", message: "bad request" }),
    );

    render(<HomeView baseUrl={BASE_URL} />);
    await userEvent.click(screen.getByRole("button", { name: "Create session" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("bad request");
  });
});
