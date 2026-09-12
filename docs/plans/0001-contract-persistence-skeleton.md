# 0001. Contract, persistence, and a connected skeleton

The first slice of [architecture.md](../architecture.md). It builds the three things every later
piece of work sits on: the shared contract package (§6.1), the SQLite schema and repository
interface (§5), and a server and client that start, connect over Socket.IO, and exchange the
first real message. No consultation behaviour lands here — no admit, no chat, no media.

## Problem

The repository holds a bootstrap, not the design. §8 of the architecture document lists the gap;
these are the parts of it this plan closes.

- `packages/shared` does not exist. `packages/` holds `client` and `server` only, and the root
  `package.json` workspaces glob is `packages/*`. There is therefore no shared definition of the
  contract in §4, so a wrong event name or payload would only fail at run time, on one side.
- `packages/server/src/index.ts` is an empty file — zero bytes. `npm run dev:server` starts `tsx
  watch` on it and the process exits. Nothing listens on a port.
- `packages/client/src/main.ts` is one line:
  `document.querySelector<HTMLDivElement>("#app")!.innerHTML = "Client placeholder";`
  It is not React (§6.3) and it opens no connection.
- There is no schema file and no `data/app.db` (§5). Nothing creates the `sessions` or `events`
  tables.
- Four dependencies the design names are not installed: `zod`, `socket.io-client`, `react` and
  `react-dom` (with `@vitejs/plugin-react`). `socket.io`, `express`, `peer`, `peerjs` and
  `better-sqlite3` are installed.
- `vitest.config.ts` includes `packages/*/src/**/*.test.ts` only. It matches no `.tsx`, so the
  client tests §6.4 asks for would not run, and it matches no top-level `tests/` directory.
- `packages/client/tsconfig.json` does not extend `tsconfig.base.json` and sets no `jsx`.

## Spec

**The shared package.** `@coviu/shared` exports a Zod schema for every HTTP body and response in
§4.2, every Socket.IO payload in §4.3, the session status union (§3), the `ended_reason` union,
the event `type` union (§5.2), and the `ErrorCode` union (§4.5). Every exported TypeScript type
comes from `z.infer` on one of those schemas — no hand-written interface duplicates a schema. It
also exports the `ClientToServerEvents` and `ServerToClientEvents` maps built from those inferred
types, so both sides get the Socket.IO generics. It imports nothing from `client` or `server`.

**Persistence.** A SQLite file at `data/app.db`, created on start-up if absent, holding exactly
the two tables and one index in §5.1 and §5.2 including the `ended_reason` CHECK constraint. One
module exports the six functions in §5.3 — `upsertSession`, `getSession`, `getSessionByKey`,
`recordEvent`, `getEvents`, `listOpenSessions` — and nothing else. It is the only module in the
tree that writes SQL. `getEvents` returns rows in `id` order, oldest first, with `data` already
parsed from JSON text, and `null` where the column is null. `getSession` and `getSessionByKey`
return `undefined` for no match, not null and not a throw. `recordEvent` on a `session_id` with
no `sessions` row fails rather than writing an orphan.

**The server starts.** One `http.Server`, one port, carrying Express and Socket.IO (§2). It
answers `POST /api/sessions` with `{ providerKey, patientKey, providerUrl, patientUrl }` and no
`sessionId`, and `GET /api/sessions/:key` with `{ role, status }`. Both write a `sessions` row —
creation also writes a `session_created` event — and both validate through a `shared` schema, so
a malformed body returns `{ code: "invalid_message", message }` with status 400 and an unknown
key returns `{ code: "unknown_key", message }` with status 404. `GET /api/sessions/:providerKey/
events` is **not** in this slice.

**The client connects and says hello.** The client is React on Vite. It reads its key from the
URL, calls `GET /api/sessions/:key` for the first render, then opens one Socket.IO connection
with `io(SERVER_URL, { auth: { key } })` — the key in the handshake, never in the URL (§4.3).

