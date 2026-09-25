import { useState } from "react";
import type { ClerkBrowser } from "./clerk";
import { PublicProfileEditor } from "./public-profiles";

export function ProfileFeatures({ fullName, clerk }: { fullName: string; clerk: ClerkBrowser }) {
  const [section, setSection] = useState<"overview" | "public" | "cirkler">("overview");
  if (section === "public") return <PublicProfileEditor clerk={clerk} fullName={fullName} onBack={() => setSection("overview")} />;

  if (section === "cirkler") return <section className="profile-editor" aria-label="Min CIRKLER-profil">
    <button className="text-button" onClick={() => setSection("overview")}>← Tilbage til min profil</button>
    <p className="kicker">CIRKLER · uddybende profil</p><h2>Dit næste fællesskab</h2>
    <p>Tilmeldingen begynder med en særskilt CIRKLER-profil. Her fortæller du om dine ønsker, før du bekræfter din tilmelding.</p>
    <ol className="profile-steps">
      <li><strong>Dine ønsker</strong><span>Hvad søger du i et fællesskab, og hvad interesserer dig?</span></li>
      <li><strong>Det praktiske</strong><span>Område, tidspunkter og det, du ønsker at fortælle os.</span></li>
      <li><strong>Gennemse og bekræft</strong><span>Se dine oplysninger, og vælg aktivt at tilmelde dig.</span></li>
    </ol>
    <p className="profile-note">Din CIRKLER-profil vises ikke på Hjerterums offentlige hjemmeside. Tilmelding åbner ved den fælles lancering af Hjerterum og CIRKLER.</p>
    <button className="pill-button dark" disabled>Tilmelding åbner ved lancering</button>
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
      <section className="profile-feature-card" aria-label="CIRKLER-profil og tilmelding">
        <div className="profile-card-top"><span className="profile-emblem profile-emblem-cirkler" aria-hidden="true">◎</span><span className="profile-badge">Åbner ved lancering</span></div>
        <p className="kicker">Små, faste fællesskaber</p><h2>Min CIRKLER-profil</h2>
        <p>Fortæl om dine ønsker og det, du søger i et fællesskab. Din uddybende profil hjælper CIRKLER med at finde en passende cirkel.</p>
        <p className="profile-scope">Din CIRKLER-profil vises ikke på den offentlige hjemmeside.</p>
        <button className="pill-button dark" onClick={() => setSection("cirkler")}>Se CIRKLER-forløbet</button>
      </section>
    </div>
    <p className="profile-note">De to profiler er uafhængige. Du kan være med i CIRKLER uden at have en offentlig profil.</p>
  </>;
}

