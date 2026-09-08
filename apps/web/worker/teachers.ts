import type { D1Database } from "./db.js";
import { stripeRequest, type StripeEvent } from "./stripe.js";

export type TeacherRow = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  cvr: string | null;
  card_status: string;
  stripe_customer_id: string | null;
  setup_link_token: string | null;
  setup_intent_id: string | null;
  default_payment_method_id: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`invalid_${field}`);
  return value.trim();
}

function optionalText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`invalid_${field}`);
  return value.trim() || null;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseTeacherCreate(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const body = value as Record<string, unknown>;
  return {
    name: requiredText(body.name, "name"),
    email: optionalText(body.email, "email") ?? null,
    phone: optionalText(body.phone, "phone") ?? null,
    cvr: optionalText(body.cvr, "cvr") ?? null
  };
}

export function parseTeacherUpdate(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("invalid_body");
  const body = value as Record<string, unknown>;
  const name = body.name === undefined ? undefined : requiredText(body.name, "name");
  const email = optionalText(body.email, "email");
  const phone = optionalText(body.phone, "phone");
  const cvr = optionalText(body.cvr, "cvr");
  if (name === undefined && email === undefined && phone === undefined && cvr === undefined) {
    throw new Error("invalid_empty_update");
  }
  return { name, email, phone, cvr };
}

export async function listTeachers(db: D1Database): Promise<TeacherRow[]> {
  const result = await db.prepare(
    `SELECT id, name, email, phone, cvr, card_status, stripe_customer_id,
            setup_link_token, setup_intent_id, default_payment_method_id,
            created_at_ms, updated_at_ms
     FROM teachers ORDER BY name COLLATE NOCASE ASC`
  ).all<TeacherRow>();
  return result.results ?? [];
}

export async function getTeacher(db: D1Database, id: number): Promise<TeacherRow | null> {
  return db.prepare(
    `SELECT id, name, email, phone, cvr, card_status, stripe_customer_id,
            setup_link_token, setup_intent_id, default_payment_method_id,
            created_at_ms, updated_at_ms
     FROM teachers WHERE id = ? LIMIT 1`
  ).bind(id).first<TeacherRow>();
}

