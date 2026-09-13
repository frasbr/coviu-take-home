import { EventEmitter } from "node:events";
import type { EndedReason, EventType, SessionStatus } from "@coviu/shared";

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
  endedReason?: EndedReason;
  presence: Presence;
}

export interface SessionPresenceEvent {
  sessionId: string;
  presence: Presence;
}

interface SessionRegistryEventMap {
  transition: [SessionTransitionEvent];
  presence: [SessionPresenceEvent];
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
    const entry = this.requireEntry(sessionId);
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

  /** Sets presence.provider. Idempotent, and no state transition. */
  providerConnected(sessionId: string): void {
    const entry = this.requireEntry(sessionId);
    if (entry.presence.provider) {
      return;
    }

    entry.presence.provider = true;
    this.emit("presence", { sessionId, presence: { ...entry.presence } });
  }

  /** WAITING -> ACTIVE, on the provider's `admit`. */
  admit(sessionId: string): void {
    const entry = this.requireEntry(sessionId);
    if (entry.status !== "WAITING") {
      throw new Error(`session ${sessionId} cannot be admitted in state ${entry.status}`);
    }

    const from = entry.status;
    entry.status = "ACTIVE";

    this.emit("transition", {
      sessionId,
      from,
      to: entry.status,
      eventType: "patient_admitted",
      presence: { ...entry.presence },
    });
  }

  /** Any state but ENDED -> ENDED, on the provider's `end-session`. */
  endSession(sessionId: string): void {
    const entry = this.requireEntry(sessionId);
    if (entry.status === "ENDED") {
      throw new Error(`session ${sessionId} has already ended`);
    }

    const from = entry.status;
    entry.status = "ENDED";
    const endedReason: EndedReason = "provider_ended";

    this.emit("transition", {
      sessionId,
      from,
      to: entry.status,
      eventType: "session_ended",
      endedReason,
      presence: { ...entry.presence },
    });
  }

  /**
   * Sets presence.patient false on `patient:leave`. A deliberate leave from
   * ACTIVE also drops the session back to WAITING, so a later rejoin needs
   * the provider to re-admit rather than resuming the call outright. The
   * session never ends here.
   */
  patientLeft(sessionId: string): void {
    const entry = this.requireEntry(sessionId);
    if (entry.status === "CREATED" || entry.status === "ENDED") {
      throw new Error(`patient cannot leave session ${sessionId} in state ${entry.status}`);
    }

    const from = entry.status;
    entry.presence.patient = false;
    if (entry.status === "ACTIVE") {
      entry.status = "WAITING";
    }

    this.emit("transition", {
      sessionId,
      from,
      to: entry.status,
      eventType: "patient_left",
      presence: { ...entry.presence },
    });
  }

  /** Sets presence.patient false on a patient socket drop. Never a state transition. */
  patientDisconnected(sessionId: string): void {
    this.setPatientPresence(sessionId, false, "patient_disconnected");
  }

  /** Sets presence.patient true when a patient socket returns. Never a state transition. */
  patientReconnected(sessionId: string): void {
    this.setPatientPresence(sessionId, true, "patient_reconnected");
  }

  // Presence changes ride on `transition` with `from` equal to `to`, as patientLeft
  // does, because only `transition` reaches the event recorder and section 3 wants a
  // row for each of these. Section 4.3: a patient rejoining changes presence only, so
  // no status moves here and the grace timer stays a provider concern.
  private setPatientPresence(sessionId: string, present: boolean, eventType: EventType): void {
    const entry = this.requireEntry(sessionId);
    if (entry.status === "CREATED" || entry.status === "ENDED") {
      throw new Error(
        `patient presence cannot change for session ${sessionId} in state ${entry.status}`,
      );
    }
    if (entry.presence.patient === present) {
      return;
    }

    entry.presence.patient = present;

    this.emit("transition", {
      sessionId,
      from: entry.status,
      to: entry.status,
      eventType,
      presence: { ...entry.presence },
    });
  }

  private requireEntry(sessionId: string): SessionRegistryEntry {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      throw new Error(`session ${sessionId} is not registered`);
    }
    return entry;
  }
}
