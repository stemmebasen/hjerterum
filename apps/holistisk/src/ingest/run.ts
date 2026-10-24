import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { ADAPTERS, SOURCES } from "../sources/registry.js";
import { BudgetError, createHttpClient, HttpError, type HttpOptions } from "../sources/http.js";
import type { SourceConfig } from "../sources/types.js";
import { ENRICH_BUDGET, expireEvents, markSourceEnabled, processSource, syncSources, type SourceStats } from "./store.js";

/** One collection run. Each source succeeds or fails on its own; the run and each source's outcome are written to
 * ingest_runs / ingest_source_runs and to the Worker log, so a failed night can be seen and diagnosed afterwards.
 * A run is skipped while another one is still going.
 *
 * A Worker invocation may only send 50 requests (Workers Free), so a run has a request budget (INGEST_REQUEST_BUDGET,
 * default 45). Sources take turns, the longest without a successful collection first; a source the budget no longer
 * covers is "deferred" (logged as skipped) and goes first next run. With onlyDue, a run takes only the sources not
 * collected in the last 20 hours (and, for the cron, not failed in the last 3), so the hourly cron keeps every source
 * fresh daily. */

export type RunOutcome = {
  runId: string | null;
  status: "ok" | "partial" | "failed" | "skipped";
  reason?: string;
  sources: Array<{ id: string; status: "ok" | "failed" | "skipped"; error?: string } & Partial<SourceStats>>;
  /** Sources the request budget did not cover; they go first next run. */
  deferred: string[];
  expired: number;
};

export type RunOptions = HttpOptions & {
  now?: number; trigger: string; sources?: SourceConfig[]; enrichBudget?: number;
  /** Only the sources due (see above); retryFailed also takes a source that failed in the last three hours. */
  onlyDue?: boolean; retryFailed?: boolean;
};

const STALE_RUN_MS = 15 * 60_000;
const KEEP_RUNS_MS = 120 * 86400_000;
export const DUE_AFTER_MS = 20 * 3600_000;
const RETRY_FAILED_AFTER_MS = 3 * 3600_000;
export const REQUEST_BUDGET = 45;
/** Requests kept back from detail lookups for each source's robots.txt, listing and a retry. */
const FETCH_RESERVE = 4;

