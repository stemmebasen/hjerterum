import { useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { PublicProfileEditor } from "./public-profiles";
import { PrMaterialEditor } from "./pr-material-editor";
import { openCirklerHandoff } from "./cirkler-card";

export function ProfileFeatures({ fullName, clerk }: { fullName: string; clerk: ClerkBrowser }) {
  // "Del mit PR-materiale" on Mine events comes here with #pr.
  const [section, setSection] = useState<"overview" | "public" | "cirkler" | "pr">(() => typeof location !== "undefined" && location.hash === "#pr" ? "pr" : "overview");
  const [opening, setOpening] = useState(false);
  const [cirklerError, setCirklerError] = useState<string | null>(null);

  // Hjerterum laver en signeret billet og sender medlemmet videre til cirkler.net. Profilen bor kun i CIRKLER.
  async function openCirkler() {
    setOpening(true);
    setCirklerError(await openCirklerHandoff(clerk));
    setOpening(false);
  }
  if (section === "pr") return <PrMaterialEditor clerk={clerk} onBack={() => setSection("overview")} />;
  if (section === "public") return <PublicProfileEditor clerk={clerk} fullName={fullName} onBack={() => setSection("overview")} />;

  if (section === "cirkler") return <section className="profile-editor" aria-label="Min CIRKLER-profil">
    <button className="text-button" onClick={() => setSection("overview")}>← Tilbage til min profil</button>
    <p className="kicker">CIRKLER · uddybende profil</p><h2>Dit næste fællesskab</h2>
    <p>Som medlem af Hjerterum er du med i CIRKLER uden medlemsbetaling. Tryk på knappen, så åbner CIRKLERs tilmelding med dit medlemskab bekræftet. Har du allerede en CIRKLER-profil, bliver du logget direkte ind.</p>
    <ol className="profile-steps">
      <li><strong>Dine ønsker</strong><span>Hvad søger du i et fællesskab, og hvad interesserer dig?</span></li>
      <li><strong>Det praktiske</strong><span>Område, tidspunkter og det, du ønsker at fortælle os.</span></li>
      <li><strong>Gennemse og bekræft</strong><span>Se dine oplysninger, og vælg aktivt at tilmelde dig.</span></li>
    </ol>
    <p className="profile-note">Hjerterum sender dit navn, din e-mail, dit telefonnummer og en bekræftelse af dit medlemskab til CIRKLER. Din CIRKLER-profil vises ikke på Hjerterums hjemmeside.</p>
    <button className="pill-button dark" onClick={() => void openCirkler()} disabled={opening}>{opening ? "Åbner CIRKLER …" : "Tilmeld dig eller åbn CIRKLER"}</button>
    {cirklerError && <p className="profile-note" role="alert">{cirklerError}</p>}
  </section>;

  return <>
    <div className="profile-feature-grid">
      <section className="profile-feature-card" aria-label="Offentlig underviser- og behandlerprofil">
        <div className="profile-card-top"><span className="profile-emblem" aria-hidden="true">Aa</span><span className="profile-badge">Du vælger synligheden</span></div>
        <p className="kicker">Underviser & behandler</p><h2>Min offentlige profil</h2>
        <p>Vis, hvem du er, og hvad du tilbyder. Dit visitkort bliver en del af oversigten over undervisere og behandlere på hjemmesiden.</p>
        <p className="profile-scope">Kun de oplysninger, du vælger til visitkortet, bliver offentlige.</p>
        <button className="pill-button dark" onClick={() => setSection("public")}>Åbn mit visitkort</button>
      </section>
      {/* Requested (Gitta): "At de udtrykkeligt bliver opfordret til at dele minimun 3 billeder ... til PR" - with "vi kan ikke reklamere for dem uden". */}
      <section className="profile-feature-card" aria-label="PR-materiale til undervisere">
        <div className="profile-card-top"><span className="profile-emblem" aria-hidden="true">✦</span><span className="profile-badge">For undervisere</span></div>
        <p className="kicker">Billeder, citater og samtykke</p><h2>Mit PR-materiale</h2>
        <p>Vil du have hjælp til at fylde dine events? Del mindst 3 billeder og et par citater, så kan vi reklamere for dig på Instagram, Facebook og i nyhedsbrevet.</p>
        <p className="profile-scope">Uden billeder og samtykke kan vi ikke lave opslag om dine events.</p>
        <button className="pill-button dark" onClick={() => setSection("pr")}>Åbn mit PR-materiale</button>
      </section>
      <section className="profile-feature-card" aria-label="CIRKLER-profil og tilmelding">
        <div className="profile-card-top"><span className="profile-emblem profile-emblem-cirkler" aria-hidden="true"><span className="cirkler-logo-mark" /></span><span className="profile-badge">Gratis for medlemmer</span></div>
        <p className="kicker">Små, faste fællesskaber</p><h2>Min CIRKLER-profil</h2>
        <p>Fortæl om dine ønsker og det, du søger i et fællesskab. Din uddybende profil hjælper CIRKLER med at finde en passende cirkel.</p>
        <p className="profile-scope">Din CIRKLER-profil vises ikke på den offentlige hjemmeside.</p>
        <button className="pill-button dark" onClick={() => setSection("cirkler")}>Se CIRKLER-forløbet</button>
      </section>
    </div>
  </>;
}

