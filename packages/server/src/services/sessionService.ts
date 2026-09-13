import { randomBytes, randomUUID } from "node:crypto";
import type { CreateSessionResponse, Event, Role, SessionStatus } from "@coviu/shared";
import type { SessionRepository } from "../persistence/sessionRepository.js";
import type { SessionRegistry } from "../session/sessionRegistry.js";

export interface ResolvedKey {
  sessionId: string;
  role: Role;
  status: SessionStatus;
}

export interface SessionService {
  createSession(): CreateSessionResponse;
  resolveKey(key: string): ResolvedKey | undefined;
  endInterruptedSessions(): void;
  getSessionEvents(providerKey: string): Event[] | undefined;
}

function makeKey(): string {
  return randomBytes(16).toString("hex");
}

export function createSessionService(
  repository: SessionRepository,
  registry: SessionRegistry,
  baseUrl: string,
): SessionService {
  return {
    createSession(): CreateSessionResponse {
      const id = randomUUID();
      const providerKey = makeKey();
      const patientKey = makeKey();

      repository.upsertSession({
        id,
        providerKey,
        patientKey,
        status: "CREATED",
        createdAt: new Date().toISOString(),
        endedAt: null,
        endedReason: null,
      });
      repository.recordEvent(id, "session_created");
      registry.createSession(id);

      return {
        providerKey,
        patientKey,
        providerUrl: `${baseUrl}/p/${providerKey}`,
        patientUrl: `${baseUrl}/w/${patientKey}`,
      };
    },

    resolveKey(key: string): ResolvedKey | undefined {
      const session = repository.getSessionByKey(key);
      if (!session) {
        return undefined;
      }

      return {
        sessionId: session.id,
        role: session.providerKey === key ? "provider" : "patient",
        status: session.status,
      };
    },

    getSessionEvents(providerKey: string): Event[] | undefined {
      const session = repository.getSessionByKey(providerKey);
      if (!session || session.providerKey !== providerKey) {
        return undefined;
      }

      return repository.getEvents(session.id);
    },

    endInterruptedSessions(): void {
      const endedAt = new Date().toISOString();

      for (const session of repository.listOpenSessions()) {
        repository.recordEvent(session.id, "session_ended", { reason: "interrupted" });
        repository.upsertSession({
          ...session,
          status: "ENDED",
          endedAt,
          endedReason: "interrupted",
        });
      }
    },
  };
}
