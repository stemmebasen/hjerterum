import { membershipPlans, membershipPrice } from "../membership";
import { SIGNUP_URL } from "../site/pages";

/** The four memberships as on holistisk.org/bliv-medlem/ and hjerterum.info, in Hjerterum Lys. Signing up still
 * happens in the membership system on holistisk.org - where hjerterum.info sends people too - until payment runs here. */
const EN: Record<string, { name: string; description: string }> = {
  standard: { name: "Standard membership", description: "Become a member of Hjerterum and enjoy a wide range of benefits." },
  generoest: { name: "Generous membership", description: "Support Hjerterum a little extra – and help people with few means to a membership at a reduced price." },
  reduceret: { name: "Reduced price membership", description: "If your net salary is below 11,000 DKK a month (e.g. SU), you can pay a reduced fee. Please upgrade if your income rises above it." },
  support: { name: "Support membership", description: "Support Hjerterum with a small amount, without access to the member benefits." }
};

const kr = (minor: number, en: boolean) => membershipPrice(minor).replace(" kr.", en ? " DKK" : " kr.");

export function MembershipPlans({ lang = "da" }: { lang?: "da" | "en" }) {
  const en = lang === "en";
  const signup = en ? "https://holistisk.org/become-a-member/" : SIGNUP_URL;
  return <div className="site-plans" aria-label={en ? "Memberships" : "Medlemskaber"}>
    {Object.entries(membershipPlans).map(([id, plan]) => {
      const text = en ? EN[id]! : plan;
      const saving = plan.month * 12 - plan.year;
      return <article className={`site-plan plan-${id}` + (id === "standard" ? " featured" : "")} key={id}>
        {id === "standard" && <span className="site-plan-badge">{en ? "Most popular" : "Mest populær"}</span>}
        <p className="lys-kicker">{text.name.replace(/ (medlemskab|membership)$/i, "")}</p>
        <p className="site-plan-price"><b>{(plan.month / 100).toLocaleString("da-DK")}</b> {en ? "DKK/month" : "kr./md."}</p>
        <p className="site-plan-year">{en ? "or" : "eller"} {kr(plan.year, en)} {en ? "a year" : "om året"}{saving > 0 && <span> · {en ? "save" : "spar"} {kr(saving, en)}</span>}</p>
        <p className="site-plan-text">{text.description}</p>
        <a className={"lys-btn" + (id === "standard" ? "" : " ghost")} href={signup} target="_blank" rel="noopener noreferrer">
          {plan.benefits ? (en ? "Become a member" : "Bliv medlem") : (en ? "Become a supporter" : "Bliv støttemedlem")}
        </a>
      </article>;
    })}
  </div>;
}
