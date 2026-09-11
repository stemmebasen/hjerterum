import type { D1Database } from "./db.js";

type ImportRow = Record<string, unknown>;

export type NormalizedExternalMember = {
  externalId: string | null;
  email: string;
  fullName: string;
  membershipLevel: string | null;
  status: string;
  joinedAtText: string | null;
  expiresAtText: string | null;
  rawJson: string;
};

export type MembershipImportResult = {
  batchId: number;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
};

const aliases = {
  externalId: ["id", "memberid", "membershipworksid", "membershipid"],
  email: ["email", "emailaddress", "primaryemail", "memberemail", "e-mail"],
  fullName: ["fullname", "name", "membername", "contactname"],
  firstName: ["firstname", "first"],
  lastName: ["lastname", "last", "surname"],
  level: ["membership", "membershiplevel", "level", "plan", "membershipname"],
  status: ["status", "membershipstatus", "state"],
  joined: ["joined", "joindate", "startdate", "membersince"],
  expires: ["expires", "expirationdate", "renewaldate", "enddate"]
} as const;

function key(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9æøå-]/g, "");
}

function valuesByKey(row: ImportRow): Map<string, string> {
  const entries = Object.entries(row).map(([name, value]) => [
    key(name),
    value === null || value === undefined ? "" : String(value).trim()
  ] as const);
  return new Map(entries);
}

function first(values: Map<string, string>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = values.get(key(name));
    if (value) return value;
  }
  return null;
}

function canonicalSourceSnapshot(member: Omit<NormalizedExternalMember, "rawJson">): string {
  return JSON.stringify(member);
}

function rejectedRowMetadata(row: ImportRow): string {
  return JSON.stringify({ columns: Object.keys(row).map((name) => name.trim()).sort() });
}

export function normalizeMembershipStatus(value: string | null): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (["active", "current", "paid", "trial", "trialing"].includes(normalized)) return "active";
  if (["cancelled", "canceled", "inactive", "expired", "lapsed"].includes(normalized)) return "inactive";
  return normalized || "unknown";
}

export function normalizeMembershipWorksRow(row: ImportRow): NormalizedExternalMember {
  const values = valuesByKey(row);
  const email = first(values, aliases.email)?.toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("missing_or_invalid_email");

  const explicitName = first(values, aliases.fullName);
  const combinedName = [first(values, aliases.firstName), first(values, aliases.lastName)]
    .filter(Boolean)
    .join(" ");
  const fullName = explicitName || combinedName || email.split("@")[0] || "MembershipWorks-medlem";

  const member = {
    externalId: first(values, aliases.externalId),
    email,
    fullName,
    membershipLevel: first(values, aliases.level),
    status: normalizeMembershipStatus(first(values, aliases.status)),
    joinedAtText: first(values, aliases.joined),
    expiresAtText: first(values, aliases.expires)
  };

  return {
    ...member,
    rawJson: canonicalSourceSnapshot(member)
  };
}

function comparable(member: NormalizedExternalMember): string {
  return JSON.stringify({
    externalId: member.externalId,
    email: member.email,
    fullName: member.fullName,
    membershipLevel: member.membershipLevel,
    status: member.status,
    joinedAtText: member.joinedAtText,
    expiresAtText: member.expiresAtText,
    rawJson: member.rawJson
  });
}

type ExistingRow = {
  id: number;
  source_external_id: string | null;
  normalized_email: string;
  full_name: string;
  membership_level: string | null;
  status: string;
  joined_at_text: string | null;
  expires_at_text: string | null;
  raw_json: string;
};

function existingComparable(row: ExistingRow): string {
  return comparable({
    externalId: row.source_external_id,
    email: row.normalized_email,
    fullName: row.full_name,
    membershipLevel: row.membership_level,
    status: row.status,
    joinedAtText: row.joined_at_text,
    expiresAtText: row.expires_at_text,
    rawJson: row.raw_json
  });
}

function requireImportPayload(value: unknown): { filename: string; rows: ImportRow[] } {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const body = value as Record<string, unknown>;
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  if (!filename || filename.length > 240) throw new Error("invalid_filename");
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 5000) {
    throw new Error("invalid_rows");
  }
  const rows = body.rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid_row");
    return row as ImportRow;
  });
  return { filename, rows };
}

