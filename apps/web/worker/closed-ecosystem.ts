/** The chair (27 Nov 2026): "alle forbindelser til holistisk og membership works skal klippes så vores nye siden er et helt og lukket økosystem".
 * Besides taking out every call and link, the worker refuses any request to MembershipWorks or holistisk.org outright (guardFetch, installed in
 * config-entry.ts), so nothing forgotten can reach them. Mailchimp's form address (holistisk.us6.list-manage.com) is Mailchimp's, not holistisk.org. */
const CUT = /(^|\.)(membershipworks\.com|holistisk\.org)$/i;

export function isCutOff(url: string | URL): boolean {
  try { return CUT.test(new URL(String(url)).hostname); } catch { return false; }
}

export function guardFetch(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (isCutOff(url)) {
      console.warn("cut_off_request_refused", new URL(url).hostname);
      return new Response(JSON.stringify({ error: "cut_off" }), { status: 403, headers: { "content-type": "application/json" } });
    }
    return inner(input as RequestInfo, init);
  }) as typeof fetch;
}
