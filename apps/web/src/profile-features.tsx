import { useState } from "react";

export function ProfileFeatures({ fullName }: { fullName: string }) {
  const [section, setSection] = useState<"overview" | "public" | "cirkler">("overview");
  const [preview, setPreview] = useState(false);
  const [name, setName] = useState(fullName);
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [topics, setTopics] = useState("");
  const [teaching, setTeaching] = useState(false);
  const [treatment, setTreatment] = useState(false);

  if (section === "public") return <section className="profile-editor" aria-label="Mit offentlige visitkort">
    <button className="text-button" onClick={() => { setSection("overview"); setPreview(false); }}>← Tilbage til min profil</button>
    <p className="kicker">Underviser & behandler</p>
    <h2>{preview ? "Sådan ser besøgende dig" : "Lad folk møde dig"}</h2>
    <p>Prøv dit offentlige visitkort. Forhåndsvisningen gemmes ikke endnu, og intet bliver offentliggjort.</p>
    {preview ? <article className="profile-preview">
      <div className="profile-portrait" aria-label="Plads til portrætfoto">{name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("") || "?"}</div>
      <div><h3>{name || "Dit navn"}</h3><p>{title || "Din faglige titel"}</p>
        <p className="profile-badge">{[teaching && "Undervisning", treatment && "Behandling"].filter(Boolean).join(" · ") || "Dit tilbud"}</p>
        <p>{bio || "Din korte præsentation vises her."}</p><p>{topics}</p>
      </div>
    </article> : <div className="workspace-form">
      <div className="workspace-form-row">
        <label>Navn på visitkortet<input value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>
        <label>Faglig titel<input placeholder="Fx yogalærer og kropsterapeut" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} /></label>
      </div>
      <fieldset className="profile-roles"><legend>Jeg tilbyder</legend>
        <label><input type="checkbox" checked={teaching} onChange={e => setTeaching(e.target.checked)} /> Undervisning</label>
        <label><input type="checkbox" checked={treatment} onChange={e => setTreatment(e.target.checked)} /> Behandling</label>
      </fieldset>
      <label>Kort præsentation<textarea rows={4} value={bio} onChange={e => setBio(e.target.value)} maxLength={600} /></label>
      <label>Specialer<input placeholder="Fx yoga · kropsterapi · nærvær" value={topics} onChange={e => setTopics(e.target.value)} maxLength={160} /></label>
    </div>}
    <p className="profile-note">Kun det, du vælger til visitkortet, skal vises på hjemmesiden. Din private adresse, medlemsbetaling og CIRKLER-profil bliver ikke en del af visitkortet.</p>
    <div className="workspace-actions"><button className="pill-button dark" onClick={() => setPreview(!preview)}>{preview ? "Redigér visitkortet" : "Se forhåndsvisning →"}</button><span className="profile-badge">Offentliggørelse kommer senere</span></div>
  </section>;

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
        <div className="profile-card-top"><span className="profile-emblem" aria-hidden="true">Aa</span><span className="profile-badge">Ikke offentlig</span></div>
        <p className="kicker">Underviser & behandler</p><h2>Min offentlige profil</h2>
        <p>Vis, hvem du er, og hvad du tilbyder. Dit visitkort bliver en del af oversigten over undervisere og behandlere på hjemmesiden.</p>
        <p className="profile-scope">Kun de oplysninger, du vælger til visitkortet, bliver offentlige.</p>
        <button className="pill-button dark" onClick={() => setSection("public")}>Prøv mit visitkort</button>
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
