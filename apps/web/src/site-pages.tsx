import { useEffect, type ReactNode } from "react";
import { renderMarkdown } from "../site/markdown";
import { CIRKLER_URL, NAV, NEWSLETTER_ACTION, NEWSLETTER_HONEYPOT, SITE_PAGES, TEACHERS, type Section, type SitePage } from "../site/pages";
import { LysArt } from "./lys";

/** The public website in Hjerterum Lys (site/pages.ts): the homepage modelled on hjerterum.info ("En forside som denne
 * er nu blevet rigtig fin") and one view for every content page. Live parts (calendar, plans, price calculator,
 * visit cards) come from main.tsx as `widgets`, placed where a page's text says "{{name}}". */

export type Widgets = Partial<Record<string, ReactNode>>;

export function SiteNav({ current }: { current?: Section | undefined }) {
  return <nav className="lys-nav site-nav" aria-label="Hovednavigation">
    {NAV.map(item => <a key={item.href} href={item.href} aria-current={current === item.section ? "page" : undefined}>{item.label}</a>)}
  </nav>;
}

export function Newsletter({ lang = "da" }: { lang?: "da" | "en" }) {
  const en = lang === "en";
  return <form className="site-newsletter" action={NEWSLETTER_ACTION} method="post" target="_blank">
    <div>
      <p className="lys-kicker">{en ? "Newsletter" : "Nyhedsbrev"}</p>
      <h3>{en ? "Stay in touch" : "Hold dig opdateret"}</h3>
      <p>{en ? "News about events and life at Hjerterum, a few times a year." : "Nyt om events og livet i Hjerterum – et par gange om året."}</p>
    </div>
    <div className="site-newsletter-fields">
      <label>{en ? "First name" : "Navn"}<input name="FNAME" autoComplete="given-name" /></label>
      <label>{en ? "Email" : "E-mail"}<input type="email" name="EMAIL" required autoComplete="email" /></label>
      <div aria-hidden="true" className="site-honeypot"><input type="text" name={NEWSLETTER_HONEYPOT} tabIndex={-1} defaultValue="" /></div>
      <button className="lys-btn" type="submit">{en ? "Subscribe" : "Tilmeld"}</button>
    </div>
  </form>;
}

export function Teachers() {
  return <div className="site-teachers">
    {TEACHERS.map(teacher => <article key={teacher.name} className="site-teacher">
      <img src={teacher.image} alt={teacher.name} loading="lazy" width="160" height="160" />
      <h3>{teacher.url ? <a href={teacher.url} target="_blank" rel="noopener noreferrer">{teacher.name}</a> : teacher.name}</h3>
      {teacher.focus && <p>{teacher.focus}</p>}
    </article>)}
  </div>;
}

export function SiteFooter() {
  return <footer className="site-foot">
    <div className="site-foot-brand">
      <b>Hjerterum</b>
      <p>Et varmt rum for nærvær, oplevelser og fællesskab – skabt af medlemmer for medlemmer.</p>
      <p>Guldsmedgade 26B, st., 8000 Aarhus C<br /><a href="mailto:hjerterum@holistisk.org">hjerterum@holistisk.org</a></p>
    </div>
    <nav aria-label="Sidefod">
      {NAV.map(item => <a key={item.href} href={item.href}>{item.label}</a>)}
      <a href="/om-os/foreningen">Foreningen</a>
      <a href="/privatliv">Privatliv</a>
      <a href="/sign-in">Log ind</a>
    </nav>
    <p className="site-foot-legal">© {new Date().getFullYear()} Hjerterum F.M.B.A. · CVR 40827692 · Et fællesskab baseret på nærvær.</p>
  </footer>;
}

function useDocumentMeta(title: string, description: string, lang: string) {
  useEffect(() => {
    document.title = title;
    document.documentElement.lang = lang;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "description"; document.head.appendChild(meta); }
    meta.content = description;
  }, [title, description, lang]);
}

const pageAt = (path: string) => SITE_PAGES.find(page => page.path === path);

function Cards({ paths }: { paths: string[] }) {
  return <div className="site-cards">
    {paths.map(path => pageAt(path)).filter((page): page is SitePage => !!page).map(page =>
      <a key={page.path} className="lys-card site-card" href={page.path}>
        <p className="lys-kicker">{page.kicker.split(" · ")[0]}</p>
        <h2>{page.card.title}</h2>
        <p className="lys-sub">{page.card.text}</p>
        <span className="lys-link">{page.lang === "en" ? "Read more →" : "Læs mere →"}</span>
      </a>)}
  </div>;
}

