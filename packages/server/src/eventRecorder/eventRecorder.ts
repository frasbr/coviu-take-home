import type { SessionRepository } from "../persistence/sessionRepository.js";
import type { SessionRegistry } from "../session/sessionRegistry.js";

export function attachEventRecorder(
  registry: SessionRegistry,
  repository: SessionRepository,
): void {
  registry.on("transition", ({ sessionId, to, eventType }) => {
    repository.recordEvent(sessionId, eventType);

    const session = repository.getSession(sessionId);
    if (!session) {
      throw new Error(`event recorder: no persisted session found for ${sessionId}`);
    }

    repository.upsertSession({ ...session, status: to });
  });
}