export async function importMembershipWorksCsv(
  db: D1Database,
  value: unknown,
  adminEmail: string
): Promise<MembershipImportResult> {
  const { filename, rows } = requireImportPayload(value);
  const now = Date.now();
  const batch = await db.prepare(
    `INSERT INTO membership_import_batches
     (source, filename, imported_by_email, started_at_ms)
     VALUES ('membershipworks', ?, ?, ?)`
  ).bind(filename, adminEmail, now).run();
  const batchId = batch.meta?.last_row_id;
  if (typeof batchId !== "number") throw new Error("membership_import_batch_failed");

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let rejected = 0;
  const seenEmails = new Set<string>();

  try {
    for (const row of rows) {
      let normalized: NormalizedExternalMember;
      try {
        normalized = normalizeMembershipWorksRow(row);
        if (seenEmails.has(normalized.email)) throw new Error("duplicate_email_in_file");
        seenEmails.add(normalized.email);
      } catch (error) {
        rejected += 1;
        const reason = error instanceof Error ? error.message : "invalid_row";
        await db.prepare(
          `INSERT INTO membership_import_changes
           (import_batch_id, normalized_email, change_type, current_json, reason, created_at_ms)
           VALUES (?, NULL, 'rejected', ?, ?, ?)`
        ).bind(batchId, rejectedRowMetadata(row), reason, Date.now()).run();
        continue;
      }

      const existing = await db.prepare(
        `SELECT id, source_external_id, normalized_email, full_name, membership_level,
                status, joined_at_text, expires_at_text, raw_json
         FROM external_memberships
         WHERE source = 'membershipworks' AND normalized_email = ?
         LIMIT 1`
      ).bind(normalized.email).first<ExistingRow>();

      if (!existing) {
        const inserted = await db.prepare(
          `INSERT INTO external_memberships
           (source, source_external_id, normalized_email, full_name, membership_level,
            status, joined_at_text, expires_at_text, raw_json, first_seen_at_ms,
            last_seen_at_ms, last_changed_at_ms, last_import_batch_id)
           VALUES ('membershipworks', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          normalized.externalId,
          normalized.email,
          normalized.fullName,
          normalized.membershipLevel,
          normalized.status,
          normalized.joinedAtText,
          normalized.expiresAtText,
          normalized.rawJson,
          now,
          now,
          now,
          batchId
        ).run();
        const externalMembershipId = inserted.meta?.last_row_id;
        created += 1;
        await db.prepare(
          `INSERT INTO membership_import_changes
           (import_batch_id, external_membership_id, normalized_email, change_type, current_json, created_at_ms)
           VALUES (?, ?, ?, 'created', ?, ?)`
        ).bind(batchId, externalMembershipId ?? null, normalized.email, comparable(normalized), Date.now()).run();
        continue;
      }

      if (existingComparable(existing) === comparable(normalized)) {
        unchanged += 1;
        await db.prepare(
          `UPDATE external_memberships SET last_seen_at_ms = ?, last_import_batch_id = ? WHERE id = ?`
        ).bind(now, batchId, existing.id).run();
        continue;
      }

      await db.prepare(
        `UPDATE external_memberships
         SET source_external_id = ?, full_name = ?, membership_level = ?, status = ?,
             joined_at_text = ?, expires_at_text = ?, raw_json = ?,
             last_seen_at_ms = ?, last_changed_at_ms = ?, last_import_batch_id = ?
         WHERE id = ?`
      ).bind(
        normalized.externalId,
        normalized.fullName,
        normalized.membershipLevel,
        normalized.status,
        normalized.joinedAtText,
        normalized.expiresAtText,
        normalized.rawJson,
        now,
        now,
        batchId,
        existing.id
      ).run();
      updated += 1;
      await db.prepare(
        `INSERT INTO membership_import_changes
         (import_batch_id, external_membership_id, normalized_email, change_type,
          previous_json, current_json, created_at_ms)
         VALUES (?, ?, ?, 'updated', ?, ?, ?)`
      ).bind(
        batchId,
        existing.id,
        normalized.email,
        existingComparable(existing),
        comparable(normalized),
        Date.now()
      ).run();
    }

    await db.prepare(
      `UPDATE membership_import_batches
       SET status = 'completed', total_rows = ?, created_rows = ?, updated_rows = ?,
           unchanged_rows = ?, rejected_rows = ?, completed_at_ms = ?
       WHERE id = ?`
    ).bind(rows.length, created, updated, unchanged, rejected, Date.now(), batchId).run();
    return { batchId, total: rows.length, created, updated, unchanged, rejected };
  } catch (error) {
    const message = error instanceof Error ? error.message : "membership_import_failed";
    await db.prepare(
      `UPDATE membership_import_batches
       SET status = 'failed', total_rows = ?, created_rows = ?, updated_rows = ?,
           unchanged_rows = ?, rejected_rows = ?, error_message = ?, completed_at_ms = ?
       WHERE id = ?`
    ).bind(rows.length, created, updated, unchanged, rejected, message.slice(0, 1000), Date.now(), batchId).run();
    throw error;
  }
}

export async function listMembershipWorksMembers(db: D1Database) {
  const result = await db.prepare(
    `SELECT id, source_external_id AS externalId, normalized_email AS email,
            full_name AS fullName, membership_level AS membershipLevel, status,
            joined_at_text AS joinedAt, expires_at_text AS expiresAt,
            last_seen_at_ms AS lastSeenAt, access_blocked AS accessBlocked
     FROM external_memberships
     WHERE source = 'membershipworks'
     ORDER BY full_name COLLATE NOCASE ASC
     LIMIT 5000`
  ).all();
  return result.results ?? [];
}

export async function listMembershipImportBatches(db: D1Database) {
  const result = await db.prepare(
    `SELECT id, filename, imported_by_email AS importedByEmail, status,
            total_rows AS total, created_rows AS created, updated_rows AS updated,
            unchanged_rows AS unchanged, rejected_rows AS rejected,
            started_at_ms AS startedAt, completed_at_ms AS completedAt
     FROM membership_import_batches
     ORDER BY started_at_ms DESC
     LIMIT 50`
  ).all();
  return result.results ?? [];
}

export async function findMembershipWorksMemberByEmail(db: D1Database, email: string) {
  return db.prepare(
    `SELECT id, normalized_email AS email, full_name AS fullName,
            membership_level AS membershipLevel, status, access_blocked AS accessBlocked
     FROM external_memberships
     WHERE source = 'membershipworks' AND normalized_email = ?
     LIMIT 1`
  ).bind(email.trim().toLowerCase()).first<{
    id: number;
    email: string;
    fullName: string;
    membershipLevel: string | null;
    status: string;
    accessBlocked: number;
  }>();
}