export async function runIngest(env: Env, options: RunOptions): Promise<RunOutcome> {
  const db = env.DB;
  if (!db) throw new Error("database_unbound");
  const now = options.now ?? Date.now();
  const sources = options.sources ?? SOURCES;

  // A run that has been "running" for a quarter of an hour died (the Worker was stopped); it is closed as failed.
  await db.prepare("UPDATE ingest_runs SET status = 'failed', finished_at = ?, summary = '{\"error\":\"stale_run\"}' WHERE status = 'running' AND started_at < ?").bind(now, now - STALE_RUN_MS).run();
  const running = await db.prepare("SELECT id FROM ingest_runs WHERE status = 'running' LIMIT 1").first<{ id: string }>();
  if (running) return { runId: null, status: "skipped", reason: "already_running", sources: [], deferred: [], expired: 0 };

  // Stalest first: never collected, then the longest since the last successful collection.
  const history = new Map((await db.prepare(
    `SELECT s.source_id, MAX(CASE WHEN s.status = 'ok' THEN r.started_at END) AS ok, MAX(CASE WHEN s.status = 'failed' THEN r.started_at END) AS failed
     FROM ingest_source_runs s JOIN ingest_runs r ON r.id = s.run_id GROUP BY s.source_id`
  ).all<{ source_id: string; ok: number | null; failed: number | null }>()).results.map(r => [r.source_id, r]));
  const lastOk = (id: string) => history.get(id)?.ok ?? 0;
  const due = (id: string) => lastOk(id) < now - DUE_AFTER_MS && (options.retryFailed || (history.get(id)?.failed ?? 0) < now - RETRY_FAILED_AFTER_MS);
  const enabled = sources.filter(s => s.enabled(env));
  const queue = enabled.filter(s => !options.onlyDue || due(s.id)).sort((a, b) => lastOk(a.id) - lastOk(b.id));
  if (options.onlyDue && !queue.length) return { runId: null, status: "skipped", reason: "nothing_due", sources: [], deferred: [], expired: await expireEvents(db, now) };

  const runId = `run_${new Date(now).toISOString().replace(/[-:.TZ]/g, "")}_${crypto.randomUUID().slice(0, 8)}`;
  await db.prepare("INSERT INTO ingest_runs (id, trigger, started_at, status) VALUES (?, ?, ?, 'running')").bind(runId, options.trigger, now).run();

  const outcome: RunOutcome = { runId, status: "ok", sources: [], deferred: [], expired: 0 };
  try {
    await syncSources(db, sources, now);
    const priorities = new Map(sources.map(s => [s.id, s.priority]));
    const budget = options.requestBudget ?? (Number(env.INGEST_REQUEST_BUDGET) || REQUEST_BUDGET);
    const http = createHttpClient({ ...options, requestBudget: budget });
    for (const source of sources) {
      if (source.enabled(env)) continue;
      await markSourceEnabled(db, source.id, false);
      await logSource(db, runId, source.id, "skipped", null, 0, "disabled", now, Date.now());
      outcome.sources.push({ id: source.id, status: "skipped", error: "disabled" });
    }
    for (const source of queue) {
      const started = Date.now();
      const defer = async () => {
        await logSource(db, runId, source.id, "skipped", null, 0, "deferred", now, started);
        outcome.sources.push({ id: source.id, status: "skipped", error: "deferred" });
        outcome.deferred.push(source.id);
      };
      if (outcome.deferred.length || (http.requests > 0 && http.remaining < FETCH_RESERVE)) { await defer(); continue; }
      const before = http.requests;
      const enrichBudget = Math.min(options.enrichBudget ?? ENRICH_BUDGET, Math.max(0, http.remaining - FETCH_RESERVE));
      try {
        const stats = await processSource(db, source, ADAPTERS[source.adapter], { http, env, now }, runId, priorities, enrichBudget);
        await logSource(db, runId, source.id, "ok", stats, http.requests - before, null, now, started);
        outcome.sources.push({ id: source.id, status: "ok", ...stats });
        console.log(JSON.stringify({ event: "ingest_source", runId, source: source.id, status: "ok", ...stats }));
      } catch (error) {
        // Out of budget with the whole budget to itself, a source can never be collected: that is a failure.
        if (error instanceof BudgetError && before > 0) { await defer(); continue; }
        const message = error instanceof BudgetError ? `request_budget_exceeded (${budget})` : describe(error);
        await logSource(db, runId, source.id, "failed", null, http.requests - before, message, now, started);
        outcome.sources.push({ id: source.id, status: "failed", error: message });
        console.error(JSON.stringify({ event: "ingest_source", runId, source: source.id, status: "failed", error: message }));
      }
    }
    outcome.expired = await expireEvents(db, now);
    const active = outcome.sources.filter(s => s.status !== "skipped");
    const failed = active.filter(s => s.status === "failed").length;
    outcome.status = active.length === 0 ? "ok" : failed === 0 ? "ok" : failed === active.length ? "failed" : "partial";
  } catch (error) {
    outcome.status = "failed";
    outcome.reason = describe(error);
    console.error(JSON.stringify({ event: "ingest_run_error", runId, error: outcome.reason }));
  }

  await db.prepare("UPDATE ingest_runs SET status = ?, finished_at = ?, summary = ? WHERE id = ?")
    .bind(outcome.status, Date.now(), JSON.stringify({ reason: outcome.reason, expired: outcome.expired, deferred: outcome.deferred, sources: outcome.sources }), runId).run();
  await db.prepare("DELETE FROM ingest_runs WHERE started_at < ?").bind(now - KEEP_RUNS_MS).run();
  console.log(JSON.stringify({ event: "ingest_run", runId, trigger: options.trigger, status: outcome.status, deferred: outcome.deferred, expired: outcome.expired }));
  return outcome;
}

