import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applySchema } from "./schema.js";

function openMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  return db;
}

describe("applySchema", () => {
  it("creates the sessions table with the expected columns", () => {
    const db = openMemoryDb();
    const columns = db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual([
      "id",
      "provider_key",
      "patient_key",
      "status",
      "created_at",
      "ended_at",
      "ended_reason",
    ]);
  });

  it("creates the events table with the expected columns", () => {
    const db = openMemoryDb();
    const columns = db
      .prepare("PRAGMA table_info(events)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual(["id", "session_id", "type", "occurred_at", "data"]);
  });

  it("creates idx_events_session_id", () => {
    const db = openMemoryDb();
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_events_session_id'",
      )
      .all();
    expect(rows).toHaveLength(1);
  });

  it("rejects an ended_reason outside the allowed set", () => {
    const db = openMemoryDb();
    expect(() =>
      db
        .prepare(
          "INSERT INTO sessions (id, provider_key, patient_key, status, created_at, ended_reason) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("s1", "pk1", "pak1", "ENDED", "2026-01-01T00:00:00.000Z", "not_a_real_reason"),
    ).toThrow();
  });

  it("accepts each allowed ended_reason value", () => {
    const db = openMemoryDb();
    for (const [i, reason] of ["provider_ended", "timeout", "interrupted"].entries()) {
      db.prepare(
        "INSERT INTO sessions (id, provider_key, patient_key, status, created_at, ended_reason) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(`s${i}`, `pk${i}`, `pak${i}`, "ENDED", "2026-01-01T00:00:00.000Z", reason);
    }
    const rows = db.prepare("SELECT ended_reason FROM sessions").all();
    expect(rows).toHaveLength(3);
  });

  it("allows a NULL ended_reason", () => {
    const db = openMemoryDb();
    expect(() =>
      db
        .prepare(
          "INSERT INTO sessions (id, provider_key, patient_key, status, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("s1", "pk1", "pak1", "CREATED", "2026-01-01T00:00:00.000Z"),
    ).not.toThrow();
  });

  it("is idempotent when applied twice", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
  });
});
