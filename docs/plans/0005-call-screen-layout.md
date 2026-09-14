# 0005. The call screen layout

Every view in `packages/client` renders unstyled HTML: no stylesheet exists in the repo, so the
call sits as two 320px videos stacked at the top-left of a white page, with the controls above
them as bare `<button>` elements. This plan gives the call a screen layout in the shape of a
video-call client — a video area that fills the viewport and centres the feeds, and a control bar
fixed along the bottom — and adds Tailwind to `packages/client` to build it with.

## Problem

**There is no CSS in the client at all.** `find packages/client/src -name '*.css'` returns
nothing, [index.html](../../packages/client/index.html) links no stylesheet, and
[main.tsx](../../packages/client/src/main.tsx#L1-L15) imports none. Every element renders at the
user-agent default.

**The videos are 320px wide and top-left aligned.**
[VideoPanel.tsx:11](../../packages/client/src/views/VideoPanel.tsx#L11) sets
`const VIDEO_WIDTH = 320` and passes it as the `width` attribute on both `<video>` elements
([:44](../../packages/client/src/views/VideoPanel.tsx#L44),
[:54](../../packages/client/src/views/VideoPanel.tsx#L54)). The two feeds sit in sibling `<div>`s,
so they stack vertically in the top-left corner. On a 1440×900 display the call occupies roughly
320×480 of 1.3M pixels; the rest of the page is white. This is the "too much empty space" in the
request.

**The controls are above the video, in source order, as unstyled buttons.**
[ProviderView.tsx:61-98](../../packages/client/src/views/ProviderView.tsx#L61-L98) renders, in
this order: an `<h1>`, `State: {state.state}`, `Patient: connected|not connected`, the
`Admit patient` button, the `End session` button, the ended-session history `<section>`, and only
then the `VideoPanel`.
[PatientView.tsx:51-67](../../packages/client/src/views/PatientView.tsx#L51-L67) has the same
shape with a single `Leave` button. The controls therefore push the video down the page and the
page grows a scrollbar once the history list is long.

**There is no visual treatment of state.** `State: ACTIVE` and
`Patient: not connected` are plain paragraphs. Nothing distinguishes the waiting room from a live
call other than the words.

**The architecture forbids what this plan does.**
[§1](../architecture.md) says "There is no CI/CD pipeline, no design system, and no mobile app",
and [§2.1](../architecture.md) says "Add a dependency only when it removes code that this document
describes. A package that replaces nothing here does not belong in the tree." Tailwind replaces no
code this document describes. Both lines need amending, and that amendment is part of this work,
not a side effect of it.

## Spec

**The call screen fills the viewport and never scrolls.** The provider and patient call screens
occupy exactly the viewport height. The video area takes the height that the control bar does not,
and the page has no vertical scrollbar at any viewport size at or above 320×480. Content that can
grow without bound — the ended-session history — scrolls inside its own container, not by growing
the page.

**The remote feed is the screen; the local feed is an inset.** The remote video is centred in the
video area and scales to fill it while keeping its aspect ratio, cropping rather than letterboxing.
The local video is a small picture-in-picture tile in a corner of the video area, overlapping the
remote feed. Each feed keeps a visible role label — `Provider`, `Patient` — and each keeps its
current accessible name (`Remote video`, `Local video`), because
[VideoPanel.test.tsx](../../packages/client/src/views/VideoPanel.test.tsx#L11-L13) queries by
those labels and they are how a screen reader tells the two apart.

**A feed with no stream shows a placeholder, not a black rectangle.** Before the patient is
admitted, before capture resolves, and after the remote side leaves, `remoteStream` is `null`.
That tile shows the role name and a short line naming the reason the feed is absent — waiting to
be admitted, waiting for the other side — rather than an empty video element.

**All controls live in a bar across the bottom of the viewport.** The bar spans the full width,
sits below the video area, and holds every action the view offers: `Admit patient` and
`End session` for the provider, `Leave` for the patient. The session state and the patient
presence readout move into the bar as a status region on one side; they leave the top of the page.
There is no `<h1>` above the video on the call screens.

**Which buttons appear is unchanged.** `Admit patient` shows only in `WAITING`; `End session` and
`Leave` show in every state but `ENDED`. This plan moves and styles them and changes no condition.
`End session` reads as the destructive action and is visually distinct from `Admit patient`.

**The ended screen is not the call screen.** When the state is `ENDED` there is no video and no
control bar. The provider's ended screen is a centred panel holding the session history; the
patient's is a centred message. The history list scrolls within the panel.

**The error and loading states stay legible.** `Loading session…`, the `Session unavailable`
alert, and the media error from
[useMedia](../../packages/client/src/media/useMedia.ts#L36-L38) each render as centred content on
the same background. The media error keeps `role="alert"` and appears over the video area rather
than displacing it.

**The home screen gets the same surface treatment.**
[HomeView](../../packages/client/src/views/HomeView.tsx) is a centred card with the create button
and, once created, the two links. It is not a call screen and gets no control bar.

**Every existing client test still passes unmodified, except where the spec above moved
something.** The 622 lines of view tests query by role, label and text — `getByText("Patient")`,
`getByRole("alert")`, `getByLabelText("Local video")` — none of which a layout change should
break. A test that breaks is either a spec change named above or a defect in the change.

## Not in scope

- **Mic and camera toggles.** A real call bar has them; `useMedia` has no way to mute a track and
  adding one is media-layer work, not layout work. Decided out on 2026-09-14.
- **Screen share, chat panel, participant list, speaker/gallery switch.** No feature work; this
  plan moves and styles what exists.
- **A dark/light theme toggle.** The call screen is dark because that is the shape being copied.
  One palette, no switch.
- **Responsive breakpoints below 320px, and any mobile-specific layout.** §1 excludes a mobile
  app. The layout must not break at small widths; it is not designed for a phone.
- **Server or shared changes.** This plan touches `packages/client` and two lines of
  `docs/architecture.md`.

## Approach

**The architecture amendment comes first, before any dependency is installed.** §1's "no design
system" and §2.1's dependency rule both forbid this work as written, and CLAUDE.md says a
mismatch between the code and the document means one of the two is wrong. Amending after the fact
would make the document describe a tree it had ruled out. §1 keeps its point — visual design is
not what the brief is assessing — while allowing a styling layer; §2.1 gains a Tailwind row naming
what it replaces: the hand-written stylesheet and the class-naming convention that a project with
no design system would otherwise have to invent and keep consistent by review. §6.3 gains a line
saying where styles live.

**Tailwind lands next, on its own, with the views untouched.** Tailwind v4 installs as
`tailwindcss` plus `@tailwindcss/vite`, a plugin in
[vite.config.ts](../../packages/client/vite.config.ts) and a single `@import "tailwindcss"` in a
stylesheet that `main.tsx` imports. The reason to do this alone is the test environment: the view
tests run under jsdom through the root `vitest.config.ts`, which does not use the client's Vite
plugin chain, and a CSS import in the module graph is the usual way that breaks. Prove `npm test`
is green with the import in place and nothing else changed, and every later step is a pure
layout change. This is the step most likely to force a rethink — if the plugin cannot coexist with
the root Vitest config, the fallback is a plain stylesheet and the rest of the plan is unaffected.

**`VideoPanel` is rewritten before either view moves its controls.** It owns the video area: the
remote fill, the local inset, the placeholders, the error overlay. Both views consume it, so
doing it first means each view's own change is only "move the buttons into a bar". Its test file
already pins the behaviour that must survive — the two accessible names, the `muted` asymmetry,
the `srcObject` assignment and teardown, the alert — so the rewrite is guarded before it starts.
The placeholder is the new behaviour and needs new tests: a tile with a null stream shows its role
and a reason.

**The control bar is extracted as a component, not written twice.** §6.3 is explicit that the two
views are separate components and that shared *behaviour* is what gets factored out, not shared
*rendering* — so the bar takes the status text and the buttons as children rather than taking a
role and branching on it inside. Each view composes its own bar contents; the component owns only
the fixed-bottom layout and the slot arrangement.

**The views change last, one at a time, patient before provider.** `PatientView` has one button
and no history section, so it exercises the full frame — viewport shell, video area, bar — with
the least in the way. `ProviderView` then adds the two-button case and the ended screen, which is
the one place where the frame is replaced rather than filled.

**`HomeView` is last and independent of everything above.** It shares only the background and the
type scale; nothing else in the plan depends on it, so it is the step to drop if the work has to
stop early.

## Open questions

- **Where does the local inset sit, and can the user move it?** Fixed bottom-right is the
  assumption. A draggable tile is more work than it is worth here, but a fixed corner is a guess
  about which corner. Ask before the `VideoPanel` rewrite.
