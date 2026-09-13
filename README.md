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
