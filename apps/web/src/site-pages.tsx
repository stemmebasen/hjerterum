import { useEffect, type ReactNode } from "react";
import { membershipPlans } from "../membership";
import { renderMarkdown } from "../site/markdown";
import { CIRKLER_URL, ENGLISH, LEGAL_LINKS, NAV, NEWSLETTER_ACTION, NEWSLETTER_HONEYPOT, SITE_PAGES, BOARD, BOARD_PHOTO, BENEFITS, ABOUT_WORDS, type Section, type SitePage } from "../site/pages";
import { EnquiryForm } from "./enquiry-form";

/** The public website in Hjerterum Lys (site/pages.ts): the homepage modelled on hjerterum.info ("En forside som denne
 * er nu blevet rigtig fin") and one view for every content page. Live parts (calendar, plans, price calculator,
 * visit cards) come from main.tsx as `widgets`, placed where a page's text says "{{name}}". */

export type Widgets = Partial<Record<string, ReactNode>>;

/** A section's own pages, two levels deep: its groups (Booking & leje …) and the pages in each. */
function sectionTree(href: string): { root: SitePage; groups: Array<{ page: SitePage; pages: SitePage[] }> } | null {
  const root = pageAt(href);
  if (!root) return null;
  const groups = (root.children ?? []).map(pageAt).filter((page): page is SitePage => !!page)
    .map(page => ({ page, pages: (page.children ?? []).map(pageAt).filter((child): child is SitePage => !!child) }));
  return { root, groups };
}

const menuTitle = (page: SitePage) => page.menu ?? page.card.title;

export function SiteNav({ current, open = false }: { current?: Section | undefined; open?: boolean }) {
  return <nav id="site-menu" className={"lys-nav site-nav" + (open ? " is-open" : "")} aria-label="Hovednavigation">
    {NAV.map(item => {
      const link = <a key={item.href} href={item.href} aria-current={current === item.section ? "page" : undefined}>{item.label}</a>;
      const tree = item.sub ? sectionTree(item.href) : null;
      if (!tree) return link;
      // Under Brug Hjerterum: its groups and their pages; under Om Hjerterum, whose pages have none of their own, a plain list. Opened by pointing at or tabbing to the item.
      const list = tree.groups.every(group => !group.pages.length);
      return <div key={item.href} className="site-nav-item">
        {link}
        <div className={"site-sub" + (list ? " is-list" : "")} role="group" aria-label={item.label}>
          <a className="site-sub-head" href={tree.root.path}>{menuTitle(tree.root)}</a>
          {list ? tree.groups.map(group => <a key={group.page.path} href={group.page.path}>{menuTitle(group.page)}</a>)
            : tree.groups.map(group => <div key={group.page.path} className="site-sub-group">
              <a className="site-sub-head" href={group.page.path}>{menuTitle(group.page)}</a>
              {group.pages.map(page => <a key={page.path} href={page.path}>{menuTitle(page)}</a>)}
            </div>)}
        </div>
      </div>;
    })}
  </nav>;
}

/** The section's groups as tabs at the top of each of its pages (Gitta's "fane-orden"). */
function SectionTabs({ page }: { page: SitePage }) {
  const item = NAV.find(entry => entry.sub && entry.section === page.section);
  const tree = item && sectionTree(item.href);
  if (!tree) return null;
  const tabs = [tree.root, ...tree.groups.map(group => group.page)];
  const here = tabs.find(tab => tab.path === page.path) ?? tree.groups.find(group => group.pages.some(child => child.path === page.path))?.page;
  // The legal pages share Om Hjerterum's section without being in its menu.
  if (!here) return null;
  return <nav className="site-tabs" aria-label={item.label}>
    {tabs.map(tab => <a key={tab.path} href={tab.path} aria-current={tab === here ? "page" : undefined}>{menuTitle(tab)}</a>)}
  </nav>;
}

/** "EN" beside Log ind instead of "English" in the menu. */
export function LanguageSwitch() {
  return <a className="site-lang" href={ENGLISH.href} lang="en" hrefLang="en" title={ENGLISH.title} aria-label={ENGLISH.title}>{ENGLISH.label}</a>;
}

