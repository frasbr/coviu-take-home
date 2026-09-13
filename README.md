## Requirements

- Node.js >= 22.5 (uses `node:sqlite`)

## Install

```bash
npm install
```

## Run

The app is two processes: the API/signaling server and the Vite client dev
server. Start both, each in its own terminal, from the repo root.

```bash
npm run dev:server   # http://localhost:3001
```

```bash
npm run dev:client   # http://localhost:5173
```

Open `http://localhost:5173` in a browser, click **Create session**, and
open the provider link and the patient link (each `/p/:key` or `/w/:key`)
in separate tabs.

Environment variables (both optional):

- `PORT` — server port (default `3001`).
- `CLIENT_URL` — origin the server embeds in the session links it returns
  (default `http://localhost:5173`).
- `VITE_SERVER_URL` — server origin the client talks to (default
  `http://localhost:3001`); set this before `npm run dev:client` if the
  server runs somewhere other than the default.

## Test

```bash
npm test          # run once
npm run test:watch
```

## Lint / format

```bash
npm run lint
npm run lint:fix
```

## Build

```bash
npm run build
```

Builds each workspace package (`shared`, `server`, `client`) that defines a
`build` script.

## Deliberately left out

**Recovering a call after the server goes away.** The socket and the peer
connection fail independently by design, so a Socket.IO reconnect does not tear
down a live call: kill the server mid-consultation and both cameras stay on and
the media keeps flowing, because the media path is peer to peer and does not
touch the server once the call is up.

What is missing is the other half. When the server comes back, nothing
re-establishes the call — the signalling state is rebuilt, but neither side
re-publishes its peer ID, so a call that was actually interrupted cannot be
restored. The same gap shows up without a restart: a provider reload mid-call
never learns the patient's peer ID again, because the patient never re-enters
ACTIVE and so never re-sends it.

Holding the cameras open through a fault the session cannot recover from is
therefore only half a feature. Closing it needs a reconnect design — whether
clients re-publish their peer ID on a presence transition, or the server latches
the last peer ID per role and replays it on join, which the current signalling
contract forbids — and that sits with the grace-period work that is also not
built.
