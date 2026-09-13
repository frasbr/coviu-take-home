import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Socket as ClientSocket, io as ioClient } from "socket.io-client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildServer } from "./buildServer.js";

let server: HttpServer;
let baseUrl: string;
const sockets: ClientSocket[] = [];

beforeEach(async () => {
  server = buildServer({ databasePath: ":memory:", clientUrl: "http://localhost:5173" });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const socket of sockets) {
    socket.close();
  }
  sockets.length = 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// The PeerServer's ws is attached to the same http.Server. Given a `server`, ws
// destroys every upgrade whose path it does not own, which is every Socket.IO
// upgrade. Polling still works, so only a websocket-only client catches this.
it("upgrades a Socket.IO connection to a websocket while the PeerServer shares the port", async () => {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const { providerKey } = (await response.json()) as { providerKey: string };

  const socket = ioClient(baseUrl, {
    auth: { key: providerKey },
    transports: ["websocket"],
    reconnection: false,
  });
  sockets.push(socket);

  await expect(
    new Promise((resolve, reject) => {
      socket.on("connect", () => resolve(socket.io.engine.transport.name));
      socket.on("connect_error", reject);
    }),
  ).resolves.toBe("websocket");
});

// Mounted at /peerjs, the peer api sits under its default key, also "peerjs".
it("serves the PeerServer over the same port", async () => {
  const response = await fetch(`${baseUrl}/peerjs/peerjs/id`);

  expect(response.status).toBe(200);
  await expect(response.text()).resolves.toMatch(/\S/);
});