/** The build's version and commit, set by vite.config.ts. */
export const BUILD = { version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "", commit: typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "" };

/** The legal line under every page, on the website and the member site. */
export function LegalLine() {
  return <p className="site-foot-legal">
    {LEGAL_LINKS.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
    <span>© {new Date().getFullYear()} Hjerterum F.M.B.A. · CVR 40827692</span>
    {BUILD.version && <span className="site-version">v{BUILD.version}{BUILD.commit ? ` · ${BUILD.commit}` : ""}</span>}
  </p>;
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

/** The board, as on Om Hjerterum and Teamet: the photo and a card for each (site/pages.ts BOARD). */
export function Board() {
  return <div className="site-board">
    <figure className="site-board-photo"><img src={BOARD_PHOTO.src} alt={BOARD_PHOTO.alt} loading="lazy" /><figcaption>{BOARD_PHOTO.caption}</figcaption></figure>
    <div className="site-board-cards">{BOARD.map(person => <article key={person.name} className="site-board-card">
      <p className="lys-kicker">{person.role}</p><h3>{person.name}</h3><p className="site-board-hours">{person.hours}</p><p>{person.tasks}</p>
    </article>)}</div>
  </div>;
}

/** Requested: "Kom med forslag til CTA til booking, så man enten kan booke A med det samme via formular, ELLER logge ind og booke B og C" - "Ja". */
export function BookingChoice() {
  return <div className="booking-choice">
    <article className="booking-choice-card">
      <p className="lys-kicker">A) Standardpris</p>
      <h3>Book salen med det samme</h3>
      <p>For alle. Fast pris efter længde – fra 720 kr. for 2 timer.</p>
      <a className="lys-btn" href="/beregner">Book med formularen</a>
    </article>
    <article className="booking-choice-card members">
      <p className="lys-kicker">B) Reduceret pris · C) Gratis leje</p>
      <h3>Er du medlem? Book med medlemsrabat</h3>
      <p>Du opretter selv dit event på medlemssiden – Saga hjælper dig.</p>
      <a className="lys-btn" href="https://medlem.hjerterum.info/member-portal/events">Log ind og opret dit event</a>
      <a className="lys-link" href="/medlemskab">Ikke medlem endnu? Bliv medlem →</a>
    </article>
  </div>;
}

