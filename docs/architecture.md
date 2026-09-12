# Telehealth consultation design

Status: proposed. It covers the take-home test in [brief.md](brief.md).

This is the only design document. If the code and this document do not agree, one of the two has a defect. Correct it.

Every design question in this document is decided. Section 8 lists where the repository does not
match the document yet.

## 1. Scope and constraints

The brief gives these constraints. The design obeys them.

- One provider and one patient are in each session. Group calls are out of scope.
- There is no authentication system and there are no user accounts. Section 4.1 gives each role
  a secret key. A key is an access token. It is not an identity. Do not make it into an identity.
- There is no CI/CD pipeline, no design system, no mobile app, and no scaling work. The app runs
  on one machine. Do not add queues, load balancers, or code that coordinates many instances.
- "No visual design" applies only to the appearance of the UI. It does not permit a frontend
  that is difficult to change. See section 2.
- Maintainability and future extension are the two qualities under review. Keep the signaling,
  media, session, and persistence code in different modules. You can then replace one module
  without a change to the others.

## 2. Runtime shape

The system has two programs.

**Client** (`packages/client`). This is a React single-page app. Vite builds it. The client
shows the provider UI and the patient UI. It drives the PeerJS peer. It calls the server with
HTTP and with a Socket.IO connection.

React is a decision, not a default. The session state, the waiting room state, and the call
state change many times in one consultation. These changes come on the socket. Each change
must update the UI. Manual DOM code makes that work more difficult to maintain. Section 6.3
points to this paragraph.

**Server** (`packages/server`). This is one Node process. Section 6.2 gives its internal modules
and their dependency rules.

Audio and video go directly from one browser to the other. PeerJS sets up that path (§4.4). Only
the connection details reach the server. No media does. The server therefore stays small, and the
app does not need the media infrastructure that the brief excludes.

Risk: WebRTC with a STUN server only can fail through a restrictive NAT. This app runs on one
local network for the test. The team accepts this risk. Section 7 gives the TURN extension point.

In development you start two processes: the Vite dev server and the API server. The number of
processes is a deployment detail. It does not change this design.

### 2.1 Dependencies

Add a dependency only when it removes code that this document describes. Each row below names
what it replaces. A package that replaces nothing here does not belong in the tree.

| Package | Where | What it replaces |
|---|---|---|
| `socket.io`, `socket.io-client` | server, client | The message envelope, the heartbeat, the reconnect and backoff code in the client, and the hand-kept map of peer sockets. See §4.3. |
| `peerjs` | client | Every line of `RTCPeerConnection` code: the offer and answer flow, the ICE exchange, and the track handling. See §4.4. |
| `peer` | server | The `webrtc:*` relay events and the code that forwarded them. `ExpressPeerServer` mounts on the same `http.Server`, so it adds no process and no port. |
| `zod` | shared | Hand-written type guards, request validation, and the TypeScript types themselves. See §6.1. |
| `express` | server | Hand-written routing and body parsing for the three endpoints in §4.2. It attaches to the same `http.Server` that Socket.IO uses, so there is one listener and one port. |
| `better-sqlite3` | server | A hand-rolled driver. Its API is synchronous, so the repository (§5.3) needs no async code and no connection pool. |

Two needs take no package. `node:crypto` makes the ID and the two keys (§4.1) with `randomUUID`
and `randomBytes`. `node:events` carries the Session emitter (§6.2).

On Node 22.5 and later, `node:sqlite` can replace `better-sqlite3` and remove the one native
dependency in the tree. Take that option if the Node version in `package.json` allows it.

## 3. Session lifecycle

A session is one consultation. The server holds one state for each session. This state is the
only correct state. Both clients receive it on the socket (§4.3).

`RECONNECT_GRACE_PERIOD` is 10 minutes. This document gives that value here only. Other sections
use the name.

