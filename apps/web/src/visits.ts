/** admin → Statistik and the statistics API (worker/site-stats.ts): every page the website shows sends one small signal.
 * No cookies and nothing stored in the browser; the server never keeps the address. Login, member and admin pages
 * never call this, and the server counts only the website's own pages. */

let counted = "";

/** Only where the visitor came from (the other site's address, not its page) and a campaign's utm_ labels. */
function arrival() {
  let from = "";
  try { from = document.referrer ? new URL(document.referrer).origin : ""; } catch { /* no referrer */ }
  const campaign = new URLSearchParams([...new URLSearchParams(window.location.search)].filter(([name]) => name.startsWith("utm_")));
  return { r: from, q: campaign.toString() };
}

/** Called by each public page when it is shown - once per page, also if a page is ever changed without a reload. */
export function countVisit() {
  const path = window.location.pathname;
  if (path === counted) return;
  counted = path;
  const body = JSON.stringify({ p: path, ...arrival() });
  try {
    if (navigator.sendBeacon?.("/api/besog", body)) return;
    void fetch("/api/besog", { method: "POST", body, keepalive: true }).catch(() => undefined);
  } catch { /* counting never stands in the way of the page */ }
}
