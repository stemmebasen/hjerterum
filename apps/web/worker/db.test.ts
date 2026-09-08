import { describe, expect, it } from "vitest";
import {
  checkDatabase,
  listUpcomingPublicRoomBookings,
  type D1Database,
  type D1PreparedStatement
} from "./db.js";

class FakeStatement implements D1PreparedStatement {
  constructor(
    private readonly query: string,
    private readonly rows: Record<string, unknown>[]
  ) {}

  bind(..._values: unknown[]): D1PreparedStatement {
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (this.query.includes("SELECT 1 AS ok")) return { ok: 1 } as T;
    return (this.rows[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>() {
    return { results: this.rows as T[] };
  }

  async run<T = unknown>() {
    return { success: true, results: [] as T[] };
  }
}

class FakeDatabase implements D1Database {
  constructor(private readonly rows: Record<string, unknown>[] = []) {}

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(query, this.rows);
  }
}

describe("Cloudflare D1 adapter", () => {
  it("reports a healthy database", async () => {
    await expect(checkDatabase(new FakeDatabase())).resolves.toBeUndefined();
  });

  it("returns upcoming public room bookings unchanged at the storage boundary", async () => {
    const rows = [
      {
        id: 7,
        teacher_name: "Anna",
        teacher_email: "anna@example.invalid",
        title: "Meditation",
        description: "Rolig praksis",
        starts_at_ms: 2_000,
        ends_at_ms: 3_000,
        max_attendees: 12
      }
    ];

    const result = await listUpcomingPublicRoomBookings(new FakeDatabase(rows), 1_000);

    expect(result).toEqual(rows);
  });
});