```
CREATED             --(patient opens link, connects)-----> WAITING
WAITING             --(provider admits)------------------> ACTIVE
WAITING or ACTIVE   --(provider socket drops)------------> DISCONNECTED_GRACE (timer starts)
DISCONNECTED_GRACE  --(provider reconnects in time)------> the state before the closure
DISCONNECTED_GRACE  --(grace period elapses)-------------> ENDED (reason: timeout)
any state but ENDED --(provider ends session)------------> ENDED (reason: provider_ended)
any state but ENDED --(server starts up)-----------------> ENDED (reason: interrupted)
```

These rules follow from the state machine.

- The server keeps the state in memory in a session registry. The session ID is the key. The
  server does not calculate the state from the event log. The event log (§5.2) is a record, not
  a query path. A slow write to the database therefore cannot delay the signaling.
- **Only a provider disconnect starts the grace timer.** A provider socket that disconnects in
  state `WAITING` or in state `ACTIVE` starts `DISCONNECTED_GRACE`. The registry entry remembers the
  state before the closure, and a reconnect in time returns the session to that state. The timer
  exists because no person can then make the decision to end the session. It bounds a session
  that the provider abandons.
- **`end-session` is legal in every state except `ENDED`.** The provider can end a session that
  nobody has opened, and a session in which a patient waits. Section 4.3 gives the full table of
  legal messages for each state.
- **A patient disconnect does not change the session state.** The session stays in `ACTIVE`. The
  server sets `presence.patient` to false, sends `session:state` (§4.3), and writes a
  `patient_disconnected` event. The provider is still connected and decides what to do: wait, or
  send `end-session`. A lost patient connection must not make that decision for the provider.
- The patient reconnects at any time before the session reaches `ENDED`. There is no separate
  deadline on a patient reconnect.
- **Do not destroy the PeerJS peer when the Socket.IO connection drops.** The two connections
  fail independently (§4.4). A short network fault can drop the Socket.IO connection while the
  media path stays good. An early teardown makes the reconnect worse. PeerJS reports the media
  side by itself, through `peer.on('disconnected')` and `call.on('close')`.
- The Socket.IO client reconnects by itself, with backoff (§2.1). Both clients keep the default
  and retry until they connect or the person closes the page. No client holds a timer of its own.
  **The server decides** whether it accepts a reconnect, and the grace timer is the only deadline.
- A reconnect writes a `provider_reconnected` or a `patient_reconnected` event. A provider
  reconnect in time also moves the session back to `ACTIVE`. The client makes a new call only
  when the media is not live, by the rule in §4.4. A reconnect therefore always restores the
  session connection. It restores the media only if the media also stopped.
- If the grace timer elapses first, the server moves the session to `ENDED` with the reason
  `timeout` and writes the event. The handshake middleware (§4.3) then refuses every later
  reconnect from either role with the code `session_ended`. The Socket.IO client reports that as
  a `connect_error`. A client does not retry after a middleware refusal, so it shows the ended
  screen instead of a reconnect loop.
- **The server ends every open session when it starts up.** The registry is in memory, so a
  restart loses it. At start-up, `endInterruptedSessions` (§6.2) reads each `sessions` row that
  is not `ENDED`, moves it to `ENDED` with the reason `interrupted`, and writes the event. A link
  for such a session then returns `session_ended` (§4.5). Without this step `getSessionByKey`
  would find a row that says `ACTIVE` while the registry holds nothing. The sweep runs before the
  server accepts a request, and it never touches the registry, which is empty at that moment.
- `ENDED` is the last state. Each session is for one use only, for the life of the process. A
  request that gives the key of an ended session receives an explicit "session ended" answer. It
  does not receive a new `WAITING` state.

**One path has no timer.** A provider can make a session and then close the browser before any
socket connects. That session stays in `CREATED`, and the start-up sweep above is the only thing
that ends it. This is a known limit. The design accepts it to keep the state machine small.

## 4. Protocols

### 4.1 Role keys