export function SiteFooter() {
  return <footer className="site-foot">
    <div className="site-foot-brand">
      <b>Hjerterum</b>
      {/* Requested: "Kan du finde et sted til linjen: Autentisk er det nye cool" - the house's motto, under the name on every page. */}
      <p className="site-motto">Autentisk er det nye cool</p>
      <p>Et varmt rum for nærvær, oplevelser og fællesskab – skabt af medlemmer for medlemmer.</p>
      <p>Guldsmedgade 26B, st., 8000 Aarhus C<br /><a href="mailto:hjerterum@holistisk.org">hjerterum@holistisk.org</a></p>
    </div>
    <nav aria-label="Sidefod">
      {NAV.map(item => <a key={item.href} href={item.href}>{item.label}</a>)}
      <a href="/om-os/foreningen">Foreningen</a>
      <a href={ENGLISH.href} lang="en">{ENGLISH.title}</a>
      <a href="/sign-in">Log ind</a>
    </nav>
    <LegalLine />
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

/** A page's headline and text with its live parts - on the website and, for Om Hjerterum, in the member area too. */
function body(page: SitePage, parts: string[], widgets: Widgets) {
  return <div className={"site-body" + (page.article ? " is-article" : "")}>
    {parts.map((part, index) => index % 2
      ? <div key={index} className={`site-widget site-widget-${part}`}>{part === "board" ? <Board /> : part === "booking-choice" ? <BookingChoice /> : part === "newsletter" ? <Newsletter lang={page.lang} />
        : part.startsWith("enquiry-") ? <EnquiryForm topic={part.slice("enquiry-".length)} lang={page.lang} /> : widgets[part]}</div>
      : part.trim() && <div key={index} className="site-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(part) }} />)}
  </div>;
}

export function SitePageInner({ page, widgets, parent }: { page: SitePage; widgets: Widgets; parent?: SitePage | undefined }) {
  const parts = page.body.split(/^\{\{([a-z-]+)\}\}$/m);
  // Reported (Gitta): on the "Om at bruge Hjerterum" pages the line on the right "ser ud til at høre til i venstre side" - there it goes under the headline.
  const leadUnder = Boolean(page.image || page.article || page.section === "lej");
  // Requested: the words beside the headline "bør vertikalt centreres mellem h1'erens øverste og nederste kant" - the headline and the words share a row.
  if (!leadUnder) return <>
    <section className="site-intro site-intro-row">
      {parent && <a className="site-back" href={parent.path}>← {NAV.find(item => item.href === parent.path)?.label ?? parent.card.title}</a>}
      <p className="lys-kicker">{page.kicker}</p>
      <div className="site-intro-head">
        <h1 className="lys-title">{page.title}{page.em && <em>{page.em}</em>}</h1>
        <p className="site-intro-aside">{page.lead}</p>
      </div>
    </section>
    {body(page, parts, widgets)}
  </>;
  return <>
    <section className={"lys-intro site-intro" + (page.article ? " is-article" : "")}>
        <div>
          {parent && <a className="site-back" href={parent.path}>← {NAV.find(item => item.href === parent.path)?.label ?? parent.card.title}</a>}
          <p className="lys-kicker">{page.kicker}</p>
          <h1 className="lys-title">{page.title}{page.em && <em>{page.em}</em>}</h1>
          {/* Asked (screenshot of /medlemskab): "Is this layout intended?" - with a picture, the words go under the headline and the picture
              stands alone beside them, so neither column is left half empty. A long text keeps its words under the headline too. */}
          {leadUnder && <p className="site-intro-lead">{page.lead}</p>}
        </div>
        {!page.article && (page.image || !leadUnder) && <div className="site-intro-side">
          {page.image ? <img className="site-intro-image" src={page.image.src} alt={page.image.alt} /> : <p>{page.lead}</p>}
        </div>}
      </section>
      {body(page, parts, widgets)}
  </>;
}

export function SitePageView({ page, header, widgets }: { page: SitePage; header: ReactNode; widgets: Widgets }) {
  useDocumentMeta(`${page.card.title} · Hjerterum`, page.description, page.lang);
  useEffect(() => {
    // An old address arrives with "#anchor": scroll there once the page is drawn.
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, [page.path]);
  const parent = SITE_PAGES.find(candidate => candidate.children?.includes(page.path) && candidate.section === page.section);
  return <main className="page-shell site-page">
    {header}
    <SectionTabs page={page} />
    <SitePageInner page={page} widgets={widgets} parent={parent} />
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
  { key: null, label: "Events", href: "/events", icon: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" },
  { key: "foredrag", label: "Foredrag", href: "/events?vis=foredrag", icon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" },
  { key: "koncerter", label: "Koncerter", href: "/events?vis=koncerter", icon: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" },
  { key: "cafe", label: "Café", href: "/events?vis=cafe", icon: "M4 8h13v5a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V8zM17 9h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3" },
  { key: "film", label: "Filmaftener", href: "/events?vis=film", icon: "M4 6h16v12H4zM4 10h16M8 6l2 4M13 6l2 4" }
];

/** The kinds of evenings as round icons. Requested: "Knappelayoutet bør være det samme på forsiden som på /events?vis=koncerter - på
 * undersiderne bare lidt mindre. Husk at markere den kategori der er valgt." On the front page nothing is chosen; in the calendar the chosen
 * kind is marked (current: its key, or null for all events). */
export function CategoryNav({ current }: { current?: string | null }) {
  const inCalendar = current !== undefined;
  return <nav className={"site-categories" + (inCalendar ? " is-compact" : "")} aria-label={inCalendar ? "Vis kun" : "Det sker i Hjerterum"}>
    {CATEGORIES.map(category => <a key={category.label} href={category.href} aria-current={inCalendar && category.key === current ? "page" : undefined}>
      <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d={category.icon} /></svg></span>{inCalendar && category.key === null ? "Alle" : category.label}</a>)}
  </nav>;
}

/** hjerterum.info's front page, in Lys: the welcome with the living geometry and what is about to happen, the
 * kinds of evenings, the calendar, membership, CIRKLER, and "Mere nærvær. Mindre støj." with the ways in. */
/** Requested: "just take the design of the heading, the fonts, and the colors from the PDF and adapt that to our website" - "Ja den er godt".
 * The house's own words in the newsletter's heading: a wide-spaced kicker, Playfair with the italic "af", the camel rule, square dark buttons -
 * and the hall itself beside it, bleeding to the edge with the camel stripe. */
function SiteHero({ coming }: { coming?: ReactNode }) {
  return <section className="nl-hero">
    <div className="nl-hero-text">
      <p className="lys-kicker">Hjerterum · Aarhus</p>
      <h1 className="nl-tagline">Oplevelser<br />for medlemmer<em><span>af</span> medlemmer</em></h1>
      <span className="nl-rule" aria-hidden="true" />
      <p className="nl-lead">Et varmt fællesskab for fordybelse, nye perspektiver og oplevelser med andre mennesker.</p>
      <p className="lys-kicker nl-motto">Et rum for det menneskelige</p>
      <p className="lys-hero-actions"><a className="lys-btn" href="/events">Se hele kalenderen</a><a className="lys-btn ghost" href="/medlemskab">Bliv medlem</a></p>
    </div>
    <div className="nl-hero-img"><img src="/media/2026-10-hjerterum-venstre.webp" alt="Øjeblikke fra Hjerterum: lydhealing med tromme, afspænding på måtter og en stund ved bogreolen" />{coming}</div>
  </section>;
}

export function SiteHome({ header, month, plans, coming }: { header: ReactNode; month: ReactNode; plans: ReactNode; coming?: ReactNode }) {
  useDocumentMeta("Hjerterum – nærvær, oplevelser og fællesskab i Aarhus", ABOUT_WORDS.tagline.replace(/\s*♥️$/, ""), "da");
  return <main className="page-shell site-home">
    {header}
    <SiteHero coming={coming} />
    <CategoryNav />
    <p className="site-kinds">{ABOUT_WORDS.kinds}</p>
    {/* "Oktober i Hjerterum" - the month as in the newsletter (month-hero.tsx); "Se hele kalenderen" under the events. */}
    {month}
    <section className="site-home-section" id="medlemskab">
      <div className="site-section-head"><div><p className="lys-kicker">Medlemskab</p><h2>Bliv en del af Hjerterum</h2><p>{BENEFITS.front}</p><p className="site-price-line">{ABOUT_WORDS.membership(membershipPlans.standard.month / 100)}</p></div><a className="lys-link" href="/medlemskab">Fordele og vilkår →</a></div>
      {plans}
    </section>
    <section className="site-home-section site-use">
      <div className="site-section-head"><div><p className="lys-kicker">Vil du selv bruge Hjerterum?</p><h2>Lej salen til dit event</h2><p>{ABOUT_WORDS.teachers}</p></div><a className="lys-link" href="/brug-hjerterum">Brug Hjerterum →</a></div>
      <BookingChoice />
    </section>
    <section className="site-cirkler">
      <p className="lys-kicker">Et selvstændigt fællesskab</p>
      <h2>CIRKLER</h2>
      <p>Kom med i CIRKLER. Små, faste grupper, hvor mennesker mødes regelmæssigt og lærer hinanden rigtigt at kende.</p>
      <a className="lys-btn" href={CIRKLER_URL} target="_blank" rel="noopener noreferrer">Læs om CIRKLER ↗</a>
    </section>
    <section className="site-home-section site-vision">
      <div className="lys-intro">
        <div><p className="lys-kicker">Om Hjerterum</p><h2 className="lys-title">Mere nærvær.<em>Mindre støj.</em></h2></div>
        <div><p>{ABOUT_WORDS.intro}</p><p>{ABOUT_WORDS.welcome}</p></div>
      </div>
      <Cards paths={["/behandlere", "/brug-hjerterum", "/om-os", "/kontakt", "/en"]} />
    </section>
    <Newsletter />
    <SiteFooter />
  </main>;
}
