# 0006. Chat over the WebRTC data channel

Chat is designed to travel over Socket.IO, where the server relays each message and writes its
text to the event log. That puts consultation content on our server. This plan moves chat onto the
WebRTC data channel so no message text reaches the server at all, and pays for the three things
the server was doing for chat: logging it, replaying it after a reconnect, and carrying it while
the patient waits.

[architecture.md](../architecture.md) was amended for this in §2, §4.3, §4.4, §5.2, §6.2, §6.3 and
§7 before this plan was written. The design there is authoritative; this plan is the route from
the code as it stands to that design.

## Problem

**Chat text is currently a server concern in three places.**

[socket.ts:23-27](../../packages/shared/src/socket.ts#L23-L27) defines `ChatMessagePayload` as
`{ text, sentAt }` and [socket.ts:63](../../packages/shared/src/socket.ts#L63) and
[:71](../../packages/shared/src/socket.ts#L71) put `chat:message` on both the client-to-server and
server-to-client event maps. Every message is therefore typed to pass through the server process.

[events.ts:16](../../packages/shared/src/events.ts#L16) has `chat_message_sent` in the
`EventType` enum and [events.ts:26-31](../../packages/shared/src/events.ts#L26-L31) defines its
`data` as `{ sender, text }`. Chat text is a column value in the durable event log.

[socket.ts:42-54](../../packages/shared/src/socket.ts#L42-L54) defines `chat:history` as a
server-to-client replay built from those rows. The server is the only thing that can restore a
transcript after a reconnect.

**Nothing above is implemented yet, which is why now is the time.** `grep -rl chat packages/*/src`
returns four files, all of them type definitions or their tests:
[shared/src/socket.ts](../../packages/shared/src/socket.ts),
[shared/src/events.ts](../../packages/shared/src/events.ts),
[shared/src/events.test.ts](../../packages/shared/src/events.test.ts), and
[sessionRepository.test.ts:118](../../packages/server/src/persistence/sessionRepository.test.ts#L118),
which uses `chat_message_sent` only as a fixture for a `recordEvent` test. There is no chat
handler in `packages/server/src`, no chat UI in `packages/client/src/views`, and no chat hook.
The cost of the change is a type deletion and a green field. It will not be, once chat is built.

**The client peer layer cannot host a data channel in its present shape.**
[useMedia.ts:51](../../packages/client/src/media/useMedia.ts#L51) takes a `createPeer` factory and
calls it inside the hook. The resulting `MediaPeer` never leaves:
`UseMediaResult` ([useMedia.ts:28-34](../../packages/client/src/media/useMedia.ts#L28-L34))
exposes `localStream`, `remoteStream`, `localPeerId`, `error` and `callPeer`, and no peer. The
`MediaPeer` interface ([useMedia.ts:11-17](../../packages/client/src/media/useMedia.ts#L11-L17))
declares only `open`, `call` and `error` — it has no `connect` and no `connection` event, so it
cannot express a data channel even if a caller could reach it. Chat needs the same peer connection
the media rides on, and today there is no way for a second module to get at it.

**Architecture §4.4 said the opposite until this week.** It carried a paragraph headed "Do not
send chat on a PeerJS data channel", whose stated reason was that the server could not then write
the `chat_message_sent` rows the brief asks for. That reason is real. The privacy requirement
overrides it, and §4.4 and §5.2 now say so, but a reader who remembers the old rule needs to know
it was reversed deliberately rather than forgotten.

## Spec

**Chat only exists in `ACTIVE`.** A patient in the waiting room has no chat input and no way to
send text to the provider. The provider sees patient presence and nothing more. Chat becomes
available when the data channel opens and unavailable when it closes.

**Messages travel peer to peer only.** Sending a message produces no HTTP request and no socket
emission. A message has a UUID, a sender role, text, and an ISO 8601 `sentAt`.

**The event log records no chat.** After a session with any number of messages,
`GET /api/sessions/:providerKey/events` returns rows for connection and transition facts only.
No row's `type` or `data` mentions chat, a message, a sender of a message, or a count of them.

**A reconnect restores the transcript.** When the data channel opens, each peer sends the other
its full transcript. Each side merges the two by UUID and orders the result by `sentAt`. After
the exchange both peers show the same messages in the same order, each message once. This holds
whichever side dropped, and holds when neither did — an exchange between two peers that already
agree changes nothing on either.

**A reload restores the transcript without the other peer.** Each client writes its transcript to
`sessionStorage` under the session ID and reads it on mount. A client that reloads while the other
peer is away still shows the messages it had. Closing the tab discards them.

**Error cases.**

- Sending while the data channel is not open: the message is refused and the composer says chat
  is unavailable. It is not queued. A queued message that arrives after a reconnect is worse than
  one that was never sent, because the sender believed it was delivered.
- A malformed or unparseable inbound message: dropped, and the transcript is unchanged. A peer
  cannot corrupt the other side's transcript with a bad payload.
- Unreadable or full `sessionStorage`: chat still works for the live session. Persistence is a
  backstop, never a precondition.
- A transcript that is lost from both browsers is unrecoverable. This is a property of the design,
  not a failure to handle.

## Not in scope

- **Attachments, edit, delete, read receipts, typing indicators.** None is in the brief.
- **A retained transcript on the server.** Architecture §7 has the extension point, and it needs a
  key custody decision first.
- **Any waiting-room signal from patient to provider.** Canned non-text signals were considered
  and rejected: the waiting room stays presence-only.
- **Encrypting `sessionStorage`.** The threat this plan addresses is content reaching our server.
  A transcript at rest in the patient's own browser, for the life of the tab, is a different
  threat with a different answer.

## Approach

**The type deletion comes first, and it is the cheapest step in the plan.** Remove
`chat:message`, `chat:history` and their payload schemas from
[shared/src/socket.ts](../../packages/shared/src/socket.ts); remove `chat_message_sent` and
`ChatMessageEventDataSchema` from [shared/src/events.ts](../../packages/shared/src/events.ts) and
its `describe` block from [events.test.ts](../../packages/shared/src/events.test.ts); give
[sessionRepository.test.ts:118](../../packages/server/src/persistence/sessionRepository.test.ts#L118)
a different event type for its fixture. Doing this first makes the compiler enforce the rest of
the plan: after it, no code can route chat through the server without failing `tsc`. Doing it last
would leave the old path available for the whole of the work.

**Then restructure peer ownership, which is the step most likely to force a rethink.** Chat and
media must share one `Peer`, and `useMedia` currently owns it privately. The peer lifecycle —
create on `ACTIVE`, destroy on leaving it, survive a socket reconnect — has to move to one place
that hands the live peer to both consumers. Everything downstream assumes this shape, so if the
extraction turns out to be wrong, it is better to find out before a chat hook and a chat UI are
built on top of it. `MediaPeer` also grows `connect` and a `connection` event; the existing hand
interfaces in [useMedia.ts:3-17](../../packages/client/src/media/useMedia.ts#L3-L17) are what keep
these tests free of a real `RTCPeerConnection`, so extend them rather than reaching for the PeerJS
types directly.

**The merge is a pure function and gets written on its own, before anything calls it.** Take two
transcripts, return one: deduplicated by UUID, ordered by `sentAt`. It has no React in it, no peer
in it, and no storage in it, which is why it is the one part of this work that can be tested
exhaustively — duplicates, disjoint sets, identical sets, out-of-order arrivals, and an empty side.
Every reconnect correctness property in the Spec reduces to this function being right.

**Then the chat module, then the UI, then `sessionStorage` last.** The chat module owns the data
channel, holds the transcript, and calls the merge function on `open`. The UI is a composer and a
message list, disabled unless the channel is open. Persistence goes last because it is the only
part that is a backstop rather than a feature: chat must already work correctly with it absent,
and building it last is what proves that.

**A note on ordering the peer-ownership step against the type deletion.** They are independent and
could go in either order. The type deletion goes first anyway because it is small, it is certain,
and it closes the wrong path before anyone is tempted by it under time pressure.

## Open questions

None. The four design decisions behind this plan — no chat rows in the event log, peer-to-peer
replay, no waiting-room chat, and one peer layer with media and chat as separate modules inside it
— were settled before the architecture was amended.
