# 0004. The session event log endpoint

The brief's last line is "app leaves behind a record of the session (events)". The rows exist and
the write path works; nothing can read them back. This plan adds the one endpoint §4.2 specifies,
`GET /api/sessions/:providerKey/events`, and the client call that wraps it.

## Problem

Every layer below the endpoint is finished.
[`recordEvent` and `getEvents`](../../packages/server/src/persistence/sessionRepository.ts#L89-L107)
are implemented over SQLite, the event recorder writes a row on each transition, and
[`EventSchema`, `GetSessionEventsParamsSchema` and `GetSessionEventsResponseSchema`](../../packages/shared/src/http.ts#L31-L41)
are already in the contract. Two pieces are missing, and one piece is wrong for this endpoint.

- **Services has no `getSessionEvents`.** The interface at
  [sessionService.ts:12-16](../../packages/server/src/services/sessionService.ts#L12-L16) exposes
  `createSession`, `resolveKey` and `endInterruptedSessions`. §6.2 lists a fourth function,
  `getSessionEvents(providerKey)`, which calls persistence directly and never calls Session.
- **HTTP serves two routes, not three.**
  [http.ts](../../packages/server/src/http/http.ts) registers `POST /api/sessions` and
  `GET /api/sessions/:key`. Express matches the latter only on a single path segment, so
  `/api/sessions/<key>/events` falls through to no handler and returns Express's HTML 404, not the
  `{ code, message }` body of §4.5.
- **`resolveKey` cannot answer "is this the provider key".** It returns a `role` derived from the
  match, which is enough for a role check, but its `ResolvedKey` does not carry the two keys, and
  §6.2 says this endpoint does not go through the key-resolution path used by live state anyway. The
  new function does its own lookup with `getSessionByKey` and compares `providerKey`.

Observable today: `curl -i localhost:3001/api/sessions/$PROVIDER_KEY/events` returns
`404 Cannot GET` with `Content-Type: text/html`. The rows are visible only through
`sqlite3 data/app.db`.

## Spec

**`GET /api/sessions/:providerKey/events` returns the full log for that session**, as
`{ events: Event[] }`, in `id` order with the oldest row first, where each `Event` is
`{ id, type, occurredAt, data }` and `data` is already-parsed JSON or `null`. The response
validates against `GetSessionEventsResponseSchema`. An empty log is `{ events: [] }` with status
200 — a session that has only just been created still answers.

**The endpoint is provider-only, and says nothing about whether a session exists.** A key that no
session has, and a patient key, both return `unknown_key` with status 404 and the same message. A
different code for the second case would confirm the session to a patient (§4.5).

**An ended session still answers.** The record is the point of the endpoint, so `ENDED` is the
state in which it matters most. It does not return `session_ended`.

**It reads persistence and nothing else.** No call to the registry, no state machine command, no
socket emission. A request for a session the in-memory registry has forgotten — after a restart —
returns the same rows.

**The client wraps it in the session layer.** `HttpClient` gains
`getSessionEvents(providerKey): Promise<GetSessionEventsResponse>`, parsing the body with the
shared schema and throwing `HttpError` on a non-OK response, exactly as `getSession` does. No view
calls `fetch`.

## Not in scope

- **Rendering the record in the provider UI.** A separate task, once the call is in place; it needs
  a decision about where the history lives on the ended screen. The endpoint is testable without it.
- **`chat_message_sent` rows.** Chat is not built yet. The endpoint is type-agnostic and will serve
  those rows unchanged when chat lands, along with `chat:history` (§4.3), which reads the same log
  through `getChatHistory`.
- **Paging, filtering and a date range.** One session's log is tens of rows. §5.2 names
  `SELECT * FROM events WHERE session_id = ? ORDER BY id` as the only query this log needs.
- **A patient-side events endpoint.** §4.2 calls the log provider history. The brief does not ask
  for it on the patient side.
- **Retention and deletion.** §5.2 leaves this to a later scheduled job over `sessions.created_at`.

## Approach

Services first, because the route is then four lines over a function with its own unit test. Add
`getSessionEvents(providerKey)` to the `SessionService` interface with a fake repository in
[sessionService.test.ts](../../packages/server/src/services/sessionService.test.ts): one test for a
provider key with rows in order, one for a patient key, one for an unknown key, one for an empty
log. It returns `Event[] | undefined`, so the transport decides the status code and the service
holds no HTTP knowledge.

Then the route, written before the handler in
[http.test.ts](../../packages/server/src/http/http.test.ts) with a stub service. The ordering risk
is route registration: `/api/sessions/:key` must not shadow `/api/sessions/:providerKey/events`.
Express matches path segments, not prefixes, so declaration order does not matter here — but a test
that asserts a real provider key returns rows rather than `{ role, status }` is what proves it, and
it is the test most likely to force a rethink if Express behaves otherwise.

Last, `getSessionEvents` on the client `HttpClient`, with the parse-and-throw shape the existing
two methods use, tested against a stubbed `fetch` like the rest of
[httpClient.test.ts](../../packages/client/src/session/httpClient.test.ts). Nothing consumes it yet;
it ships as the seam the UI task builds on.

No change to §3, §5.2, or the emitter. This plan adds one function to §5.3's callers, one route
from §4.2's table, and one client method.
