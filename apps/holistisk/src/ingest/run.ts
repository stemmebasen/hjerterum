import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { ADAPTERS, SOURCES } from "../sources/registry.js";
import { createHttpClient, HttpError, type HttpOptions } from "../sources/http.js";
import type { SourceConfig } from "../sources/types.js";
import { expireEvents, markSourceEnabled, processSource, syncSources, type SourceStats } from "./store.js";

/** One collection run over every enabled source. Each source succeeds or fails on its own; the run and each source's
 * outcome are written to ingest_runs / ingest_source_runs and to the Worker log, so a failed night can be seen and
 * diagnosed afterwards. A run is skipped while another one is still going. */

export type RunOutcome = {
  runId: string | null;
  status: "ok" | "partial" | "failed" | "skipped";
  reason?: string;
  sources: Array<{ id: string; status: "ok" | "failed" | "skipped"; error?: string } & Partial<SourceStats>>;
  expired: number;
};

export type RunOptions = HttpOptions & { now?: number; trigger: string; sources?: SourceConfig[]; enrichBudget?: number };

const STALE_RUN_MS = 15 * 60_000;
const KEEP_RUNS_MS = 120 * 86400_000;

export async function runIngest(env: Env, options: RunOptions): Promise<RunOutcome> {
  const db = env.DB;
  if (!db) throw new Error("database_unbound");
  const now = options.now ?? Date.now();
  const sources = options.sources ?? SOURCES;

  // A run that has been "running" for a quarter of an hour died (the Worker was stopped); it is closed as failed.
  await db.prepare("UPDATE ingest_runs SET status = 'failed', finished_at = ?, summary = '{\"error\":\"stale_run\"}' WHERE status = 'running' AND started_at < ?").bind(now, now - STALE_RUN_MS).run();
  const running = await db.prepare("SELECT id FROM ingest_runs WHERE status = 'running' LIMIT 1").first<{ id: string }>();
  if (running) return { runId: null, status: "skipped", reason: "already_running", sources: [], expired: 0 };

  const runId = `run_${new Date(now).toISOString().replace(/[-:.TZ]/g, "")}_${crypto.randomUUID().slice(0, 8)}`;
  await db.prepare("INSERT INTO ingest_runs (id, trigger, started_at, status) VALUES (?, ?, ?, 'running')").bind(runId, options.trigger, now).run();

  const outcome: RunOutcome = { runId, status: "ok", sources: [], expired: 0 };
  try {
    await syncSources(db, sources, now);
    const priorities = new Map(sources.map(s => [s.id, s.priority]));
    const http = createHttpClient(options);
    for (const source of sources) {
      const started = Date.now();
      if (!source.enabled(env)) {
        await markSourceEnabled(db, source.id, false);
        await logSource(db, runId, source.id, "skipped", null, 0, "disabled", now, started);
        outcome.sources.push({ id: source.id, status: "skipped", error: "disabled" });
        continue;
      }
      const before = http.requests;
      try {
        const stats = await processSource(db, source, ADAPTERS[source.adapter], { http, env, now }, runId, priorities, options.enrichBudget);
        await logSource(db, runId, source.id, "ok", stats, http.requests - before, null, now, started);
        outcome.sources.push({ id: source.id, status: "ok", ...stats });
        console.log(JSON.stringify({ event: "ingest_source", runId, source: source.id, status: "ok", ...stats }));
      } catch (error) {
        const message = describe(error);
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
    .bind(outcome.status, Date.now(), JSON.stringify({ reason: outcome.reason, expired: outcome.expired, sources: outcome.sources }), runId).run();
  await db.prepare("DELETE FROM ingest_runs WHERE started_at < ?").bind(now - KEEP_RUNS_MS).run();
  console.log(JSON.stringify({ event: "ingest_run", runId, trigger: options.trigger, status: outcome.status, expired: outcome.expired }));
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

/** The cron: the daily trigger always collects; the six-hourly one collects only when no run has succeeded in the
 * last 20 hours (the daily one failed or did not happen), and otherwise just retires ended events. */
export const DAILY_CRON = "17 3 * * *";

export async function scheduledRun(env: Env, cron: string, options: HttpOptions & { now?: number } = {}): Promise<RunOutcome> {
  const db = env.DB;
  if (!db) throw new Error("database_unbound");
  const now = options.now ?? Date.now();
  if (cron === DAILY_CRON) return runIngest(env, { ...options, now, trigger: "cron_daily" });
  const recent = await db.prepare("SELECT id FROM ingest_runs WHERE status IN ('ok', 'partial') AND started_at >= ? LIMIT 1").bind(now - 20 * 3600_000).first<{ id: string }>();
  if (!recent) return runIngest(env, { ...options, now, trigger: "cron_catch_up" });
  return { runId: null, status: "skipped", reason: "recent_success", sources: [], expired: await expireEvents(db, now) };
}

export type IngestStatus = {
  lastRun: { id: string; trigger: string; status: string; startedAt: string; finishedAt: string | null } | null;
  lastSuccessAt: string | null;
  healthy: boolean;
  sources: Array<{ id: string; status: string; fetched: number; created: number; updated: number; error: string | null }>;
  events: { upcoming: number; total: number };
};

/** For /api/status and the health check: healthy when a run succeeded in the last 36 hours. */
export async function ingestStatus(db: D1Database, now: number): Promise<IngestStatus> {
  const last = await db.prepare("SELECT id, trigger, status, started_at, finished_at FROM ingest_runs ORDER BY started_at DESC LIMIT 1")
    .first<{ id: string; trigger: string; status: string; started_at: number; finished_at: number | null }>();
  const ok = await db.prepare("SELECT MAX(started_at) AS at FROM ingest_runs WHERE status IN ('ok', 'partial')").first<{ at: number | null }>();
  const sources = last ? (await db.prepare("SELECT source_id, status, fetched, created, updated, error FROM ingest_source_runs WHERE run_id = ? ORDER BY source_id")
    .bind(last.id).all<{ source_id: string; status: string; fetched: number; created: number; updated: number; error: string | null }>()).results : [];
  const counts = await db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('scheduled', 'cancelled') AND COALESCE(ends_at, starts_at + 10800000) >= ? THEN 1 ELSE 0 END) AS upcoming FROM events")
    .bind(now).first<{ total: number; upcoming: number | null }>();
  return {
    lastRun: last ? { id: last.id, trigger: last.trigger, status: last.status, startedAt: new Date(last.started_at).toISOString(), finishedAt: last.finished_at ? new Date(last.finished_at).toISOString() : null } : null,
    lastSuccessAt: ok?.at ? new Date(ok.at).toISOString() : null,
    healthy: !!ok?.at && now - ok.at < 36 * 3600_000,
    sources: sources.map(s => ({ id: s.source_id, status: s.status, fetched: s.fetched, created: s.created, updated: s.updated, error: s.error })),
    events: { upcoming: counts?.upcoming ?? 0, total: counts?.total ?? 0 }
  };
}
