import type { SessionRepository } from "../persistence/sessionRepository.js";
import type { SessionRegistry } from "../session/sessionRegistry.js";

export function attachEventRecorder(
  registry: SessionRegistry,
  repository: SessionRepository,
): void {
  registry.on("transition", ({ sessionId, to, eventType, endedReason }) => {
    repository.recordEvent(sessionId, eventType, endedReason ? { reason: endedReason } : undefined);

    const session = repository.getSession(sessionId);
    if (!session) {
      throw new Error(`event recorder: no persisted session found for ${sessionId}`);
    }

    repository.upsertSession({
      ...session,
      status: to,
      endedAt: to === "ENDED" ? new Date().toISOString() : session.endedAt,
      endedReason: endedReason ?? session.endedReason,
    });
  });
}
