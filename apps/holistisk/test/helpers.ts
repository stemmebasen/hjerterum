import { readFileSync } from "node:fs";

export const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

export type Route = { status?: number; body?: string; headers?: Record<string, string> } | ((url: string) => { status?: number; body?: string; headers?: Record<string, string> });

/** A fetch that answers from a table of URLs (prefix match), and records what was asked. */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const key = Object.keys(routes).filter(k => url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    const route = key ? routes[key]! : { status: 404, body: "not found" };
    const r = typeof route === "function" ? route(url) : route;
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: r.headers ?? {} });
  }) as typeof fetch;
  return { fetcher, calls };
}

export const noSleep = async () => {};
export const MW_ROBOTS = "User-agent: *\nAllow: /$\nAllow: /api*\nAllow: /v1/*\nAllow: /v2/*\nDisallow: /\n";
export const FEED_URL = "https://api.membershipworks.com/v2/events?_op=rss&org=22308";
