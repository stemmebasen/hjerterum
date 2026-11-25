import { LOGO_WHITE_PNG } from "./logo.js";

/** The chair (25 Nov 2026): "Indsæt også et billede af en kvinde på 40 med hjerterums logo på siden". Jewel as a drawing - a woman of about forty with
 * Hjerterum's badge on her top - not a photograph of a real person, so no one takes her for a real woman answering. The badge is the chair's own logo
 * file (logo.ts), not a drawn logo. Served at /jewel.svg, with the logo inside, so it can be shown with an ordinary <img>. */
export const JEWEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="Jewel">
  <defs><clipPath id="c"><circle cx="120" cy="120" r="118"/></clipPath>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1e4d3"/><stop offset="1" stop-color="#e6cfb6"/></linearGradient></defs>
  <g clip-path="url(#c)">
    <rect width="240" height="240" fill="url(#bg)"/>
    <!-- hair, back -->
    <path d="M62 118c-6-52 22-86 60-86s66 30 60 86c-2 22 6 40 14 54-26 10-52 8-74 4-22 4-48 6-74-4 8-14 16-32 14-54z" fill="#5b3424"/>
    <!-- neck -->
    <path d="M104 150h32v30c-10 8-22 8-32 0z" fill="#d9a585"/>
    <!-- shoulders / top -->
    <path d="M28 240c4-40 34-62 72-68 6 10 14 14 20 14s14-4 20-14c38 6 68 28 72 68z" fill="#2f4a4c"/>
    <path d="M100 172c6 10 13 15 20 15s14-5 20-15l-6-4c-4 7-9 10-14 10s-10-3-14-10z" fill="#d9a585"/>
    <!-- face -->
    <ellipse cx="120" cy="112" rx="38" ry="46" fill="#e8b996"/>
    <!-- ears + earrings -->
    <ellipse cx="82" cy="116" rx="6" ry="9" fill="#dfab88"/><ellipse cx="158" cy="116" rx="6" ry="9" fill="#dfab88"/>
    <circle cx="82" cy="129" r="3.2" fill="#c9a24a"/><circle cx="158" cy="129" r="3.2" fill="#c9a24a"/>
    <!-- hair, front: side-swept fringe -->
    <path d="M80 104c2-34 22-52 46-52 22 0 38 14 40 38-16-4-34-14-44-28-8 18-24 34-42 42z" fill="#6a3d2b"/>
    <path d="M78 102c-4 20-2 40 6 58-10-6-16-22-16-40 0-8 4-14 10-18z" fill="#5b3424"/>
    <path d="M162 92c6 18 6 44-4 66 12-8 18-24 18-42 0-12-6-20-14-24z" fill="#5b3424"/>
    <!-- brows -->
    <path d="M99 101c5-4 12-5 18-2" stroke="#4a2a1d" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M124 99c6-3 13-2 18 2" stroke="#4a2a1d" stroke-width="3" fill="none" stroke-linecap="round"/>
    <!-- eyes, smiling -->
    <path d="M101 113c4-4 10-4 14 0" stroke="#3a2219" stroke-width="2.8" fill="none" stroke-linecap="round"/>
    <path d="M126 113c4-4 10-4 14 0" stroke="#3a2219" stroke-width="2.8" fill="none" stroke-linecap="round"/>
    <!-- smile lines (forty-ish) -->
    <path d="M97 117c-2 1-3 3-3 5" stroke="#c98f6e" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M144 117c2 1 3 3 3 5" stroke="#c98f6e" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <!-- nose -->
    <path d="M121 116c-2 8-4 12-1 14 2 1 4 1 6 0" stroke="#c98f6e" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- cheeks -->
    <ellipse cx="102" cy="129" rx="7" ry="4.5" fill="#e59a86" opacity=".45"/><ellipse cx="140" cy="129" rx="7" ry="4.5" fill="#e59a86" opacity=".45"/>
    <!-- smile -->
    <path d="M107 138c8 8 20 8 28 0" stroke="#9a3f35" stroke-width="3" fill="#fff" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M128 141c3-1 5-2 7-4" stroke="#b98066" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".6"/>
    <!-- Hjerterum's badge: the chair's own logo file (logo.ts) - never a drawn one -->
    <circle cx="160" cy="206" r="20" fill="#b5654a" stroke="#f3e7d8" stroke-width="3"/>
    <image href="data:image/png;base64,${LOGO_WHITE_PNG}" x="146" y="192" width="28" height="28"/>
  </g>
</svg>`;

export function jewelResponse(): Response {
  return new Response(JEWEL_SVG, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}
