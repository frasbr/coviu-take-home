# 0002. A live audio/video call over PeerJS

The second slice of [architecture.md](../architecture.md). Plan 0001 left a session that two
browsers can join, admit into, and end. Nothing in either process has ever touched media. This
plan makes §4.4 real: a PeerServer on the existing `http.Server`, a `peer:id` relay in Signaling,
a client media layer that owns the `Peer`, and two `<video>` elements that show each other once
the session reaches `ACTIVE`.

## Problem

`grep -ril peer packages/server/src packages/client/src` returns nothing. Both media
dependencies are installed and neither is imported: `peerjs@1.5.5` in
[packages/client/package.json](../../packages/client/package.json) and `peer@1.0.2` in
[packages/server/package.json](../../packages/server/package.json).

Concretely, four things §4.4 requires are absent.

- **No PeerServer.** [packages/server/src/index.ts](../../packages/server/src/index.ts) builds the
  `http.Server`, attaches Express and Socket.IO, and listens. It never calls `ExpressPeerServer`,
  so nothing serves `/peerjs` and a client `Peer` would reach PeerJS's public cloud server instead
  of this process.
- **No `peer:id` relay.** [signaling.ts](../../packages/server/src/signaling/signaling.ts)
  registers `admit`, `end-session`, and `patient:leave`. There is no `socket.on("peer:id", …)`, so
  the one message that carries a peer ID between the two browsers is declared in `shared` and
  handled nowhere. `PeerIdPayloadSchema` sits at
  [packages/shared/src/socket.ts:21](../../packages/shared/src/socket.ts#L21) with no importer.
- **No media layer in the client.** `packages/client/src` holds `session/` and `views/` only.
  There is no `media/`, no `getUserMedia` call, and no `<video>` element in either
  [ProviderView.tsx](../../packages/client/src/views/ProviderView.tsx) or
  [PatientView.tsx](../../packages/client/src/views/PatientView.tsx). Both views render the state
  name and a button.
- **No way to carry a peer ID across the seam.** `useSession`
  ([useSession.ts](../../packages/client/src/session/useSession.ts)) exposes `admit`,
  `endSession`, and `leave`. It cannot send `peer:id` and does not listen for one, so the views
  have nothing to pass between the media layer and the socket layer — which §6.3 says is exactly
  their job.

The observable effect: admit a patient today and both tabs print `State: ACTIVE` and stop. No
camera light, no audio, no video element.

## Spec

**The PeerServer answers on the existing port.** `ExpressPeerServer` mounts on the same
`http.Server` under `/peerjs`. There is still one process and one port. A request to `/peerjs`
from the client origin succeeds cross-origin (the client runs on `:5173`, the server on `:3001`),
and a `Peer` constructed against it reaches `open` with a random ID. `allow_discovery` stays at
its default of `false`, so the PeerServer never lists its peers. No code in this repository reads
a PeerJS message.

**`peer:id` relays and is not stored.** In state `ACTIVE`, a `peer:id` from either role reaches
the other socket in the room and nobody else — the sender does not receive its own. The server
keeps no record of any peer ID: no registry field, no `events` row, nothing in the session state.
A malformed payload returns `invalid_message` and the message is dropped. A `peer:id` in any state
other than `ACTIVE` returns `not_allowed_in_state`, and in `ENDED` returns `session_ended`. Both
roles may send it, which makes it the first message in the protocol that is not role-restricted.

**The media layer owns the `Peer` and imports no socket code.** It captures local audio and video,
creates the `Peer` with `config.iceServers` set to a public STUN server, and exposes: the local
stream, the remote stream, the local peer ID once `open` has fired, and a way to call a given peer
ID. It never emits a Socket.IO event. A caller can substitute a fake `Peer` factory, so its tests
run with no network and no real `getUserMedia`.

**No `Peer` exists before `ACTIVE`.** A patient sitting in the waiting room holds no camera, no
microphone, and no peer registration. Entering `ACTIVE` acquires both; leaving `ACTIVE` for
`ENDED` releases them — every track stopped, the peer destroyed, both video elements cleared. The
camera indicator light going out is the check.

**The provider calls, the patient answers.** The provider client calls
`peer.call(patientPeerId, localStream)` whenever it holds a patient peer ID and the media is not
live. The patient client answers the incoming `call` with its local stream. Each side puts the
remote `stream` into a `<video>` element, muted for the local preview and unmuted for the remote.
Two peers never call each other at the same time.

**Order of arrival does not matter.** A `peer:id` that arrives before the local `Peer` is open, or
before the local stream is captured, still results in a call. Both orderings — provider peer ready
first, patient peer ready first — reach a live call with no reload and no second admit. This is
the case most likely to be built wrong, because the server keeps no peer ID to replay.

**Media failure does not break the session.** A denied camera permission, a `peer.on('error')`, or
a `call.on('close')` shows a message in the affected view and leaves the session in `ACTIVE` with
the socket connected. The provider can still end the session, and a `session:state` still renders.
Nothing about a media fault touches the state machine — §3 lists no media transition, and this
plan adds none.

**Dropping the socket does not destroy the peer.** §3 is explicit: the two connections fail
independently. A Socket.IO reconnect while media is live must not tear down or re-create the call.

Observable at the end: start both dev processes, `POST /api/sessions`, open the provider link and
the patient link in two tabs on one machine, admit, and each tab shows the other tab's camera with
audio flowing. `sqlite3 data/app.db "select type from events"` shows no new event type — media
leaves no trace in the log, by design.

## Not in scope

- Chat (`chat:message`, `chat:history`) and the `chat_message_sent` event rows.
- `GET /api/sessions/:providerKey/events`.
- The grace timer, `DISCONNECTED_GRACE`, and the reconnect events. The registry still has no
  `patientDisconnected`, so a patient disconnect leaves `presence.patient` true; that is the next
  plan's problem, not this one.
- Mute and camera-off controls. Getting one call up comes first.
- A TURN server and `GET /api/config` (§7). A hardcoded STUN URL is what §4.4 asks for.
- Access control on the PeerServer. §4.4 accepts that risk explicitly and gives the reason.
- Any visual design beyond two video elements large enough to see.
- End-to-end tests in a top-level `tests/` project. A real call needs two browsers and real media
  devices; verify this slice by hand and keep unit tests around the seams.

## Approach

**The server goes first, in two independent pieces, because the client cannot be tested against
nothing.** Mount `ExpressPeerServer` in the composition root — §6.2 says the PeerServer is not a
module and gets no handler, so this is a few lines in `index.ts` and no new file. Then add the
`peer:id` relay to Signaling. The relay needs a legality check that is role-agnostic, and
`checkLegal` in [signaling.ts](../../packages/server/src/signaling/signaling.ts) currently takes a
required role as its first concern; widen it rather than writing a second near-copy of the state
check beside it. Use `socket.to(room).emit(...)` so the sender is excluded and Signaling still
keeps no map of peer sockets.

Expect a CORS problem here, and treat it as expected rather than as a surprise. The PeerJS client
makes an HTTP call to `/peerjs` before it upgrades to a WebSocket, and cth-12 already fixed this
class of bug for `/api` and the Socket.IO handshake. `app.use(cors(...))` in
[http.ts](../../packages/server/src/http/http.ts) is registered before the routes, so mounting the
PeerServer on the same `app` should inherit it — confirm that in a real browser and not only in a
test, because the failure surfaces as a silent `Peer` that never opens.

**The media layer comes next and is the step most likely to force a rethink.** It is the piece
with no precedent in the repo: everything else this slice touches has a sibling to copy. Two
things decide whether it stays testable. It must take its `Peer` factory and its `getUserMedia`
from outside rather than reaching for the globals, because `jsdom` has neither and a hook that
calls them directly can only be tested by mocking the module. And it must expose plain callbacks
and values, not sockets — §6.3 says the media layer never imports the socket layer, and one
`import` in the wrong direction is what collapses this boundary.

**Then widen `useSession`,** with `sendPeerId` and the last peer ID received from the other side.
Latching the received ID as state, rather than handing it to a callback and forgetting it, is what
makes the ordering case in the Spec fall out for free: the provider view re-renders whenever
either the latched patient ID or its own readiness changes, and the call fires on the render where
both are true. The temptation is a `useEffect` that calls on receipt of `peer:id`; that version
breaks whenever the patient's peer opens first, which on a fast machine is most of the time.

**The views go last** and stay thin: wire the two layers together and render the video elements.
The provider view carries a peer ID from media to socket and a peer ID from socket to media. That
is the whole of its media logic — if it grows a third concern, the seam is in the wrong place.

Verify by hand in two tabs before calling it done. Unit tests cover the relay, the state
legality, the media wrapper against a fake `Peer`, and the widened `useSession`. None of them can
tell you whether a real `RTCPeerConnection` completed an ICE exchange.

## Open questions

- §0 of [architecture.md](../architecture.md) says "Section 8 lists where the repository does not
  match the document yet", but the document now ends at §7 — plan 0001 said to delete §8's entries
  as they landed, and the section went with them. That sentence is now a dangling reference.
  Confirm it should be deleted rather than §8 restored as a standing gap list.
