import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

describe("openDatabase", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("creates the containing directory when it does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "coviu-db-test-"));
    const dbPath = join(dir, "nested", "app.db");
    expect(existsSync(join(dir, "nested"))).toBe(false);

    const db = openDatabase(dbPath);
    db.close();

    expect(existsSync(dbPath)).toBe(true);
  });

  it("creates the sessions and events tables", () => {
    dir = mkdtempSync(join(tmpdir(), "coviu-db-test-"));
    const dbPath = join(dir, "app.db");

    const db = openDatabase(dbPath);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    db.close();

    expect(tables).toEqual(["events", "sessions"]);
  });
});
