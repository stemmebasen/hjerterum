import type { D1Database } from "./db.js";

export type MemberSource = "hjerterum" | "membershipworks";

function parseAccessChange(value: unknown): {
  source: MemberSource;
  memberId: number;
  blocked: boolean;
} {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const body = value as Record<string, unknown>;
  const source = body.source;
  const memberId = Number(body.memberId);
  if (source !== "hjerterum" && source !== "membershipworks") {
    throw new Error("invalid_member_source");
  }
  if (!Number.isInteger(memberId) || memberId <= 0) throw new Error("invalid_member_id");
  if (typeof body.blocked !== "boolean") throw new Error("invalid_blocked");
  return { source, memberId, blocked: body.blocked };
}

export async function changeMemberAccess(
  db: D1Database,
  value: unknown,
  adminEmail: string
): Promise<{ source: MemberSource; memberId: number; accessBlocked: boolean }> {
  const input = parseAccessChange(value);
  const table = input.source === "hjerterum" ? "members" : "external_memberships";
  const result = await db.prepare(
    `UPDATE ${table} SET access_blocked = ? WHERE id = ?`
  ).bind(input.blocked ? 1 : 0, input.memberId).run();
  if ((result.meta?.changes ?? 0) === 0) throw new Error("member_not_found");

  await db.prepare(
    `INSERT INTO member_access_changes
     (source, source_member_id, blocked, changed_by_email, changed_at_ms)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(input.source, input.memberId, input.blocked ? 1 : 0, adminEmail, Date.now()).run();

  return {
    source: input.source,
    memberId: input.memberId,
    accessBlocked: input.blocked
  };
}
