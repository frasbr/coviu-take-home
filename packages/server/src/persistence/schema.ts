import type { DatabaseSync } from "node:sqlite";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  provider_key  TEXT NOT NULL UNIQUE,
  patient_key   TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  ended_at      TEXT,
  ended_reason  TEXT
    CHECK (ended_reason IS NULL OR ended_reason IN
           ('provider_ended', 'timeout', 'interrupted'))
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  type         TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,
  data         TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
`;

export function applySchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
}