function describe(error: unknown): string {
  if (error instanceof HttpError) return `${error.message}${error.attempts ? ` after ${error.attempts} attempt(s)` : ""}`;
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function logSource(db: D1Database, runId: string, sourceId: string, status: "ok" | "failed" | "skipped", stats: SourceStats | null, attempts: number, error: string | null, now: number, started: number) {
  await db.prepare(
    `INSERT INTO ingest_source_runs (run_id, source_id, status, attempts, fetched, created, updated, unchanged, duplicates, rejected, withdrawn, error, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(runId, sourceId, status, attempts, stats?.fetched ?? 0, stats?.created ?? 0, stats?.updated ?? 0, stats?.unchanged ?? 0, stats?.duplicates ?? 0,
    stats?.rejected ?? 0, stats?.withdrawn ?? 0, error, Math.max(now, started), Date.now()).run();
}

/** The cron: every trigger (daily at 03:17 and hourly) collects the sources that are due, within the request budget,
 * and retires ended events. */
export const DAILY_CRON = "17 3 * * *";

export async function scheduledRun(env: Env, cron: string, options: HttpOptions & { now?: number } = {}): Promise<RunOutcome> {
  if (!env.DB) throw new Error("database_unbound");
  return runIngest(env, { ...options, now: options.now ?? Date.now(), trigger: cron === DAILY_CRON ? "cron_daily" : "cron_hourly", onlyDue: true });
}

export type IngestStatus = {
  lastRun: { id: string; trigger: string; status: string; startedAt: string; finishedAt: string | null } | null;
  lastSuccessAt: string | null;
  healthy: boolean;
  /** Each source's latest collection (a deferral only while it has never been tried). */
  sources: Array<{ id: string; status: string; at: string; requests: number; fetched: number; created: number; updated: number; error: string | null }>;
  events: { upcoming: number; total: number };
};

/** For /api/status and the health check: healthy when a run succeeded in the last 36 hours. */
export async function ingestStatus(db: D1Database, now: number): Promise<IngestStatus> {
  const last = await db.prepare("SELECT id, trigger, status, started_at, finished_at FROM ingest_runs ORDER BY started_at DESC LIMIT 1")
    .first<{ id: string; trigger: string; status: string; started_at: number; finished_at: number | null }>();
  const ok = await db.prepare("SELECT MAX(started_at) AS at FROM ingest_runs WHERE status IN ('ok', 'partial')").first<{ at: number | null }>();
  const sources = (await db.prepare(
    `SELECT source_id, status, started_at, attempts, fetched, created, updated, error FROM ingest_source_runs s
     WHERE rowid = (SELECT rowid FROM ingest_source_runs t WHERE t.source_id = s.source_id ORDER BY COALESCE(t.error, '') = 'deferred', t.started_at DESC LIMIT 1)
     ORDER BY source_id`
  ).all<{ source_id: string; status: string; started_at: number; attempts: number; fetched: number; created: number; updated: number; error: string | null }>()).results;
  const counts = await db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('scheduled', 'cancelled') AND COALESCE(ends_at, starts_at + 10800000) >= ? THEN 1 ELSE 0 END) AS upcoming FROM events")
    .bind(now).first<{ total: number; upcoming: number | null }>();
  return {
    lastRun: last ? { id: last.id, trigger: last.trigger, status: last.status, startedAt: new Date(last.started_at).toISOString(), finishedAt: last.finished_at ? new Date(last.finished_at).toISOString() : null } : null,
    lastSuccessAt: ok?.at ? new Date(ok.at).toISOString() : null,
    healthy: !!ok?.at && now - ok.at < 36 * 3600_000,
    sources: sources.map(s => ({ id: s.source_id, status: s.status, at: new Date(s.started_at).toISOString(), requests: s.attempts, fetched: s.fetched, created: s.created, updated: s.updated, error: s.error })),
    events: { upcoming: counts?.upcoming ?? 0, total: counts?.total ?? 0 }
  };
}
