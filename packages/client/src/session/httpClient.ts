import {
  type CreateSessionResponse,
  CreateSessionResponseSchema,
  type ErrorPayload,
  ErrorPayloadSchema,
  type GetSessionResponse,
  GetSessionResponseSchema,
} from "@coviu/shared";

/** Thrown for a non-OK HTTP response, carrying the server's error body (architecture.md §4.5). */
export class HttpError extends Error {
  readonly payload: ErrorPayload;

  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.payload = payload;
  }
}

export interface HttpClient {
  createSession(): Promise<CreateSessionResponse>;
  getSession(key: string): Promise<GetSessionResponse>;
}

async function parseErrorBody(res: Response): Promise<ErrorPayload> {
  const body: unknown = await res.json().catch(() => undefined);
  const parsed = ErrorPayloadSchema.safeParse(body);
  return parsed.success
    ? parsed.data
    : { code: "unknown_key", message: `request failed with status ${res.status}` };
}

/** Wraps the HTTP endpoints from architecture.md §4.2. Knows nothing about React or sockets. */
export function createHttpClient(baseUrl: string): HttpClient {
  return {
    async createSession(): Promise<CreateSessionResponse> {
      const res = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        throw new HttpError(await parseErrorBody(res));
      }
      return CreateSessionResponseSchema.parse(await res.json());
    },

    async getSession(key: string): Promise<GetSessionResponse> {
      const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(key)}`);
      if (!res.ok) {
        throw new HttpError(await parseErrorBody(res));
      }
      return GetSessionResponseSchema.parse(await res.json());
    },
  };
}
