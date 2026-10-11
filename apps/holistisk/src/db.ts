/** The slice of Cloudflare D1 the portal uses. Kept as an interface so tests can run the same SQL on node:sqlite. */
export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta?: { changes?: number; last_row_id?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

/** D1 accepts at most 100 bound parameters per statement; list queries chunk their IN (...) lists by this. */
export const MAX_BOUND = 90;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs statements in batches, so one run never sends an unbounded batch. */
export async function runBatched(db: D1Database, statements: D1PreparedStatement[], size = 50): Promise<void> {
  for (const part of chunk(statements, size)) if (part.length) await db.batch(part);
}
