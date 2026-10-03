import { useEffect, type ReactNode } from "react";
import content from "./legacy-content.json";

export type LegacyContent = { title: string; source: string; html: string };
const pages: Record<string, LegacyContent> = content;
const aliases: Record<string, string> = { "/praktisk-information": "/guidelines-for-undervisere", "/book-dit-event": "/lejepriser", "/book-your-event": "/price-list" };
export function legacyPage(path: string): LegacyContent | undefined { return pages[aliases[path] ?? path]; }
const roomLinks = [
  ["Om vores sal", "/brug-centret"], ["Lej sal", "/lejepriser"], ["Praktisk information", "/guidelines-for-undervisere"],
  ["Vilkår for leje", "/betingelser-for-leje-af-sal"], ["Administrer dine events", "/administrer-dine-events"], ["Markedsføring", "/markedsforing"]
];
const groups = [
  {title:"Events", links:[["Kalender","/events"],["Hjerterum Open","/nye-community-events-hjerterum-events"]]},
  {title:"Medlemskab", links:[["Bliv medlem","/bliv-medlem"],["Fordele","/fordele-ved-medlemskab"],["Vilkår","/medlemskabs-betingelser"]]},
  {title:"Sal", links:roomLinks},
  {title:"Om os", links:[["Hvad er Hjerterum?","/vision"],["Teamet bag","/teamet"],["Faste undervisere","/faste-laerere-regular-teachers"],["Historien","/historien-bag-hjerterum"],["Nyhedsbrev","/nyhedsbrev"],["Generalforsamling og møder","/generalforsamling-general-assembly"],["Donation","/donationer"],["Hjerterum Tribes","/tribes"]]},
  {title:"English", links:[["Welcome","/welcome"],["Events","/events-en"],["About us","/vision-en"],["The team","/team"],["Membership","/become-a-member"],["Membership benefits","/benefits-of-membership"],["Membership terms","/conditions-of-membership"],["About our room","/use-hjerterum"],["Book room","/price-list"],["Practical information","/guidelines-for-teachers"],["Rental terms","/conditions-for-renting-the-room"],["Managing your event","/managing-your-event"],["Marketing your event","/marketing-of-your-event"],["Contact","/contact-us"],["Donations","/donations"]]}
];
export function PublicNavigation() {
  return <nav className="site-nav lys-nav" aria-label="Hovednavigation">
    {groups.map(group => <details key={group.title} name="public-navigation"><summary>{group.title}</summary>
      <div className="nav-dropdown">{group.links.map(([label,href])=><a key={href} href={href}>{label}</a>)}</div>
    </details>)}
    <a href="/behandlere">Behandlere</a><a href="/kontakt-os">Kontakt</a><a className="nav-login lys-pill" href="/sign-in">Log ind</a>
  </nav>;
}
// Static, allowlist-sanitised content checked into GitHub. No live WordPress HTML is executed.
export function LegacyBody({page}: {page: LegacyContent}) {
  return <div className="legacy-content" dangerouslySetInnerHTML={{__html:page.html}} />;
}
export function LegacyPage({page,path,children}: {page:LegacyContent;path:string;children?:ReactNode}) {
  useEffect(()=>{document.title=page.title+" · Hjerterum";},[page.title]);
  const room = roomLinks.some(([,href])=>href===path) || path === "/praktisk-information";
  const management = path === "/administrer-dine-events" || path === "/managing-your-event";
  return <article className="legacy-page">
    <header><p className="kicker">Hjerterum</p><h1>{page.title}</h1></header>
    {room && <nav className="legacy-related" aria-label="Sal">{roomLinks.map(([label,href])=><a href={href} key={href} aria-current={path===href?"page":undefined}>{label}</a>)}</nav>}
    {management && <p className="legacy-embed-link">Events oprettet i medlemsportalen: <a href="/member-portal/events">Administrér dine events →</a><br/>Vejledningen nedenfor gælder events på den tidligere hjemmeside.</p>}
    {children}
    <LegacyBody page={page} />
    <p className="legacy-source"><a href={page.source} target="_blank" rel="noreferrer">Se siden på holistisk.org ↗</a></p>
  </article>;
}
