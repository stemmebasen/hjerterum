import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const app = resolve(root, "apps/web");
const persist = resolve(root, ".d1-ci");
const database = "hjerterum-ci";
const config = "wrangler.d1-test.jsonc";

rmSync(persist, { recursive: true, force: true });

function runWrangler(args, { expectFailure = false, json = false } = {}) {
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", ...args, "--config", config],
    { cwd: app, encoding: "utf8" }
  );

  if (expectFailure) {
    if (result.status === 0) {
      throw new Error(`Expected Wrangler command to fail: ${args.join(" ")}`);
    }
    return null;
  }

  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Wrangler command failed: ${args.join(" ")}`);
  }

  if (!json) return result.stdout;
  return JSON.parse(result.stdout);
}

function execute(sql, options = {}) {
  return runWrangler(
    [
      "d1",
      "execute",
      database,
      "--local",
      "--persist-to",
      persist,
      "--command",
      sql,
      ...(options.json === false ? [] : ["--json"])
    ],
    { expectFailure: options.expectFailure ?? false, json: options.json ?? true }
  );
}

function firstRow(result) {
  const commandResult = Array.isArray(result) ? result[0] : result;
  const rows = commandResult?.results;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Expected at least one D1 result row");
  }
  return rows[0];
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertColumn(table, column) {
  const row = firstRow(
    execute(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = '${column}'`)
  );
  assertEqual(Number(row.n), 1, `${table}.${column} column`);
}

runWrangler([
  "d1",
  "migrations",
  "apply",
  database,
  "--local",
  "--persist-to",
  persist
]);

const expectedTables = [
  "public_profiles",
  "teachers",
  "bookings",
  "members",
  "room_bookings",
  "room_booking_attendees",
  "tribes",
  "tribe_members",
  "tribe_applicants",
  "tribe_email_logs",
  "webhook_events",
  "job_claims",
  "financial_reconciliation",
  "membership_import_batches",
  "external_memberships",
  "membership_import_changes",
  "member_access_changes",
  "platform_settings",
  "member_payout_accounts",
  "board_messages",
  "board_post_drafts",
  "board_minutes",
  "board_mail"
];
const names = expectedTables.map((name) => `'${name}'`).join(",");

const tableCount = Number(
  firstRow(execute(`SELECT COUNT(*) AS n FROM pragma_table_list WHERE name IN (${names})`)).n
);
assertEqual(tableCount, expectedTables.length, "target table count");

const strictCount = Number(
  firstRow(execute(`SELECT COUNT(*) AS n FROM pragma_table_list WHERE name IN (${names}) AND strict = 1`)).n
);
assertEqual(strictCount, expectedTables.length, "STRICT table count");

assertColumn("teachers", "setup_intent_id");
assertColumn("board_post_drafts", "approval_message_id");
assertColumn("board_minutes", "drive_document_url");
assertColumn("bookings", "phone");
assertColumn("bookings", "cvr");
assertColumn("tribe_applicants", "invitation_token");
assertColumn("tribe_applicants", "personal_welcome_email_sent_at_ms");
assertColumn("membership_import_batches", "imported_by_email");
assertColumn("external_memberships", "normalized_email");
assertColumn("external_memberships", "last_import_batch_id");
assertColumn("membership_import_changes", "change_type");
assertColumn("room_bookings", "status");
assertColumn("room_bookings", "cancelled_at_ms");
assertColumn("room_bookings", "ticket_price_minor");
assertColumn("room_bookings", "payout_clerk_user_id");
assertColumn("room_booking_attendees", "registration_status");
assertColumn("room_booking_attendees", "stripe_checkout_session_id");
assertColumn("room_booking_attendees", "handling_fee_minor");
assertColumn("member_payout_accounts", "stripe_account_id");
assertColumn("members", "access_blocked");
assertColumn("external_memberships", "access_blocked");
assertColumn("member_access_changes", "changed_by_email");

assertEqual(
  Number(firstRow(execute("SELECT setting_value AS value FROM platform_settings WHERE setting_key = 'event_transaction_fee_minor'")).value),
  0,
  "default event handling fee"
);

const fkViolations = Number(
  firstRow(execute("SELECT COUNT(*) AS n FROM pragma_foreign_key_check")).n
);
assertEqual(fkViolations, 0, "foreign key violations after migration");