There is no `hello` event, and this plan does not add one. §4.3 fixes the event set, and the
handshake already carries everything a hello would: the server's `io.use` middleware resolves the
key with `resolveKey`, derives the role, attaches session ID and role to the socket, joins
`session:<sessionId>`, and the server's first `session:state` emission is the reply. That
round-trip — key in, correct state back, rendered — is what "connect and send hello" means here,
and it is the thing to demonstrate.

Observable at the end: start both dev processes, `POST /api/sessions`, open the provider link and
the patient link in two tabs, and each tab renders the session state it got over the socket.
`sqlite3 data/app.db "select * from sessions; select * from events"` shows the row and the
`session_created` event.

**Error cases in this slice.** The middleware refuses with `unknown_key` when no session matches
the key, with `role_already_connected` when a socket for that role is already connected, and with
`session_ended` when the session is `ENDED`. All three arrive at the client as `connect_error`
carrying `{ code, message }`, and the client shows a terminal screen rather than retrying — a
middleware refusal is not retried by the Socket.IO client, and the client must not add its own
retry on top.

**Start-up sweep.** `endInterruptedSessions` (§3) runs before the server accepts a request: every
`sessions` row not `ENDED` moves to `ENDED` with reason `interrupted`, and writes both a
`session_ended` event and the row update. It touches the registry, which is empty at that moment,
not at all.

**Module boundaries hold from the first commit.** Signaling imports no persistence. Session
imports no persistence. Only the event recorder and Services call the repository.

## Not in scope

- `admit`, `chat:message`, `chat:history`, `patient:leave`, `end-session`, and the state
  transitions behind them. The registry lands here holding `CREATED` and `WAITING` only.
- The grace timer and `DISCONNECTED_GRACE`. Presence tracking beyond what the first
  `session:state` needs.
- PeerJS on either side, and `ExpressPeerServer` on the server. No media in this slice.
- `GET /api/sessions/:providerKey/events`.
- Any UI beyond enough to show role, state, and a connection error.
- End-to-end tests in a top-level `tests/` project (§6.4). Unit tests only for now.

## Approach

**`shared` comes first, and it is the step most likely to force a rethink.** Everything else
imports it, and writing the schemas is where §4 gets tested against itself: the `session:state`
payload, the `ErrorCode` union, and the two Socket.IO event maps either fall out cleanly or they
reveal a gap in the document. If they reveal one, fix [architecture.md](../architecture.md) in
the same change — §0 of that document says a disagreement between it and the code is a defect in
one of them. Do not work around a gap in the client or the server.

Persistence goes second, because it has no dependency on anything above it and its tests need no
socket and no HTTP. Build the schema and the six functions together against an in-memory database
so the tests are fast, then wire the file path in the composition root.

Then the server, bottom-up along the dependency arrows in §6.2: Session (a registry with
`CREATED` and `WAITING`, and an emitter), the event recorder subscribing to it, Services
(`createSession`, `resolveKey`, `endInterruptedSessions`), then HTTP, then Signaling. Taking
Signaling last means the handshake middleware has a real `resolveKey` to call and there is no
temporary stub to remove.

The client is last because it needs a running server to be worth anything. React and the Vite
plugin, then the session/socket layer (§6.3) with the two views on top of it. Keep the media
layer out entirely — an empty seam is better than a stub that later has to be unpicked.

**One decision, taken here.** §2.1 says to prefer `node:sqlite` over `better-sqlite3` if the Node
version allows. This machine runs Node 26.6 and `node:sqlite` is stable there, so use it and
remove `better-sqlite3` from `packages/server/package.json`; add `"engines": { "node": ">=22.5" }`
so the requirement is recorded rather than assumed. The repository interface (§5.3) is the seam
that makes this cheap to reverse — if `node:sqlite` bites, putting `better-sqlite3` back is one
file.

Two pieces of config need changing alongside the code, and both are easy to forget: widen
`vitest.config.ts` to `packages/*/src/**/*.test.{ts,tsx}`, and make
`packages/client/tsconfig.json` extend `tsconfig.base.json` and set `"jsx": "react-jsx"`.

As each part lands, delete its line from §8 of [architecture.md](../architecture.md). That
section is a list of known gaps; a stale entry there is worse than no entry.