export function SitePageView({ page, header, widgets }: { page: SitePage; header: ReactNode; widgets: Widgets }) {
  useDocumentMeta(`${page.card.title} · Hjerterum`, page.description, page.lang);
  useEffect(() => {
    // An old address arrives with "#anchor": scroll there once the page is drawn.
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, [page.path]);
  const parent = SITE_PAGES.find(candidate => candidate.children?.includes(page.path) && candidate.section === page.section);
  const parts = page.body.split(/^\{\{([a-z-]+)\}\}$/m);
  return <main className="page-shell site-page">
    {header}
    <section className="lys-intro site-intro">
      <div className="lys-rise">
        {parent && <a className="site-back" href={parent.path}>← {parent.card.title}</a>}
        <p className="lys-kicker">{page.kicker}</p>
        <h1 className="lys-title">{page.title}{page.em && <em>{page.em}</em>}</h1>
      </div>
      <div className="site-intro-side lys-rise d2">
        {page.image && <img className="site-intro-image" src={page.image.src} alt={page.image.alt} />}
        <p>{page.lead}</p>
      </div>
    </section>
    <div className="site-body">
      {parts.map((part, index) => index % 2
        ? <div key={index} className={`site-widget site-widget-${part}`}>{part === "teachers" ? <Teachers /> : part === "newsletter" ? <Newsletter lang={page.lang} /> : widgets[part]}</div>
        : part.trim() && <div key={index} className="site-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(part) }} />)}
    </div>
    {page.gallery && <section className="site-gallery" aria-label={page.gallery.title}>
      <h2>{page.gallery.title}</h2>
      <div>{page.gallery.pictures.map(picture => <img key={picture.src} src={picture.src} alt={picture.alt} loading="lazy" />)}</div>
    </section>}
    {page.children && <section className="site-more" aria-label={page.lang === "en" ? "More" : "Læs videre"}>
      <p className="lys-kicker">{page.lang === "en" ? "More" : "Læs videre"}</p>
      <Cards paths={page.children} />
    </section>}
    <SiteFooter />
  </main>;
}

const CATEGORIES = [
  { label: "Events", icon: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" },
  { label: "Foredrag", icon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" },
  { label: "Koncerter", icon: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" },
  { label: "Café", icon: "M4 8h13v5a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V8zM17 9h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3" },
  { label: "Filmaftener", icon: "M4 6h16v12H4zM4 10h16M8 6l2 4M13 6l2 4" }
];

/** hjerterum.info's front page, in Lys: the welcome with the living geometry and what is about to happen, the
 * kinds of evenings, the calendar, membership, CIRKLER, and "Mere nærvær. Mindre støj." with the ways in. */
export function SiteHome({ header, soon, events, plans }: { header: ReactNode; soon: ReactNode; events: ReactNode; plans: ReactNode }) {
  useDocumentMeta("Hjerterum – nærvær, oplevelser og fællesskab i Aarhus", "Hjerterum er et varmt fællesskab i Aarhus med events, fordybelse og oplevelser – skabt af medlemmer for medlemmer.", "da");
  return <main className="page-shell site-home">
    {header}
    <section className="lys-hero">
      <div>
        <p className="lys-kicker lys-rise">Et rum for det menneskelige</p>
        <h1 className="lys-title site-home-title lys-rise d2">Oplevelser<br />for medlemmer<em><span>af</span> medlemmer</em></h1>
        <p className="lys-hero-lead lys-rise d3">Hjerterum er et varmt fællesskab for dig, der søger fordybelse, nye perspektiver og oplevelser med andre mennesker. Her er plads til både nysgerrighed, ro og det, der ikke kan planlægges.</p>
        <p className="lys-hero-actions lys-rise d4"><a className="lys-btn" href="/events">Se kalenderen</a><a className="lys-btn ghost" href="/medlemskab">Bliv medlem</a></p>
      </div>
      <div className="lys-hero-art"><LysArt />{soon}</div>
    </section>
    <nav className="site-categories" aria-label="Det sker i Hjerterum">
      {CATEGORIES.map(category => <a key={category.label} href="/events"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d={category.icon} /></svg></span>{category.label}</a>)}
    </nav>
    <section className="site-home-section">
      <div className="site-section-head"><div><p className="lys-kicker">Kalender</p><h2>De næste events i Hjerterum</h2></div><a className="lys-link" href="/events">Hele kalenderen →</a></div>
      {events}
    </section>
    <section className="site-home-section" id="medlemskab">
      <div className="site-section-head"><div><p className="lys-kicker">Medlemskab</p><h2>Bliv en del af Hjerterum</h2><p>Vælg det medlemskab, der passer til dig – og få adgang til et fællesskab baseret på nærvær og menneskelig varme.</p></div><a className="lys-link" href="/medlemskab">Fordele og vilkår →</a></div>
      {plans}
    </section>
    <section className="site-cirkler">
      <p className="lys-kicker">Et selvstændigt fællesskab</p>
      <h2>CIRKLER</h2>
      <p>Har du lyst til mere nærvær og fordybelse med andre? CIRKLER er et selvstændigt fællesskabstilbud, hvor mennesker mødes i mindre rum med plads til samtale, refleksion og ægte kontakt.</p>
      <a className="lys-btn" href={CIRKLER_URL} target="_blank" rel="noopener noreferrer">Læs om CIRKLER ↗</a>
    </section>
    <section className="site-home-section site-vision">
      <div className="lys-intro">
        <div><p className="lys-kicker">Vision / om os</p><h2 className="lys-title">Mere nærvær.<em>Mindre støj.</em></h2></div>
        <p>Hjerterum er skabt omkring troen på, at de bedste oplevelser vokser frem, når mennesker mødes med åbenhed og tid. Vi samler foredrag, behandlinger, musik, samtaler og små pauser i hverdagen – i et rum, hvor man må komme, som man er.</p>
      </div>
      <Cards paths={["/behandling", "/behandlere", "/lej-hjerterum", "/om-os", "/kontakt", "/en"]} />
    </section>
    <Newsletter />
    <SiteFooter />
  </main>;
}
