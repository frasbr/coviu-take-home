import { EventEmitter } from "node:events";
import type { EventType, SessionStatus } from "@coviu/shared";

export interface Presence {
  provider: boolean;
  patient: boolean;
}

export interface SessionRegistryEntry {
  status: SessionStatus;
  presence: Presence;
}

export interface SessionTransitionEvent {
  sessionId: string;
  from: SessionStatus;
  to: SessionStatus;
  eventType: EventType;
  presence: Presence;
}

interface SessionRegistryEventMap {
  transition: [SessionTransitionEvent];
}

export declare interface SessionRegistry {
  on<K extends keyof SessionRegistryEventMap>(
    event: K,
    listener: (...args: SessionRegistryEventMap[K]) => void,
  ): this;
  emit<K extends keyof SessionRegistryEventMap>(
    event: K,
    ...args: SessionRegistryEventMap[K]
  ): boolean;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: declaration merge types EventEmitter's on/emit
export class SessionRegistry extends EventEmitter {
  private readonly sessions = new Map<string, SessionRegistryEntry>();

  createSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      throw new Error(`session ${sessionId} is already registered`);
    }

    this.sessions.set(sessionId, {
      status: "CREATED",
      presence: { provider: false, patient: false },
    });
  }

  getSession(sessionId: string): SessionRegistryEntry | undefined {
    const entry = this.sessions.get(sessionId);
    return entry ? { status: entry.status, presence: { ...entry.presence } } : undefined;
  }

  patientConnected(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      throw new Error(`session ${sessionId} is not registered`);
    }
    if (entry.status !== "CREATED") {
      throw new Error(
        `session ${sessionId} cannot accept a patient connection in state ${entry.status}`,
      );
    }

    const from = entry.status;
    entry.status = "WAITING";
    entry.presence.patient = true;

    this.emit("transition", {
      sessionId,
      from,
      to: entry.status,
      eventType: "patient_joined_waiting_room",
      presence: { ...entry.presence },
    });
  }
}