Session creation makes two different random values: `providerKey` and `patientKey`. The
shareable links contain them. `providerUrl` contains `providerKey`. `patientUrl` contains
`patientKey`. The caller gives one key with each HTTP request and in the Socket.IO handshake
(§4.3). The server compares the key and gets the role from the match. The caller never
declares its own role.

This is a small step up from a `?role=` parameter in the URL. It costs nothing. It stops a
patient who connects as a provider and admits themselves.

This is **not** an authentication system. A person who has a link has full access to that role.
There is no identity behind a key. Do not extend this into an authentication system without a
separate decision (§1, §7).

The server also holds one canonical `sessionId` for each consultation. Persistence uses it as
the primary key (§5.1). The registry uses it for routing (§3). No response gives it to a client
(§4.2), and no link contains it. A client works only from its key. The server compares the two
keys against a session. It never calculates a key from the ID.

### 4.2 HTTP

| Method | Path | Caller | Purpose |
|---|---|---|---|
| `POST` | `/api/sessions` | Provider client | Make a session. Returns `{ providerKey, patientKey, providerUrl, patientUrl }`. |
| `GET` | `/api/sessions/:key` | Either client, with its own key | Change a key into `{ role, status }` for the first page render, before the socket connects. Returns an error if no session has that key. |
| `GET` | `/api/sessions/:providerKey/events` | Provider client only | Read the full event log (§5.2) for the session of that `providerKey`. Returns `{ events: Event[] }` in `id` order, oldest row first, where `Event` is `{ id, type, occurredAt, data }`. Returns `unknown_key` (§4.5) for a `patientKey`. The event log is provider history. The brief does not ask for it on the patient side. |

Nothing else belongs here. Everything that happens during a consultation is real time. It
belongs on the socket (§4.3), not in an HTTP poll.

A Zod schema from `shared` (§6.1) validates every path parameter and every body. A parse failure
returns `invalid_message` with status 400 (§4.5). No handler reads a raw parameter.

Section 4.5 gives the error body that every endpoint here returns. The event endpoint reads
persistence directly (§6.2). Past events do not need live state, so nothing about it goes through
the state machine.

### 4.3 Socket.IO

Socket.IO carries every real-time message (§2.1). Each client makes one connection and gives its
key in the handshake:

```ts
io(SERVER_URL, { auth: { key } });
```

The key is not in a URL. A URL reaches the browser history, the `Referer` header, and the access
log. A handshake field reaches none of them.

A Socket.IO middleware (`io.use`) runs for each new connection. It calls `resolveKey` (§6.2),
attaches the session ID and the role to the socket, and refuses the connection with `unknown_key`
(§4.5) when no session matches. The client never declares its own role (§4.1).

The middleware also refuses a second connection for a role that is already connected, and it
refuses every connection to a session in state `ENDED`. It accepts a connection for a role that
is not connected. That is the reconnect in §3.

Each socket then joins the room `session:<sessionId>`. A relay is `socket.to(room).emit(...)`,
so no module keeps a map of peer sockets. A room holds any number of sockets, which is what makes
the group-call extension in §7 small.

Socket.IO sends its own heartbeat. Set `pingInterval` to 10 seconds and `pingTimeout` to 20
seconds. The server then reports a `disconnect` about 30 seconds after a network fault that gives
no close frame. The grace timer and the `presence` flags (§3) depend on that report. Write no
heartbeat code.

**Do not enable `connectionStateRecovery`.** It restores missed packets for a short window only.
The `chat:history` event below fills the same need and also survives a page reload. Two
mechanisms for one job would disagree with each other.

There is no message envelope. Each row below is a Socket.IO event name, and the payload is the
argument to `emit`.

