import { membershipPlans, membershipPrice } from "../membership";

export function MembershipPlans() {
  return (
    <section className="content-section" aria-label="Medlemstyper">
      <div className="section-intro">
        <p className="kicker">Medlemskab</p>
        <h2>Vælg dit medlemskab</h2>
        <p>Standard, Generøst og Reduceret pris giver adgang til medlemsfordelene. Support er for dig, der ønsker at støtte Hjerterum uden medlemsfordele.</p>
        <a className="text-link" href="https://holistisk.org/fordele-ved-medlemskab/" target="_blank" rel="noreferrer">Se den fulde liste over fordele →</a>
      </div>
      <div className="workspace-cards">
        {Object.entries(membershipPlans).map(([id, plan]) => (
          <article className="workspace-card" key={id}>
            <h3>{plan.name}</h3>
            <p><strong>{membershipPrice(plan.month)}</strong> pr. måned eller <strong>{membershipPrice(plan.year)}</strong> pr. år</p>
            <p>Spar {membershipPrice(plan.month * 12 - plan.year)} med årlig betaling.</p>
            <p>{plan.description}</p>
          </article>
        ))}
      </div>
      <p>Betaling er endnu ikke aktiveret på den nye platform. Kontakt os, hvis du har spørgsmål om medlemskab.</p>
    </section>
  );
}
