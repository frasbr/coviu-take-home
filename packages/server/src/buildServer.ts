import { type Server as HttpServer, createServer } from "node:http";
import type { ClientToServerEvents, ServerToClientEvents } from "@coviu/shared";
import { ExpressPeerServer } from "peer";
import type { DefaultEventsMap } from "socket.io";
import { Server } from "socket.io";
import { WebSocketServer } from "ws";
import { attachEventRecorder } from "./eventRecorder/eventRecorder.js";
import { createHttpApp } from "./http/http.js";
import { openDatabase } from "./persistence/database.js";
import { createSqliteSessionRepository } from "./persistence/sessionRepository.js";
import { createSessionService } from "./services/sessionService.js";
import { SessionRegistry } from "./session/sessionRegistry.js";
import { type SocketData, attachSignaling } from "./signaling/signaling.js";

export interface BuildServerOptions {
  databasePath: string;
  clientUrl: string;
}

export function buildServer({ databasePath, clientUrl }: BuildServerOptions): HttpServer {
  const db = openDatabase(databasePath);
  const repository = createSqliteSessionRepository(db);
  const registry = new SessionRegistry();
  attachEventRecorder(registry, repository);
  const sessionService = createSessionService(repository, registry, clientUrl);

  // Must run before the server accepts a request, and never touches the registry
  sessionService.endInterruptedSessions();

  const app = createHttpApp(sessionService, clientUrl);
  const server = createServer(app);

  // Handed a `server`, ws attaches its own upgrade listener and destroys every
  // upgrade whose path it does not own - which is every Socket.IO upgrade, leaving
  // the client silently stuck on long-polling. engine.io is the polite half, so
  // reordering the two does not help. Build the PeerServer's ws detached instead
  // and route upgrades by path here, where both can share one http.Server.
  let peerSockets: WebSocketServer | undefined;
  let peerPath: string | undefined;

  app.use(
    "/peerjs",
    ExpressPeerServer(server, {
      allow_discovery: false,
      corsOptions: { origin: clientUrl },
      createWebSocketServer: ({ server: _ignored, ...options }) => {
        peerPath = options.path;
        peerSockets = new WebSocketServer({ ...options, noServer: true });
        return peerSockets;
      },
    }),
  );

  server.on("upgrade", (request, socket, head) => {
    if (!peerSockets || !peerPath) {
      return;
    }
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname !== peerPath) {
      return;
    }
    peerSockets.handleUpgrade(request, socket, head, (client) => {
      peerSockets?.emit("connection", client, request);
    });
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>(
    server,
    { pingInterval: 10_000, pingTimeout: 20_000, cors: { origin: clientUrl } },
  );
  attachSignaling(io, sessionService, registry);

  return server;
}
