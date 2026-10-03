import type { ReactNode } from "react";
import { LYS_CSS, lysArt } from "../lys";

/** Hjerterum Lys in the React pages (apps/web/lys.ts is the single source; the cockpit uses the same). */

let injected = false;
/** Puts the shared tokens, top, blocks and geometry in the page once, before the page's own styles. */
export function injectLys(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.id = "hjerterum-lys";
  style.textContent = LYS_CSS;
  document.head.prepend(style);
}

export function LysLogo() {
  return <a className="lys-logo" href="/" aria-label="Hjerterum forside"><img src="/logo.png" alt="" width="44" height="44" /><b>Hjerterum</b></a>;
}

/** The top every page shares: the logo, the page's own links, and what belongs on the right (log in, the member). */
export function LysTop({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return <header className="lys-bar"><div className="lys-top"><LysLogo />{children}{right ? <div className="lys-me">{right}</div> : null}</div></header>;
}

/** The living geometry. The markup is a constant from lys.ts - nothing from outside goes into it. */
export function LysArt({ size = "hero" }: { size?: "hero" | "mini" }) {
  return <span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: lysArt(size) }} />;
}
