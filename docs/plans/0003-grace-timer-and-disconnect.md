# 0003. The grace timer and the provider disconnect path

The third slice of [architecture.md](../architecture.md). Plans 0001 and 0002 built a session two
browsers can join, admit into, and hold a call in. Both assumed the provider stays connected.
This plan makes the other half of §3 real: a provider socket drop moves the session to
`DISCONNECTED_GRACE`, a reconnect inside `RECONNECT_GRACE_PERIOD` restores the state it left, and
an elapsed timer ends the session with the reason `timeout`.

## Problem

`DISCONNECTED_GRACE` is a state no code can reach. `grep -rn DISCONNECTED_GRACE packages/*/src`
returns four hits: the enum in
[status.ts:7](../../packages/shared/src/status.ts#L7), its test, and two entries in the
allowed-state lists at
[signaling.ts:49](../../packages/server/src/signaling/signaling.ts#L49). Nothing assigns it.
`grep -rn "setTimeout\|provider_disconnected\|provider_reconnected\|session_timed_out"
packages/server/src packages/client/src` finds none of the three event types and no timer outside
one `await` in a test.

Four concrete gaps.

- **The registry has no provider-disconnect command.**
  [sessionRegistry.ts](../../packages/server/src/session/sessionRegistry.ts) exposes
  `patientConnected`, `providerConnected`, `admit`, `endSession`, `patientLeft`,
  `patientDisconnected`, `patientReconnected`. There is no `providerDisconnected`, no stored
  pre-closure state, and no timer. §6.2 says this module owns "the in-memory registry, the
  transition code, and the grace timer"; it owns the first two.
- **Signaling drops the provider's disconnect on the floor.** The handler at
  [signaling.ts:207-222](../../packages/server/src/signaling/signaling.ts#L207-L222) deletes the
  socket from `connectedSockets` and then acts only `if (role === "patient")`. A provider closing
  the tab leaves the session in `ACTIVE` with `presence.provider` still true, forever.
- **A provider reconnect is indistinguishable from a first connect.**
  [`providerConnected`](../../packages/server/src/session/sessionRegistry.ts#L86) returns early
  when `presence.provider` is already true and otherwise emits `presence`. It can never emit a
  transition, so it could not restore a state or write `provider_reconnected`.
- **The client would never show the ended screen after a timeout.** §3 requires that a post-grace
  reconnect refusal puts the client on the ended screen rather than in a retry loop. The
  `connect_error` handler at
  [useSession.ts:73-82](../../packages/client/src/session/useSession.ts#L73-L82) returns early
  whenever the socket has ever connected — the fix from cth-18, which stopped a transient
  reconnect failure tearing down a live call. A handshake refusal on reconnect arrives through
  that same callback, so it is swallowed: socket.io-client stops retrying after a middleware
  refusal, and the provider's tab sits on a stale `ACTIVE` with no socket and no error.

Observable today: open both tabs, admit, then kill the provider tab. The patient's tab still reads
`State: ACTIVE`, `presence.provider` stays true, the camera stays on, and the session never ends.
Ten minutes later, nothing has happened. The `sessions` row still says `ACTIVE` until the next
server restart sweeps it to `interrupted` — which is the wrong reason and the wrong time.

## Spec

**A provider drop in `WAITING` or `ACTIVE` starts the grace period.** The session moves to
`DISCONNECTED_GRACE`, `presence.provider` becomes false, a `provider_disconnected` event is
written, and both the state and the presence reach the patient's socket in one `session:state`.
The registry remembers the state it left. `RECONNECT_GRACE_PERIOD` is 10 minutes; it is
configurable at construction so a test can run in milliseconds, and its default lives in exactly
one place.

**A provider drop in `CREATED` starts no timer.** `presence.provider` becomes false and the
session stays `CREATED`. This is the known limit §3 accepts: a session nobody ever opened is ended
only by the start-up sweep. A drop in `ENDED` does nothing.

**A provider reconnect inside the period restores the state it left.** The timer is cancelled, the
session returns to `WAITING` or `ACTIVE` — whichever it held before the drop — `presence.provider`
becomes true, and a `provider_reconnected` event is written. The patient sees one `session:state`
carrying the restored state. If the session was `ACTIVE`, both clients hold live media or rebuild
it by the existing §4.4 rule; no new rule is needed for the reconnect case.

**A patient leave during the grace period rewrites what is remembered.** `patient:leave` is legal
in `DISCONNECTED_GRACE` (§4.3). It sets `presence.patient` false and, when the remembered state is
`ACTIVE`, demotes the remembered state to `WAITING`. A provider who then reconnects lands in
`WAITING` and must admit again. Restoring `ACTIVE` with no patient present would be a state that
contradicts its own presence flags.

**An elapsed period ends the session with the reason `timeout`.** The event log gains a
`session_timed_out` row and then a `session_ended` row carrying `{ "reason": "timeout" }`, in that
order, and the `sessions` row reaches `status = 'ENDED'`, `ended_reason = 'timeout'`, with
`ended_at` set. A patient still connected receives `session:state` with state `ENDED` and reason
`timeout` and shows the ended screen. Every later connection from either key is refused by the
handshake middleware with `session_ended`.

**Ending a session cancels any pending timer.** `end-session` during the grace period, and any
other route to `ENDED`, leaves no scheduled callback behind. A pending timer never keeps the Node
process alive on its own: a server with one session waiting out its grace period still exits when
nothing else holds it open.

**A handshake refusal on reconnect is terminal on the client.** When a `connect_error` carries an
`ErrorPayload` — which only a middleware refusal does — the client moves to its error state and
shows the message, whether or not it had connected before. A `connect_error` with no payload is
still ignored once connected, because that is the transient transport failure cth-18 covered.

**Error cases.**

- `providerDisconnected` for a session ID the registry does not hold throws, as every other
  registry command does.
- A second `providerDisconnected` while already in `DISCONNECTED_GRACE` does not restart the
  timer and writes no second event.
- A superseded provider socket's late `disconnect` must not start a grace period for the session
  its replacement is already holding. The `connectedSockets` identity check at
  [signaling.ts:210](../../packages/server/src/signaling/signaling.ts#L210) is the guard, and it
  must run before the provider branch just as it does before the patient branch.
- `admit`, `peer:id` and `end-session` keep the state lists they have; only `patient:leave` and
  `end-session` are legal in `DISCONNECTED_GRACE` (§4.3).

## Not in scope

- **Chat.** `chat:message`, `chat:history` and the `chat_message_sent` rows are their own slice.
- **Recovering the patient's peer ID after a provider reload** (cth-20). A provider reconnect into
  `ACTIVE` restores the session; whether the media comes back without the patient re-sending its
  peer ID is that task's problem, not this one.
- **A countdown in the UI.** The patient's view renders the state name. Telling the patient how
  many minutes remain needs a deadline on the wire and is a later change.
- **Pausing the patient's camera during the grace period.** The patient's media follows `ACTIVE`
  and nothing else ([PatientView.tsx:17-20](../../packages/client/src/views/PatientView.tsx#L17-L20)),
  so a provider drop stops the patient's capture and a reconnect restarts it. That is the rule
  plan 0002 set and this plan keeps it.

## Approach

**The registry comes first, and it is the step most likely to force a rethink.** Everything else
is wiring. Two design questions land here.

The first is how the timeout writes two events. The event recorder turns one `transition`
emission into one `recordEvent` plus one `upsertSession`, so a single transition cannot produce
both `session_timed_out` and `session_ended`. The timeout path therefore emits two transitions:
`session_timed_out` with `from` equal to `to`, in the way presence changes already ride on
`transition` ([sessionRegistry.ts:173](../../packages/server/src/session/sessionRegistry.ts#L173)),
and then the ordinary `session_ended` transition to `ENDED`. Signaling broadcasts both, so the
patient receives a redundant `DISCONNECTED_GRACE` frame immediately before the `ENDED` one.
Clients render the state they are given rather than applying deltas, so this is harmless — but if
it turns out not to be, the alternative is to widen the transition event with a list of extra
event types, and that is worth knowing before the wiring is built on top.

The second is the timer itself. The registry takes the grace period as a constructor option and
schedules with `setTimeout`, unreferenced so it cannot hold the process open. Tests set the period
to a few milliseconds or drive fake timers; they still run with no socket and no database, which
is the §6.2 constraint on this module.

**Then signaling.** The provider branch in the `disconnect` handler and a reconnect-aware
`providerConnected` in the `connection` handler. The registry decides what a disconnect means;
signaling only reports that one happened, so this step should be a handful of lines. The identity
check that guards the patient branch guards this one too.

**Then the client.** Narrow the `connect_error` early return so a payload-carrying refusal is
terminal. This is a two-line change to a well-tested file and is independent of the server work,
so it can land in either order — but it is the step that makes the whole path visible end to end,
so leaving it last keeps the manual check honest.

**Finally, walk it.** Admit a patient, kill the provider tab, watch the patient's state go to
`DISCONNECTED_GRACE` and the camera light go out; reopen the provider link and watch `ACTIVE`
return. Then repeat with a one-second grace period and confirm the patient reaches the ended
screen with the reason `timeout` and that the provider's link is refused afterwards.