export async function createTeacher(db: D1Database, input: ReturnType<typeof parseTeacherCreate>): Promise<TeacherRow> {
  const now = Date.now();
  const result = await db.prepare(
    `INSERT INTO teachers (name, email, phone, cvr, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(input.name, input.email, input.phone, input.cvr, now, now).run();
  const id = result.meta?.last_row_id;
  if (typeof id !== "number") throw new Error("teacher_insert_failed");
  const teacher = await getTeacher(db, id);
  if (!teacher) throw new Error("teacher_insert_failed");
  return teacher;
}

export async function updateTeacher(
  db: D1Database,
  id: number,
  input: ReturnType<typeof parseTeacherUpdate>
): Promise<TeacherRow> {
  const current = await getTeacher(db, id);
  if (!current) throw new Error("teacher_not_found");
  await db.prepare(
    `UPDATE teachers SET name = ?, email = ?, phone = ?, cvr = ?, updated_at_ms = ? WHERE id = ?`
  ).bind(
    input.name ?? current.name,
    input.email === undefined ? current.email : input.email,
    input.phone === undefined ? current.phone : input.phone,
    input.cvr === undefined ? current.cvr : input.cvr,
    Date.now(),
    id
  ).run();
  const teacher = await getTeacher(db, id);
  if (!teacher) throw new Error("teacher_not_found");
  return teacher;
}

export async function createTeacherSetupLink(
  db: D1Database,
  id: number,
  appBaseUrl: string
): Promise<{ setupUrl: string; token: string }> {
  const teacher = await getTeacher(db, id);
  if (!teacher) throw new Error("teacher_not_found");
  const token = randomToken();
  await db.prepare(
    `UPDATE teachers SET setup_link_token = ?, card_status = 'setup_pending', updated_at_ms = ? WHERE id = ?`
  ).bind(token, Date.now(), id).run();
  return {
    token,
    setupUrl: `${appBaseUrl.replace(/\/$/, "")}/setup/${token}`
  };
}

export async function getTeacherBySetupToken(db: D1Database, token: string): Promise<TeacherRow | null> {
  return db.prepare(
    `SELECT id, name, email, phone, cvr, card_status, stripe_customer_id,
            setup_link_token, setup_intent_id, default_payment_method_id,
            created_at_ms, updated_at_ms
     FROM teachers WHERE setup_link_token = ? LIMIT 1`
  ).bind(token).first<TeacherRow>();
}

export async function beginTeacherCardSetup(
  db: D1Database,
  stripeSecretKey: string,
  token: string
): Promise<{ clientSecret: string; teacherId: number }> {
  const teacher = await getTeacherBySetupToken(db, token);
  if (!teacher) throw new Error("setup_token_not_found");

  let customerId = teacher.stripe_customer_id;
  if (!customerId) {
    const customer = await stripeRequest<{ id?: string }>(stripeSecretKey, "POST", "/customers", {
      name: teacher.name,
      email: teacher.email,
      phone: teacher.phone,
      "metadata[hjerterum_teacher_id]": teacher.id
    });
    if (!customer.id) throw new Error("stripe_customer_missing");
    customerId = customer.id;
  }

  const setupIntent = await stripeRequest<{ id?: string; client_secret?: string }>(
    stripeSecretKey,
    "POST",
    "/setup_intents",
    {
      customer: customerId,
      usage: "off_session",
      "metadata[hjerterum_teacher_id]": teacher.id
    },
    { idempotencyKey: `hjerterum-teacher-setup-${teacher.id}-${token}` }
  );
  if (!setupIntent.id || !setupIntent.client_secret) throw new Error("stripe_setup_intent_missing");

  await db.prepare(
    `UPDATE teachers
     SET stripe_customer_id = ?, setup_intent_id = ?, card_status = 'setup_pending', updated_at_ms = ?
     WHERE id = ?`
  ).bind(customerId, setupIntent.id, Date.now(), teacher.id).run();

  return { clientSecret: setupIntent.client_secret, teacherId: teacher.id };
}

async function claimWebhook(db: D1Database, event: StripeEvent): Promise<boolean> {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO webhook_events (provider, event_id, event_type, first_seen_at_ms)
     VALUES ('stripe-teacher', ?, ?, ?)`
  ).bind(event.id, event.type, Date.now()).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function processTeacherStripeEvent(
  db: D1Database,
  event: StripeEvent
): Promise<{ duplicate: boolean }> {
  if (!(await claimWebhook(db, event))) return { duplicate: true };
  try {
    if (event.type === "setup_intent.succeeded") {
      const object = event.data?.object ?? {};
      const setupIntentId = typeof object.id === "string" ? object.id : null;
      const customerId = typeof object.customer === "string" ? object.customer : null;
      const paymentMethodId = typeof object.payment_method === "string" ? object.payment_method : null;
      const metadata = (object.metadata ?? {}) as Record<string, unknown>;
      const metadataTeacherId = Number(metadata.hjerterum_teacher_id);

      let teacherId: number | null = Number.isInteger(metadataTeacherId) && metadataTeacherId > 0
        ? metadataTeacherId
        : null;
      if (!teacherId && setupIntentId) {
        const row = await db.prepare("SELECT id FROM teachers WHERE setup_intent_id = ? LIMIT 1")
          .bind(setupIntentId).first<{ id: number }>();
        teacherId = row?.id ?? null;
      }
      if (!teacherId) throw new Error("teacher_setup_owner_missing");

      await db.prepare(
        `UPDATE teachers
         SET stripe_customer_id = COALESCE(?, stripe_customer_id),
             default_payment_method_id = ?, card_status = 'card_saved',
             setup_link_token = NULL, updated_at_ms = ?
         WHERE id = ?`
      ).bind(customerId, paymentMethodId, Date.now(), teacherId).run();
      await db.prepare(
        `UPDATE bookings SET payment_status = 'card_saved', updated_at_ms = ?
         WHERE teacher_id = ? AND payment_status = 'pending_card'`
      ).bind(Date.now(), teacherId).run();
    }

    await db.prepare(
      `UPDATE webhook_events SET status = 'processed', processed_at_ms = ?
       WHERE provider = 'stripe-teacher' AND event_id = ?`
    ).bind(Date.now(), event.id).run();
    return { duplicate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "teacher_webhook_failed";
    await db.prepare(
      `UPDATE webhook_events SET status = 'failed', last_error = ?
       WHERE provider = 'stripe-teacher' AND event_id = ?`
    ).bind(message.slice(0, 1000), event.id).run();
    throw error;
  }
}