execute("INSERT INTO room_bookings (id, clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, max_attendees, fee_minor, created_at_ms, updated_at_ms) VALUES (1, 'synthetic-user', 'Synthetic Teacher', 'synthetic@example.invalid', 'Synthetic Event', 1000, 2000, 2, 20000, 1000, 1000)");
execute("INSERT INTO room_booking_attendees (id, room_booking_id, clerk_user_id, member_name, member_email, created_at_ms) VALUES (1, 1, 'synthetic-attendee', 'Synthetic Member', 'synthetic-member@example.invalid', 1000)");

execute("INSERT INTO room_booking_attendees (id, room_booking_id, clerk_user_id, member_name, member_email, created_at_ms) VALUES (2, 1, 'synthetic-attendee', 'Synthetic Member 2', 'synthetic2@example.invalid', 1000)", { expectFailure: true });
execute("INSERT INTO room_booking_attendees (id, room_booking_id, clerk_user_id, member_name, member_email, created_at_ms) VALUES (3, 999, 'orphan-user', 'Orphan', 'orphan@example.invalid', 1000)", { expectFailure: true });
execute("INSERT INTO room_bookings (id, clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, fee_minor, created_at_ms, updated_at_ms) VALUES (2, 'bad-time', 'Synthetic', 'synthetic@example.invalid', 'Invalid interval', 2000, 1000, 0, 1000, 1000)", { expectFailure: true });
execute("INSERT INTO room_bookings (id, clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, fee_minor, created_at_ms, updated_at_ms) VALUES (3, 'bad-money', 'Synthetic', 'synthetic@example.invalid', 'Invalid money', 3000, 4000, 1.5, 1000, 1000)", { expectFailure: true });

execute("INSERT INTO tribes (id, name, contact_name, contact_email) VALUES (1, 'Historical Tribe', 'Archive Contact', 'archive@example.invalid')");
execute("INSERT INTO tribe_applicants (id, full_name, email, tribe_id, invitation_token) VALUES (1, 'Historical Applicant', 'historical@example.invalid', 1, 'legacy-token')");
execute("INSERT INTO tribe_email_logs (id, tribe_id, subject, body, recipient_count, sender_email, sent_at_ms) VALUES (1, 1, 'Archive subject', 'Archive body', 1, 'archive@example.invalid', 1000)");
execute("INSERT INTO tribe_members (id, tribe_id, full_name, email) VALUES (1, 999, 'Orphan Archive Member', 'orphan-archive@example.invalid')", { expectFailure: true });

execute("INSERT INTO membership_import_batches (id, source, filename, imported_by_email, status, total_rows, started_at_ms, completed_at_ms) VALUES (1, 'membershipworks', 'members.csv', 'admin@example.invalid', 'completed', 1, 1000, 1001)");
execute("INSERT INTO external_memberships (id, source, normalized_email, full_name, status, raw_json, first_seen_at_ms, last_seen_at_ms, last_changed_at_ms, last_import_batch_id) VALUES (1, 'membershipworks', 'member@example.invalid', 'External Member', 'active', '{}', 1000, 1000, 1000, 1)");
execute("INSERT INTO external_memberships (id, source, normalized_email, full_name, status, raw_json, first_seen_at_ms, last_seen_at_ms, last_changed_at_ms, last_import_batch_id) VALUES (2, 'membershipworks', 'member@example.invalid', 'Duplicate Member', 'active', '{}', 1000, 1000, 1000, 1)", { expectFailure: true });
execute("INSERT INTO membership_import_changes (import_batch_id, external_membership_id, normalized_email, change_type, current_json, created_at_ms) VALUES (1, 1, 'member@example.invalid', 'created', '{}', 1000)");

execute("INSERT INTO webhook_events (provider, event_id, event_type, first_seen_at_ms) VALUES ('stripe', 'evt_synthetic', 'test.event', 1000)");
execute("INSERT INTO webhook_events (provider, event_id, event_type, first_seen_at_ms) VALUES ('stripe', 'evt_synthetic', 'test.event', 1001)", { expectFailure: true });

execute("INSERT INTO job_claims (job_key, scheduled_for_ms, claimed_at_ms) VALUES ('teacher-charge', 1000, 1000)");
execute("INSERT INTO job_claims (job_key, scheduled_for_ms, claimed_at_ms) VALUES ('teacher-charge', 1000, 1001)", { expectFailure: true });

const finalFkViolations = Number(
  firstRow(execute("SELECT COUNT(*) AS n FROM pragma_foreign_key_check")).n
);
assertEqual(finalFkViolations, 0, "foreign key violations after synthetic checks");

process.stdout.write("D1 schema validation passed.\n");