| Event | Direction | Payload | Meaning |
|---|---|---|---|
| `admit` | provider to server | `{}` | The provider admits the patient. |
| `session:state` | server to both | `{ state, since, reason, presence }` | The correct state. The server sends it on each transition (§3) and on each change of `presence`. `presence` is `{ provider: boolean, patient: boolean }`. `reason` has a value only in state `ENDED`, and it holds the same value as `sessions.ended_reason` (§5.1). |
| `peer:id` | peer to peer | `{ peerId }` | The PeerJS ID of the sender (§4.4). The server relays it and does not store it. |
| `chat:message` | peer to peer | `{ text, sentAt }` | Text chat. The server relays it and writes it to the event log (§5.2). |
| `patient:leave` | patient to server | `{}` | The patient leaves the consultation. The server sets `presence.patient` to false and writes a `patient_left` event. The session does not end. |
| `chat:history` | server to one client | `{ messages }` | Chat that the client missed. The server sends it once, on connection. Each item is `{ sender, text, sentAt }`. |
| `end-session` | provider to server | `{}` | The provider ends the consultation. |
| `error` | server to one client | `{ code, message }` | A protocol error. |

A Zod schema from `shared` (§6.1) parses every inbound payload before a handler sees it. A parse
failure returns `invalid_message` (§4.5), and the server drops the message.

No SDP and no ICE candidate passes through this connection. PeerJS carries its own signaling on
its own channel (§4.4). The Signaling module therefore holds no WebRTC logic of any kind. For
`peer:id` the server is a relay only: it sends the payload to the other socket in the room, and
it keeps no record of the ID.

There is no separate "patient has arrived" message. The provider learns it from `session:state`:
the state changes to `WAITING`, and `presence.patient` changes to true. A patient who rejoins the
waiting room changes `presence` only. Do not add a message that repeats either signal.

The server accepts a message only in the states below. It returns `not_allowed_in_state` (§4.5)
for any other message, and `session_ended` for any message in state `ENDED`. It also checks the
role: `admit` and `end-session` come from the provider only, and `patient:leave` comes from the
patient only.

| State | The server accepts |
|---|---|
| `CREATED` | `end-session` |
| `WAITING` | `admit`, `chat:message`, `patient:leave`, `end-session` |
| `ACTIVE` | `peer:id`, `chat:message`, `patient:leave`, `end-session` |
| `DISCONNECTED_GRACE` | `patient:leave` |
| `ENDED` | nothing |

A patient in the waiting room can therefore send chat. A patient who waits needs a way to say
that they are late, or that their camera does not work.

The server builds `chat:history` from the `chat_message_sent` rows in the event log (§5.2). The
Services module does that work with `getEvents` (§5.3), not the state machine (§6.2). Persistence
gains no function for it, and Signaling still never imports persistence.

### 4.4 Media

PeerJS wraps `RTCPeerConnection` (§2.1). The client writes no SDP code, no ICE code, and no track
handling code.

PeerJS carries its own signaling on its own channel. `ExpressPeerServer` mounts on the same
`http.Server` that Express and Socket.IO use, under the path `/peerjs`. There is still one
process and one port (§2).

Each client therefore holds two connections to the server: one Socket.IO connection for the
session (§4.3), and one PeerJS connection for media setup. That is the price of the dependency.
In exchange the design loses the offer relay, the answer relay, the ICE relay, and every line of
`RTCPeerConnection` code.

The flow starts when the session reaches `ACTIVE`. A client makes no `Peer` before that, so a
patient in the waiting room holds no media resources.

1. Each client makes a `Peer` and waits for its `open` event. PeerJS gives the peer a random ID.
2. Each client sends `peer:id` with that ID on its Socket.IO connection (§4.3). The server relays
   it to the other socket.
3. The provider client calls `peer.call(patientPeerId, localStream)`.
4. The patient client takes the `call` event and answers with `call.answer(localStream)`.
5. Each side takes the `stream` event and puts the remote stream into a `<video>` element.

