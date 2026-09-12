import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError, createHttpClient } from "./httpClient.js";

const BASE_URL = "https://example.test";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createSession", () => {
  it("POSTs to /api/sessions and returns the parsed body", async () => {
    const body = {
      providerKey: "pk",
      patientKey: "wk",
      providerUrl: "https://example.test/p/pk",
      patientUrl: "https://example.test/w/wk",
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, body));

    const result = await createHttpClient(BASE_URL).createSession();

    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/sessions`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws HttpError with the server's error payload on failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(400, { code: "invalid_message", message: "bad body" }),
    );

    await expect(createHttpClient(BASE_URL).createSession()).rejects.toMatchObject(
      new HttpError({ code: "invalid_message", message: "bad body" }),
    );
  });
});

describe("getSession", () => {
  it("GETs /api/sessions/:key and returns role and status", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "provider", status: "WAITING" }));

    const result = await createHttpClient(BASE_URL).getSession("pk");

    expect(result).toEqual({ role: "provider", status: "WAITING" });
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/api/sessions/pk`);
  });

  it("throws HttpError with unknown_key for a 404", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, { code: "unknown_key", message: "no session has that key" }),
    );

    await expect(createHttpClient(BASE_URL).getSession("nope")).rejects.toMatchObject(
      new HttpError({ code: "unknown_key", message: "no session has that key" }),
    );
  });

  it("URL-encodes the key", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { role: "patient", status: "CREATED" }));

    await createHttpClient(BASE_URL).getSession("a/b c");

    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/api/sessions/a%2Fb%20c`);
  });
});
