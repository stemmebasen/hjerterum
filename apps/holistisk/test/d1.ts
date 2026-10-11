import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import type { D1Database, D1PreparedStatement, D1Result } from "../src/db.js";

/** The portal's real migrations on an in-memory SQLite, behind the same D1 interface the Worker uses. */
export function testDb(): D1Database & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, dir), "utf8"));

  const convert = (v: unknown) => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
  const statement = (sql: string, params: unknown[] = []): D1PreparedStatement & { exec(): D1Result } => {
    const exec = (): D1Result => {
      const stmt = raw.prepare(sql);
      if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params.map(convert)), success: true };
      const info = stmt.run(...params.map(convert));
      return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    };
    return {
      bind: (...values: unknown[]) => statement(sql, values),
      first: async <T>() => (exec().results[0] as T | undefined) ?? null,
      all: async <T>() => exec() as D1Result<T>,
      run: async () => exec(),
      exec
    };
  };
  return {
    raw,
    prepare: (sql: string) => statement(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      raw.exec("BEGIN");
      try {
        const out = statements.map(s => (s as ReturnType<typeof statement>).exec());
        raw.exec("COMMIT");
        return out;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    }
  };
}