**The provider always calls. The patient always answers.** Two peers therefore never call each
other at the same time. The provider client calls again whenever it receives a `peer:id` from the
patient and the media is not live. A reconnect on either side makes a new peer and a new
`peer:id`, so this one rule covers the first call and every later one. Nothing watches `presence`
for this purpose.

Set `config.iceServers` in the `Peer` constructor. Use a public STUN server only, for example
`stun:stun.l.google.com:19302`. This is enough for a demonstration on one network (§1). Section 7
gives the TURN extension point.

**Do not send chat on a PeerJS data channel.** PeerJS offers `peer.connect()` for data, and that
looks like a simplification. It is not. A data channel does not pass through the server, so the
server could not write the `chat_message_sent` rows that the brief asks for (§5.2). Chat stays on
Socket.IO.

**The PeerServer has no access control.** Anybody who reaches it can register a peer, and can call
any peer ID that they know. A peer ID is random, and a client learns the other peer ID only over
a Socket.IO connection that a key opened (§4.1), so an attacker must guess a random ID. Keep
`allow_discovery` at its default of false, so the PeerServer never lists the peers that it holds.
The design accepts this risk for the reason in §2: the app runs on one local network. A key now
guards the channel that reveals a peer ID, not the media path itself.

### 4.5 Errors

`packages/shared` (§6.1) holds one `ErrorCode` union. Both transports use the body
`{ code, message }`. Socket.IO sends it as an `error` event (§4.3), or as the handshake failure
when the middleware refuses the connection. An HTTP endpoint (§4.2) sends it as the response body
and maps the code to a status.

| Code | HTTP status | Meaning |
|---|---|---|
| `unknown_key` | 404 | No session has that key. |
| `session_ended` | 410 | The session is in state `ENDED` (§3). |
| `role_already_connected` | 409 | A socket for that role is already connected (§4.3). |
| `invalid_message` | 400 | A Zod schema (§6.1) rejected the body or the payload. |
| `not_allowed_in_state` | 409 | The event is not legal in the current state. |

The server returns `unknown_key` for a key that no session has, and also for a `patientKey` on a
provider-only endpoint. A different code for each case would tell a caller that the session
exists.

## 5. Data and persistence

The store is one local SQLite file, for example `data/app.db`. Only the repository interface
(§5.3) touches it. No other module writes SQL. SQLite is the correct choice here because the
brief excludes scaling and asks for a simple local app. A one-file embedded database needs no
separate service, and you can read it during development with `sqlite3 data/app.db`.

There are two tables. The server holds the live session state in memory (§3). It does not read
these tables during a call. The database is the durable record, not the live path.

### 5.1 `sessions`

One row for each consultation. The server writes the row at creation and at each transition. You
can therefore read the last state while the process is down.

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,       -- canonical session ID (§4.1)
  provider_key  TEXT NOT NULL UNIQUE,   -- in providerUrl
  patient_key   TEXT NOT NULL UNIQUE,   -- in patientUrl
  status        TEXT NOT NULL,          -- one of the states in §3
  created_at    TEXT NOT NULL,          -- ISO 8601 UTC
  ended_at      TEXT,                   -- ISO 8601 UTC, NULL until ENDED
  ended_reason  TEXT                    -- NULL until ENDED
    CHECK (ended_reason IS NULL OR ended_reason IN
           ('provider_ended', 'timeout', 'interrupted'))
);
```

- The server makes `id`, `provider_key`, and `patient_key` as random values, not as counters.
  The links contain the two keys (§4.1). A person could guess a counter and reach the other
  role.
- `status` is a `TEXT` column, not a foreign key to a lookup table. There are five fixed values,
  and one module decides them (§3). A lookup table adds a step and gives nothing back
  at this size. Examine this again if the set of values becomes much larger.
- There are no identity columns for the patient or the provider. The brief has no user accounts,
  and a key is an access token (§4.1).

### 5.2 `events`

The server only adds rows to this table. It never changes a row and never deletes a row. This
table is the "record of the session (events)" that the brief asks for.

```sql
CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  type         TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,          -- ISO 8601 UTC
  data         TEXT                    -- JSON text, shape depends on type; NULL if there is none
);

