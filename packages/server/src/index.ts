import { attachEventRecorder } from "./eventRecorder/eventRecorder.js";
import { openDatabase } from "./persistence/database.js";
import { createSqliteSessionRepository } from "./persistence/sessionRepository.js";
import { createSessionService } from "./services/sessionService.js";
import { SessionRegistry } from "./session/sessionRegistry.js";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

const db = openDatabase("data/app.db");
const repository = createSqliteSessionRepository(db);
const registry = new SessionRegistry();
attachEventRecorder(registry, repository);
const sessionService = createSessionService(repository, registry, CLIENT_URL);

// Must run before the server accepts a request, and never touches the registry
sessionService.endInterruptedSessions();
