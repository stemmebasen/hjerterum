/** Outbound HTTP for the collector: a clear user agent, a timeout, a few retries with backoff for temporary failures
 * (network errors, 429, 5xx), and robots.txt honoured for sources that ask for it. */

export const USER_AGENT = "holistisk.org-eventportal/0.1 (+https://holistisk.org/om)";

export class HttpError extends Error {
  constructor(message: string, readonly status: number | null, readonly attempts: number) { super(message); }
}

export type HttpOptions = {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  timeoutMs?: number;
};

export type HttpResponse = { status: number; headers: Headers; body: ArrayBuffer; attempts: number; url: string };

export interface HttpClient {
  get(url: string, init?: { headers?: Record<string, string>; respectRobots?: boolean }): Promise<HttpResponse>;
  /** Total requests sent, for the run log and the Workers subrequest budget. */
  readonly requests: number;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export function createHttpClient(options: HttpOptions = {}): HttpClient {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const maxAttempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const robots = new Map<string, Promise<RobotsRules>>();
  let requests = 0;

  async function send(url: string, headers: Record<string, string>): Promise<HttpResponse> {
    let lastError: HttpError | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      requests++;
      try {
        const response = await fetcher(url, { headers: { "user-agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
        if (response.ok) return { status: response.status, headers: response.headers, body: await response.arrayBuffer(), attempts: attempt, url: response.url || url };
        lastError = new HttpError(`http_${response.status}`, response.status, attempt);
        if (!RETRYABLE.has(response.status)) throw lastError;
        const retryAfter = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        if (attempt < maxAttempts) await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : backoff(attempt));
      } catch (error) {
        if (error instanceof HttpError && !RETRYABLE.has(error.status ?? 0)) throw error;
        lastError = error instanceof HttpError ? error : new HttpError(`network_${error instanceof Error ? error.name : "error"}`, null, attempt);
        if (attempt < maxAttempts) await sleep(backoff(attempt));
      }
    }
    throw new HttpError(lastError?.message ?? "fetch_failed", lastError?.status ?? null, maxAttempts);
  }

  return {
    get requests() { return requests; },
    async get(url, init = {}) {
      if (init.respectRobots !== false) {
        const origin = new URL(url).origin;
        let rules = robots.get(origin);
        if (!rules) {
          rules = send(`${origin}/robots.txt`, {}).then(r => parseRobots(new TextDecoder().decode(r.body)), (e: unknown) => {
            // No robots.txt (404) means no restrictions; an unreachable one means we do not know, so we stay away.
            if (e instanceof HttpError && e.status !== null && e.status >= 400 && e.status < 500) return ALLOW_ALL;
            return DISALLOW_ALL;
          });
          robots.set(origin, rules);
        }
        const u = new URL(url);
        if (!isAllowed(await rules, u.pathname + u.search)) throw new HttpError("robots_disallowed", null, 0);
      }
      return send(url, init.headers ?? {});
    }
  };
}

const backoff = (attempt: number) => 1000 * 3 ** (attempt - 1);

export type RobotsRules = Array<{ allow: boolean; pattern: string }>;
const ALLOW_ALL: RobotsRules = [];
const DISALLOW_ALL: RobotsRules = [{ allow: false, pattern: "/" }];

/** The rules of the group for our agent ("holistisk") or, failing that, for "*". */
export function parseRobots(text: string): RobotsRules {
  const groups: Array<{ agents: string[]; rules: RobotsRules }> = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase(), value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (value === "" && key === "disallow") continue;
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  const ours = groups.find(g => g.agents.some(a => a !== "*" && USER_AGENT.toLowerCase().includes(a)));
  return (ours ?? groups.find(g => g.agents.includes("*")))?.rules ?? ALLOW_ALL;
}

/** Longest matching rule wins; Allow wins a tie. Supports * and $ as in Google's robots.txt rules. */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules) {
    const re = new RegExp("^" + rule.pattern.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
    if (!re.test(path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}

/** Bytes to text. Valid UTF-8 is read as UTF-8 even when a feed declares Latin-1 (MembershipWorks declares
 * ISO-8859-1 but sends UTF-8); anything else is read in the declared Latin-1/Windows-1252 charset. */
export function decodeBody(body: ArrayBuffer, contentType: string | null): string {
  const bytes = new Uint8Array(body);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const head = new TextDecoder("utf-8").decode(bytes.slice(0, 200));
    const charset = (/charset=([\w-]+)/i.exec(contentType ?? "")?.[1] ?? /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? "").toLowerCase();
    if (!["iso-8859-1", "latin1", "windows-1252", "us-ascii"].includes(charset)) return new TextDecoder("utf-8").decode(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return out;
  }
}