CREATE INDEX idx_events_session_id ON events(session_id);
```

This table is the one place that maps the state machine (§3) to rows.

| `type` | `data` (JSON) | The server writes the row when |
|---|---|---|
| `session_created` | `null` | the provider makes the session. |
| `patient_joined_waiting_room` | `null` | the patient socket connects with the patient key. |
| `patient_admitted` | `null` | the provider sends `admit`. |
| `patient_disconnected` | `null` | the patient socket disconnects before the session ends. |
| `patient_reconnected` | `null` | the patient socket reconnects. |
| `patient_left` | `null` | the patient sends `patient:leave` (§4.3). |
| `provider_disconnected` | `null` | the provider socket disconnects in state `WAITING` or in state `ACTIVE`. The grace timer starts. |
| `provider_reconnected` | `null` | the provider socket reconnects in the grace period. |
| `session_timed_out` | `null` | the grace period elapses with no provider reconnect. |
| `session_ended` | `{ "reason": "provider_ended" \| "timeout" \| "interrupted" }` | the session reaches `ENDED`. |
| `chat_message_sent` | `{ "sender": "provider" \| "patient", "text": "..." }` | either peer sends a chat message. |

Most transitions write one row. A timeout writes two rows: `session_timed_out` and then
`session_ended`. A chat message writes a row but is not a transition.

- `data` is one JSON text column, not a table for each event type. The event set is mixed and
  grows only at the end. Normalisation gives either one table with many empty columns or many
  small tables. Both are worse for the only query this log needs:
  `SELECT * FROM events WHERE session_id = ? ORDER BY id`. Move a field into a real column when
  you must filter on it. Do not normalise before that.
- Chat text is in this table and not in a `messages` table, for the same reason. Chat is one
  more thing that happened. It is not an entity with its own lifecycle. There is no edit, no
  delete, and no read receipt in scope. Split it out if chat gets attachments or delivery
  receipts (§7).
- `patient_disconnected` and `patient_left` have the same effect on `presence` but they are
  different facts. A disconnect may reverse itself. A departure is a decision. The provider waits
  after the first and ends the session after the second, so the log keeps them apart.
- There is no `updated_at` column and no soft-delete column. The server never changes a row. A
  later retention limit is a scheduled job over `sessions.created_at` and `sessions.ended_at`,
  not a change to the schema.

### 5.3 Repository interface

The persistence module gives the rest of the server these five functions and nothing else. This
is the only list of database operations in this document.

- `upsertSession(session): void`. Insert a `sessions` row or update one in place. Creation and
  each transition use this one function. Two functions could become different from each other.
- `getSession(id): Session | undefined`. Read one row by canonical ID.
- `getSessionByKey(key): Session | undefined`. Read one row by `provider_key` or `patient_key`.
  `resolveKey` (§6.2) uses it for both entry points (§4.2, §4.3).
- `recordEvent(sessionId, type, data?): void`. Insert one row into `events`.
- `getEvents(sessionId): Event[]`. Read the full log for a session, in `id` order. It backs
  `GET /api/sessions/:providerKey/events` (§4.2) and `chat:history` (§4.3).
- `listOpenSessions(): Session[]`. Read every row whose status is not `ENDED`. The start-up sweep
  in §3 needs it.

The Services module and the event recorder (§6.2) are the only callers. The state machine calls
nothing here.

This list is the reason that a change from SQLite to a hosted database is a real and limited
job. Section 7 points to this paragraph.

## 6. Code structure

The repo is an npm workspaces monorepo. The root holds `package.json`, `tsconfig.base.json`,
`vitest.config.ts`, and `biome.json`. There are three packages: `packages/shared`,
`packages/server`, and `packages/client`.

This section gives the dependency rules between modules. It does not give a directory tree. A
tree becomes wrong when a person splits a file or renames a folder. The boundaries below are
worth more. Treat all file names and directory names here as examples.

### 6.1 `packages/shared`

This package is the one place that holds the contract from section 4. It holds Zod schemas
(§2.1), not hand-written types: one schema for each HTTP body, each HTTP response, and each
Socket.IO payload, plus the session status (§3) and the `ErrorCode` union (§4.5). Both other
packages depend on it as a workspace dependency.

The TypeScript types come from the schemas with `z.infer`. There is therefore one definition for
each shape, and a validator and its type cannot become different from each other. Build the
Socket.IO generic parameters `ClientToServerEvents` and `ServerToClientEvents` from the same
inferred types. A wrong event name or a wrong payload then fails the build on both sides, before
any schema runs at run time.

Nothing in `shared` depends on `client` or on `server`. If a type must import from either one,
it belongs in that package instead.

### 6.2 `packages/server`

There are five modules and one subscriber. The dependencies between them go one way only.

**HTTP.** This module holds the Express routes for §4.2. It parses the request with a schema from
`shared`, calls Services or Session, and writes the response. It holds no state machine code and
no SQL.

**Signaling.** This module holds the Socket.IO layer from §4.3. Its job is transport. It
registers the handshake middleware, joins each socket to its room, parses each payload with a
schema from `shared`, and maps each event to a Services call or a Session command. Socket.IO does
the heartbeat, the reconnect, and the relay, so this module stays thin. It does not decide what an
event means for the session state. **Signaling never imports persistence.**

**Session.** This module is the state machine from §3 and nothing more: the in-memory registry,
the transition code, and the grace timer. It exposes commands, for example `admit`,
`setPresence`, and `endSession`, and it owns a typed event emitter. It emits on each transition
and on each change of presence.

Session holds no keys, reads no chat, and **never imports persistence**. It therefore has one
job, and every unit test for it runs with no socket and no database.

**Services.** This module holds the work that needs the database but is not a state transition.
Each function is separate and small.

- `createSession()`. Makes the ID and the two keys (§4.1), writes the first `sessions` row, adds
  the session to the registry, and returns the two links.
- `resolveKey(key)`. Returns `{ sessionId, role, status }` or nothing. The role derivation in
  §4.1 lives in this one function.
- `getSessionEvents(providerKey)`. Backs `GET /api/sessions/:providerKey/events` (§4.2). It calls
  persistence directly and never calls Session.
- `getChatHistory(sessionId)`. Builds the `chat:history` payload (§4.3).
- `endInterruptedSessions()`. The start-up sweep in §3.

**Event recorder.** This is a subscriber, not a caller. It subscribes to the Session emitter at
start-up. It turns each emission into a `recordEvent` call, and each transition also into an
`upsertSession` call (§5.3). **The state machine therefore never writes to the database.**
`createSession` writes the first `sessions` row because only that path holds the keys. Every
later write comes from this subscriber.

**Persistence.** This module implements the repository interface from §5.3 against SQLite. **It
is the only module that imports the SQLite driver or writes SQL.** Every other module depends on
the interface (§5.3).

Dependency direction:

```
HTTP      ---> Services ---> Persistence
Signaling ---> Services ---> Persistence
HTTP      ---> Session
Signaling ---> Session
Session ---(emitter)---> Event recorder ---> Persistence
Session ---(emitter)---> Signaling
```

Session depends on nothing. Nothing depends upward on HTTP or on Signaling. They are the two
entry points, not shared code.

The PeerServer (§4.4) is not a module. The composition root mounts `ExpressPeerServer` on the
`http.Server` and passes it no handler. No code in this repository reads a PeerJS message, which
is the whole reason to take the dependency.

### 6.3 `packages/client`

This is a React single-page app with Vite. Section 2 gives the reason for React.

- **The provider view and the patient view are separate top-level components.** They are not one
  component with a role condition inside it. The two screens differ enough in content and in
  actions. A shared component becomes a set of role conditions. Factor out shared *behaviour*.
  Do not force shared *rendering*.
- **A session and socket layer that both views use.** It knows nothing about either view. It
  wraps the HTTP calls (§4.2) and the Socket.IO client, and it turns socket events into React
  state. It holds no reconnect code and no backoff code: the Socket.IO client does that work
  (§2.1). It uses the types from `shared`. One socket serves the whole app. Do not open a second
  one in a view.
- **A media layer that never imports the socket layer.** It wraps the PeerJS `Peer` (§4.4): local
  media capture, the peer lifecycle, and the call. It exposes callbacks, for example "my peer ID
  is ready" and "remote stream is ready", and methods, for example "call this peer ID". It never
  emits a socket event itself. The views carry a peer ID from this layer to the socket layer and
  back. The media wrapper therefore stays testable, and a different media library can replace it
  without a change to the session code.
- **Chat uses the socket layer. It is not a peer of it.** Chat sends and receives `chat:message`
  on the connection that the session layer owns. It does not open its own socket.

### 6.4 Tests

Put `*.test.ts` and `*.test.tsx` files next to the code that they test. The root
`vitest.config.ts` runs them. Use one test location convention in the repo. Do not add a
parallel `__tests__` directory.

End-to-end tests are the exception. Put them in a top-level `tests/` directory and run them as a
separate Vitest project. They exercise the client and the server together.

### 6.5 Excluded structures

- There is no `packages/db` workspace package. Persistence is inside `server` because nothing
  outside the server process reads the database. The client reaches it only through the HTTP and
  Socket.IO interfaces (§2).
- There is no API gateway and no split into microservices. One server process is what "a simple,
  local application" means (§1). Two processes for signaling and REST pay off only under the
  scaling concerns that the brief excludes.

## 7. Extension points

These are the points to design new code around.

- **TURN relay.** The client holds a fixed STUN URL today (§4.4). There is no config endpoint,
  and this app does not need one. To add TURN, add `GET /api/config` that returns `iceServers`,
  then read it in the client before the client makes the `Peer`. Nothing else changes.
- **Group calls.** This is the one extension that PeerJS makes harder, not easier. The session
  side is ready: the registry and the event log use the session as the key, not a fixed number of
  peers, and a Socket.IO room already holds any number of sockets (§4.3). A third `peer:id` needs
  no protocol change. The media side is the problem. PeerJS connects one peer to one peer and it
  has no SFU. Three participants need either a mesh of PeerJS calls, which costs one more upload
  stream for each extra peer, or a different media library in place of PeerJS. The meaning of
  `admit` for more than one patient also needs a decision, and the role keys (§4.1) must become
  one key for each participant.
- **Real authentication.** The role keys (§4.1) are access tokens, not identities. Real
  authentication adds an identity check in the Express middleware chain and in the Socket.IO
  handshake middleware (§4.3). The PeerServer needs its own check, and it has none today (§4.4).
  None of this changes the state machine (§3) or the event schema (§5.2).
- **A hosted database in place of SQLite.** Write a new implementation of the repository
  interface (§5.3). Do not touch the signaling code or the session code.

## 8. Distance from the repository

This document describes a design. The repository does not hold it yet. These are the
differences, as of the last edit of this document.

- `packages/shared` (§6.1) does not exist. There are two packages, not three.
- The client is not a React app (§6.3). Its entry point is `packages/client/src/main.ts`.
- There is no test file anywhere. An earlier document named
  `packages/server/src/index.test.ts` as the existing convention. That file is not in the
  repository.
- The server (§6.2) has no modules. `packages/server/src/index.ts` is empty.
- None of the dependencies in §2.1 are installed. The tree holds only `typescript`, `vitest`,
  and `@biomejs/biome`.
- There is no `data/app.db` (§5).
