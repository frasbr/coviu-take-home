import type { DatabaseSync } from "node:sqlite";
import type { Event, EventType } from "@coviu/shared";
import type { Session } from "./types.js";

export interface SessionRepository {
  upsertSession(session: Session): void;
  getSession(id: string): Session | undefined;
  getSessionByKey(key: string): Session | undefined;
  recordEvent(sessionId: string, type: EventType, data?: unknown): void;
  getEvents(sessionId: string): Event[];
  listOpenSessions(): Session[];
}

interface SessionRow {
  id: string;
  provider_key: string;
  patient_key: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  ended_reason: string | null;
}

interface EventRow {
  id: number;
  type: string;
  occurred_at: string;
  data: string | null;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    providerKey: row.provider_key,
    patientKey: row.patient_key,
    status: row.status as Session["status"],
    createdAt: row.created_at,
    endedAt: row.ended_at,
    endedReason: row.ended_reason as Session["endedReason"],
  };
}

function rowToEvent(row: EventRow): Event {
  return {
    id: row.id,
    type: row.type as EventType,
    occurredAt: row.occurred_at,
    data: row.data === null ? null : JSON.parse(row.data),
  };
}

export function createSqliteSessionRepository(db: DatabaseSync): SessionRepository {
  return {
    upsertSession(session: Session): void {
      db.prepare(
        `INSERT INTO sessions (id, provider_key, patient_key, status, created_at, ended_at, ended_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           provider_key = excluded.provider_key,
           patient_key = excluded.patient_key,
           status = excluded.status,
           created_at = excluded.created_at,
           ended_at = excluded.ended_at,
           ended_reason = excluded.ended_reason`,
      ).run(
        session.id,
        session.providerKey,
        session.patientKey,
        session.status,
        session.createdAt,
        session.endedAt,
        session.endedReason,
      );
    },

    getSession(id: string): Session | undefined {
      const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
        | SessionRow
        | undefined;
      return row ? rowToSession(row) : undefined;
    },

    getSessionByKey(key: string): Session | undefined {
      const row = db
        .prepare("SELECT * FROM sessions WHERE provider_key = ? OR patient_key = ?")
        .get(key, key) as SessionRow | undefined;
      return row ? rowToSession(row) : undefined;
    },

    recordEvent(sessionId: string, type: EventType, data?: unknown): void {
      db.prepare(
        "INSERT INTO events (session_id, type, occurred_at, data) VALUES (?, ?, ?, ?)",
      ).run(
        sessionId,
        type,
        new Date().toISOString(),
        data === undefined ? null : JSON.stringify(data),
      );
    },

    getEvents(sessionId: string): Event[] {
      const rows = db
        .prepare(
          "SELECT id, type, occurred_at, data FROM events WHERE session_id = ? ORDER BY id ASC",
        )
        .all(sessionId) as unknown as EventRow[];
      return rows.map(rowToEvent);
    },

    listOpenSessions(): Session[] {
      const rows = db
        .prepare("SELECT * FROM sessions WHERE status != 'ENDED'")
        .all() as unknown as SessionRow[];
      return rows.map(rowToSession);
    },
  };
}
