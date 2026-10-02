/** Requested: "Vi skal have implementeret denne prisberegner i systemet - den skal også bruges som iframe" and "Du må meget
 * gerne komme så tæt på dette design i V1: https://prisberegner.replit.app". One page: the calculator, the result and the
 * booking request; the sums come from the server (quote.ts), the request is laid in team@'s inbox (handler.ts). */

export type Lang = "da" | "en";

const TEXT = {
  da: {
    title: "Udregn pris og send bookingforespørgsel", lead: "Husk at medregne tid til klargøring og oprydning - som regel ca. 30 minutter ekstra, både før og efter eventet.",
    touch: "Berør mindst to af felterne: ugedag, starttidspunkt eller antal timer.", guide: "Start med at<br>vælge tidspunkt",
    day: "Ugedag", start: "Starttidspunkt", hours: "Antal timer", what: "Hvad vil du booke?", whatHint: "Klik på en af kasserne herunder",
    standard: "Standardpris", standardSub: "Uden medlemsrabat.", reduced: "Reduceret pris", reducedSub: "Med medlemsrabat.", free: "Gratis leje", freeSub: "Gratis for medlemmer",
    rules: "Priser og regler", unfold: "Klik for at folde ud", pickType: "Vælg en bookingtype ovenfor for at se priser og regler.", vat: "Alle priser er inkl. moms.",
    calc: "Beregn pris", lang: "English", langHref: "?lang=en",
    days: ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"],
  },
  en: {
    title: "Calculate the price and send a booking request", lead: "Remember to include time for setting up and tidying - usually about 30 minutes extra, both before and after the event.",
    touch: "Touch at least two of the fields: weekday, start time or number of hours.", guide: "Start by<br>choosing a time",
    day: "Weekday", start: "Start time", hours: "Number of hours", what: "What do you want to book?", whatHint: "Click one of the boxes below",
    standard: "Standard price", standardSub: "Without member discount.", reduced: "Reduced price", reducedSub: "With member discount.", free: "Free rent", freeSub: "Free for members",
    rules: "Prices and rules", unfold: "Click to unfold", pickType: "Choose a booking type above to see prices and rules.", vat: "All prices include VAT.",
    calc: "Calculate price", lang: "Dansk", langHref: "?lang=da",
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  },
} as const;

/** The texts the page's script needs, in both languages. */
const SCRIPT_TEXT = {
  da: {
    hoursUnit: "timer", at: "kl.", chosen: "Valgt tidspunkt:", result: "Din prisberegning", base: "Grundpris (inkl. 2 timer):", basePackage: "Pakkepris ({h} timer):",
    extra: "Ekstra timer ({n} × {r} kr.):", discount: "Kampagnerabat ({p} %):", some: "Vises på Hjerterums hjemmeside og SoMe", included: "Inkluderet", total: "Total lejepris:",
    obs: "OBS: Hele beløbet skal betales før vi starter arbejdet med dit event og lægger det online. Bemærk at grundprisen ikke kan refunderes ved senere aflysning.",
    setup: "Husk at inkludere tid til opstilling og oprydning – som regel ca. 30 minutter både før og efter dit event.",
    memberAsk: "Indtast medlemspris og se herunder<br>hvad ikke-medlemmer min. skal betale:", nonMember: "Ikke-medlemmer skal mindst betale:", advantage: "Medlemsfordel:",
    noDiscount: "Ingen medlemsrabat på lejen.", freeRent: "Lejepris:", freeMembers: "Medlemmer deltager gratis.", freeMin: "Ikke-medlemmer skal mindst betale:",
    freeTeacher: "Underviseren opkræver selv deltagerbetalingen.", freeOnly: "Gratis leje gælder kun for betalende medlemmer af Hjerterum.",
    book: "Udfyld bookingforespørgsel", again: "Ny beregning", cross: "Reduceret pris og gratis leje må ikke gå hen over kl. 18:30. Lav i stedet to bookinger: én før kl. 18:30 og én fra kl. 18:30.",
    bandA: "A-tid", bandB: "B-tid", weekend: "weekend", error: "Prisen kunne ikke beregnes lige nu. Prøv igen om lidt.",
    rules: {
      standard: "<p>Fast pakkepris efter antal timer - samme pris på hverdage og i weekenden. Ingen medlemsrabat på lejen.</p>{table}<p>Vises på Hjerterums hjemmeside og SoMe: <b>Inkluderet</b>.</p><p>Standardpris må gerne gå hen over kl. 18:30.</p>",
      reduced: "<p>Til arrangementer, hvor medlemmer får en lavere deltagerpris end ikke-medlemmer.</p><p><b>B-tid</b> (hverdage før kl. 18:30): 150 kr. for de første 2 timer + 75 kr. pr. ekstra time.</p><p><b>A-tid</b> (hverdage fra kl. 18:30 og weekender): 400 kr. for de første 2 timer + 150 kr. pr. ekstra time - med <b>25 % kampagnerabat</b> på lejen.</p><p>Bookingen må ikke gå hen over kl. 18:30 på hverdage.</p><p>Ikke-medlemmer betaler mindst medlemsprisen + forskellen herunder:</p>{diff}",
      free: "<p>Hjerterum tager 0 kr. i leje. Medlemmer deltager gratis.</p><p>Ikke-medlemmer betaler mindst <b>150 kr.</b> i A-tid og weekender og <b>75 kr.</b> i B-tid. Underviseren opkræver selv deltagerbetalingen.</p><p>Gratis leje gælder kun for betalende medlemmer, og bookingen må ikke gå hen over kl. 18:30 på hverdage.</p>",
    },
    diffHead: ["Medlemspris", "A-tid", "B-tid"],
    diffRows: [["Under 400 kr.", "+100 kr.", "+50 kr."], ["400 - under 800 kr.", "25 %, min. +100 kr.", "12,5 %, min. +50 kr."], ["800 - under 2.000 kr.", "20 %, min. +200 kr.", "10 %, min. +100 kr."],
      ["2.000 - under 4.000 kr.", "15 %, min. +400 kr.", "7,5 %, min. +200 kr."], ["4.000 kr. og derover", "10 %, min. +600 kr.", "5 %, min. +300 kr."]],
    // The booking request.
    formTitle: "Forespørgsel på booking", formLead: "Udfyld venligst formularen for at sende din forespørgsel.", eventName: "Eventnavn", date: "Dato", addDate: "Tilføj dato",
    when: "Tidspunkt og varighed", maxP: "Max. antal deltagere", payment: "Betalingsmetode", paymentChoose: "Vælg betalingsmetode",
    payments: ["Online via Hjerterum", "MobilePay", "Bankoverførsel", "Kontant", "Andet"], overview: "Prisoversigt", members: "Medlemmer", missingMember: "(Mangler medlemspris)",
    minNon: "Min. ikke-medlem pris", fillYourself: "(Udfyld selv)", description: "Beskrivelse", notes: "Bemærkninger", image: "Billede til dit event",
    imageHint: "Husk at vedhæfte et billede til dit event. Vi foretrækker ikke AI-genererede billeder, og billedet skal være uden ophavsret - alternativt skal du selv eje rettighederne. Gerne 1920 × 1005 px.",
    signup: "Hvordan skal deltagerne tilmelde sig?", signupOnline: "Online via Hjerterum", signupDirect: "Direkte til dig/underviser", contact: "Kontaktoplysninger",
    name: "Navn", email: "E-mailadresse", phone: "Telefonnummer", social: "Sociale medier / Web", add: "Tilføj", cancel: "Annuller", send: "Send forespørgsel", close: "Luk",
    sending: "Sender …", sent: "Tak! Din forespørgsel er sendt til Hjerterum. Vi vender tilbage på mail.", required: "Udfyld de felter, der er markeret med *.",
    failed: { not_delivered: "Forespørgslen kunne ikke sendes lige nu. Prøv igen om lidt, eller skriv til team@holistisk.org.", too_many: "Der er sendt mange forespørgsler herfra. Prøv igen om en time.",
      image_too_large: "Billedet er for stort (højst 8 MB).", image_type: "Billedet skal være JPG, PNG, WebP eller GIF.", missing_fields: "Udfyld de felter, der er markeret med *.", other: "Noget gik galt. Prøv igen." },
  },
  en: {
    hoursUnit: "hours", at: "at", chosen: "Chosen time:", result: "Your price", base: "Base price (incl. 2 hours):", basePackage: "Package price ({h} hours):",
    extra: "Extra hours ({n} × {r} kr.):", discount: "Campaign discount ({p} %):", some: "Shown on Hjerterum's website and social media", included: "Included", total: "Total rent:",
    obs: "Note: The full amount must be paid before we start working on your event and put it online. The base price is not refunded if the event is cancelled later.",
    setup: "Remember to include time for setting up and tidying – usually about 30 minutes both before and after your event.",
    memberAsk: "Enter the member price and see below<br>what non-members must pay at least:", nonMember: "Non-members pay at least:", advantage: "Member advantage:",
    noDiscount: "No member discount on the rent.", freeRent: "Rent:", freeMembers: "Members take part for free.", freeMin: "Non-members pay at least:",
    freeTeacher: "The teacher collects the participants' payment.", freeOnly: "Free rent is only for paying members of Hjerterum.",
    book: "Fill in the booking request", again: "New calculation", cross: "Reduced price and free rent may not run past 18:30. Make two bookings instead: one before 18:30 and one from 18:30.",
    bandA: "A time", bandB: "B time", weekend: "weekend", error: "The price could not be calculated right now. Please try again shortly.",
    rules: {
      standard: "<p>A fixed package price by number of hours - the same on weekdays and at weekends. No member discount on the rent.</p>{table}<p>Shown on Hjerterum's website and social media: <b>Included</b>.</p><p>A standard booking may run past 18:30.</p>",
      reduced: "<p>For events where members pay a lower price than non-members.</p><p><b>B time</b> (weekdays before 18:30): 150 kr. for the first 2 hours + 75 kr. per extra hour.</p><p><b>A time</b> (weekdays from 18:30 and weekends): 400 kr. for the first 2 hours + 150 kr. per extra hour - with a <b>25 % campaign discount</b> on the rent.</p><p>The booking may not run past 18:30 on weekdays.</p><p>Non-members pay at least the member price + the difference below:</p>{diff}",
      free: "<p>Hjerterum charges 0 kr. in rent. Members take part for free.</p><p>Non-members pay at least <b>150 kr.</b> in A time and at weekends and <b>75 kr.</b> in B time. The teacher collects the participants' payment.</p><p>Free rent is only for paying members, and the booking may not run past 18:30 on weekdays.</p>",
    },
    diffHead: ["Member price", "A time", "B time"],
    diffRows: [["Under 400 kr.", "+100 kr.", "+50 kr."], ["400 - under 800 kr.", "25 %, min. +100 kr.", "12.5 %, min. +50 kr."], ["800 - under 2,000 kr.", "20 %, min. +200 kr.", "10 %, min. +100 kr."],
      ["2,000 - under 4,000 kr.", "15 %, min. +400 kr.", "7.5 %, min. +200 kr."], ["4,000 kr. and above", "10 %, min. +600 kr.", "5 %, min. +300 kr."]],
    formTitle: "Booking request", formLead: "Please fill in the form to send your request.", eventName: "Event name", date: "Date", addDate: "Add date",
    when: "Time and duration", maxP: "Max. number of participants", payment: "Payment method", paymentChoose: "Choose payment method",
    payments: ["Online via Hjerterum", "MobilePay", "Bank transfer", "Cash", "Other"], overview: "Price overview", members: "Members", missingMember: "(Member price missing)",
    minNon: "Min. non-member price", fillYourself: "(Fill in yourself)", description: "Description", notes: "Notes", image: "Picture for your event",
    imageHint: "Remember to attach a picture for your event. We prefer pictures that are not AI-generated, and the picture must be free of copyright - or you must own the rights yourself. Preferably 1920 × 1005 px.",
    signup: "How should participants sign up?", signupOnline: "Online via Hjerterum", signupDirect: "Directly to you/the teacher", contact: "Contact details",
    name: "Name", email: "E-mail address", phone: "Phone number", social: "Social media / Web", add: "Add", cancel: "Cancel", send: "Send request", close: "Close",
    sending: "Sending …", sent: "Thank you! Your request has been sent to Hjerterum. We will get back to you by e-mail.", required: "Fill in the fields marked with *.",
    failed: { not_delivered: "The request could not be sent right now. Please try again shortly, or write to team@holistisk.org.", too_many: "Many requests have been sent from here. Please try again in an hour.",
      image_too_large: "The picture is too large (at most 8 MB).", image_type: "The picture must be JPG, PNG, WebP or GIF.", missing_fields: "Fill in the fields marked with *.", other: "Something went wrong. Please try again." },
  },
};

const PACKAGES: Array<[number, number]> = [[2, 720], [2.5, 900], [3, 1080], [3.5, 1230], [4, 1380], [4.5, 1530], [5, 1680], [5.5, 1800], [6, 1920], [6.5, 2040], [7, 2160], [7.5, 2250], [8, 2340], [8.5, 2430], [9, 2520], [9.5, 2610], [10, 2700]];

const icon = (path: string, size = 20, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${path}</svg>`;
const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>', arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>', check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
};

const STYLE = `
:root{--bg:#f8fafc;--card:#fff;--ink:#0f1729;--muted:#64748b;--line:#e2e8f0;--green:#13c383;--green-ink:#0f9e6a;--green-soft:#e8f8f1;--radius:12px;color-scheme:light}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:640px;margin:0 auto;padding:28px 16px 40px;position:relative}
.top{display:flex;justify-content:flex-end;margin:0 0 14px}.lang{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--ink);text-decoration:none;padding:6px 8px;border-radius:6px}.lang:hover{background:#eef2f7}
.card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px;box-shadow:0 1px 2px rgba(15,23,41,.04)}
h1{display:flex;gap:10px;align-items:flex-start;font-size:24px;line-height:1.25;letter-spacing:-.02em;margin:0;font-weight:700}h1 svg{flex:none;margin-top:3px}
.lead{margin:6px 0 20px;color:var(--muted);font-size:15px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.fields{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}label.f{display:grid;gap:8px;font-weight:700;font-size:14.5px}
select,input,textarea{font:inherit;font-size:15px;font-weight:400;color:var(--ink);background:#f8fafc;border:1px solid var(--line);border-radius:6px;padding:7px 12px;min-height:36px;width:100%}
select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:34px}
select:focus,input:focus,textarea:focus{outline:2px solid color-mix(in srgb,var(--green) 40%,transparent);border-color:var(--green)}
.stepper{display:flex;align-items:center;justify-content:space-between;min-height:36px}.stepper button{width:36px;height:36px;border:1px solid var(--ink);border-radius:6px;background:transparent;font:inherit;font-size:15px;cursor:pointer;color:var(--ink)}
.stepper button:disabled{opacity:.45;cursor:default}.stepper b{color:var(--green);font-size:20px;font-weight:700;min-width:44px;text-align:center}
.what{margin:22px 0 10px;font-weight:700;font-size:14.5px}.what span{font-weight:400;color:var(--muted);margin-left:6px}
.types{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.type{display:grid;justify-items:center;gap:4px;padding:14px 10px;border-radius:8px;border:1px solid;cursor:pointer;font:inherit;text-align:center;background:none;color:var(--ink)}
.type b{font-size:16px;font-weight:700}.type span{font-size:14px;color:var(--muted);line-height:1.35}
.type.standard{background:#eff6ff;border-color:#bfdbfe}.type.standard svg{color:#3b82f6}.type.standard[aria-pressed=true]{background:#dbeafe;border:2px solid #3b82f6;padding:13px 9px}
.type.reduced{background:#fefce8;border-color:#fde68a}.type.reduced svg{color:#d97706}.type.reduced[aria-pressed=true]{background:#fef3c7;border:2px solid #f59e0b;padding:13px 9px}
.type.free{background:#f0fdf4;border-color:#bbf7d0}.type.free svg{color:#22c55e}.type.free[aria-pressed=true]{background:#dcfce7;border:2px solid #22c55e;padding:13px 9px}
.cross{margin:10px 0 0;padding:10px 14px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:14px;font-weight:600}
details.rules{margin:16px 0 18px}details.rules summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;padding:8px 0}
details.rules summary::-webkit-details-marker{display:none}details.rules summary b{display:flex;align-items:center;gap:8px;font-size:16px;color:#334155}details.rules summary b svg{color:var(--green)}
details.rules summary span{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted)}details.rules[open] summary span svg{transform:rotate(180deg)}
.rules-body{font-size:14.5px;color:#334155;padding:4px 0 0}.rules-body p{margin:0 0 8px}.rules-body table{border-collapse:collapse;width:100%;margin:4px 0 10px;font-size:14px}
.rules-body td,.rules-body th{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left}.rules-body th{font-size:12.5px;color:var(--muted);font-weight:600}
.pk{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:4px 14px;margin:6px 0 10px}.pk div{display:flex;justify-content:space-between;font-size:14px;border-bottom:1px dashed var(--line);padding:3px 0}
.go{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;min-height:38px;border:0;border-radius:6px;background:var(--green);color:#fff;font:inherit;font-size:15px;font-weight:500;cursor:pointer}
.go:disabled{opacity:.5;cursor:default}.go.strong{font-weight:700}.ghost{width:100%;min-height:40px;margin-top:12px;border:1px solid var(--ink);border-radius:6px;background:#fff;font:inherit;font-size:15px;cursor:pointer;color:var(--ink)}
.guide{position:absolute;display:flex;align-items:center;gap:8px;color:#111;font-size:12.5px;font-weight:700;line-height:1.25;text-align:center;pointer-events:none;transition:top .35s ease;right:calc(100% + 10px);white-space:nowrap}
.guide svg{flex:none;animation:nudge 1.2s ease-in-out infinite}@keyframes nudge{50%{transform:translateX(4px)}}
@media (max-width:860px){.guide{right:auto;left:8px;transform:translateY(-100%)}.guide .t{display:none}.guide svg{transform:rotate(90deg);animation:none}}
.result{border-color:color-mix(in srgb,var(--green) 55%,#fff);padding:0;overflow:hidden}.result .head{display:flex;align-items:center;justify-content:center;gap:10px;background:var(--green-soft);padding:24px;font-size:20px;font-weight:700;letter-spacing:-.01em}
.result .head svg{color:var(--green)}.result .body{padding:24px}.when{background:#f8fafc;border-radius:8px;padding:18px;text-align:center;margin-bottom:20px}.when small{display:block;color:var(--muted);font-size:14px}
.when b{display:block;font-size:20px;margin:4px 0}.when span{color:var(--green);font-size:17px}
.line{display:flex;justify-content:space-between;gap:16px;padding:9px 0;color:var(--muted);font-size:15.5px}.line b{color:var(--ink)}.line.disc b{color:var(--green-ink)}
.total{display:flex;justify-content:space-between;align-items:baseline;margin:22px 0 10px}.total span{font-size:19px;font-weight:700}.total b{font-size:32px;color:var(--green);letter-spacing:-.03em}
.obs{font-size:13.5px;color:var(--muted);font-style:italic;text-align:center;margin:0 16px 22px}
.note{display:flex;gap:12px;align-items:center;justify-content:center;text-align:center;padding:16px;border-radius:8px;background:#eef2ff;border:1px solid #c7d2fe;color:#4338ca;font-weight:700;font-size:15px;margin-bottom:14px}.note svg{flex:none}
.member{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;margin:0 -24px 16px;padding:16px 30px;background:linear-gradient(90deg,#fff7ed,#f0fdf4);border-top:1px solid #fed7aa;border-bottom:1px solid #fed7aa;color:#7c2d12;font-weight:700;font-size:15px}
.member label{display:flex;align-items:center;gap:6px;border:1px solid #fed7aa;border-radius:6px;background:#fffdfa;padding:0 10px;font-size:13px;color:#7c2d12}
.member input{width:96px;border:0;background:transparent;text-align:right;min-height:36px;padding:0}.member .out{grid-column:1/-1;font-weight:600;font-size:14.5px;color:#334155;display:grid;gap:4px}
.member .out div{display:flex;justify-content:space-between}.freebox{padding:14px 16px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;margin-bottom:14px;font-size:14.5px;color:#14532d}.freebox p{margin:0 0 6px}.freebox p:last-child{margin:0}
dialog{border:0;border-radius:12px;padding:0;max-width:640px;width:calc(100% - 24px);box-shadow:0 20px 60px rgba(15,23,41,.25);color:var(--ink)}dialog::backdrop{background:rgba(15,23,41,.45)}
.dlg{padding:24px;position:relative;max-height:calc(100vh - 40px);overflow:auto}.dlg h2{margin:0;font-size:20px}.dlg .sub{margin:4px 0 18px;color:var(--muted);font-size:14.5px}
.dlg .x{position:absolute;right:14px;top:14px;border:0;background:none;cursor:pointer;color:var(--muted);padding:4px}.dlg form{display:grid;gap:14px}
.dlg label{display:grid;gap:6px;font-weight:600;font-size:14.5px}.dlg .hint{font-size:13px;color:var(--muted);font-weight:400}.dlg .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dlg .box{background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:12px 14px;font-size:14.5px}.dlg .box b{display:block;margin-bottom:4px}.dlg .box .row{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
.dlg fieldset{border:0;padding:0;margin:0;display:grid;gap:8px}.dlg legend{font-weight:600;font-size:14.5px;margin-bottom:6px}.dlg .radio{display:flex;gap:8px;align-items:center;font-weight:400}.dlg .radio input{width:auto;min-height:0}
.dlg .dates,.dlg .links{display:grid;gap:8px}.dlg .addrow{display:flex;gap:8px}.dlg .small{border:1px solid var(--line);background:#fff;border-radius:6px;padding:6px 12px;font:inherit;font-size:14px;cursor:pointer;justify-self:start}
.dlg textarea{min-height:110px;resize:vertical}.dlg .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:6px}.dlg .actions .go{width:auto;padding:0 18px}.dlg .actions .ghost{width:auto;margin:0;padding:0 18px}
.dlg .msg{padding:12px 14px;border-radius:8px;font-size:14.5px}.dlg .msg.bad{background:#fef2f2;color:#b91c1c}.dlg .msg.good{background:var(--green-soft);color:#065f46;font-weight:600}
.trap{position:absolute;left:-5000px}
@media (max-width:640px){.fields{grid-template-columns:1fr}.types{grid-template-columns:1fr}.dlg .two{grid-template-columns:1fr}.member{grid-template-columns:1fr}.wrap{padding-top:16px}}
`;

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function calculatorPage(lang: Lang, nowMs: number): string {
  const t = TEXT[lang], s = SCRIPT_TEXT[lang];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const starts = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
  const packages = `<div class="pk">${PACKAGES.map(([h, p]) => `<div><span>${String(h).replace(".", lang === "da" ? "," : ".")} ${s.hoursUnit}</span><b>${p.toLocaleString(lang === "da" ? "da-DK" : "en-GB")} kr.</b></div>`).join("")}</div>`;
  const diff = `<table><tr>${s.diffHead.map(h => `<th>${h}</th>`).join("")}</tr>${s.diffRows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
  const rules = { standard: s.rules.standard.replace("{table}", packages), reduced: s.rules.reduced.replace("{diff}", diff), free: s.rules.free };
  const config = JSON.stringify({ lang, t: s, days: t.days, rules, started: nowMs }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title)} · Hjerterum</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"><style>${STYLE}</style></head><body>
<div class="wrap"><div class="top"><a class="lang" href="${t.langHref}">${icon(ICONS.globe, 16)} ${t.lang}</a></div>
<section class="card" id="calc"><div class="guide" id="guide" aria-hidden="true"><span class="t">${t.guide}</span>${icon(ICONS.arrow, 20)}</div>
<h1>${icon(ICONS.calendar, 22)}<span>${esc(t.title)}</span></h1><p class="lead">${esc(t.lead)}</p><p class="sr" id="touch">${esc(t.touch)}</p>
<div class="fields" id="time"><label class="f">${t.day}<select id="day" aria-describedby="touch">${order.map(d => `<option value="${d}"${d === 1 ? " selected" : ""}>${t.days[d]}</option>`).join("")}</select></label>
<label class="f">${t.start}<select id="start">${starts.map(v => `<option${v === "10:00" ? " selected" : ""}>${v}</option>`).join("")}</select></label>
<div class="f" style="display:grid;gap:8px;font-weight:700;font-size:14.5px"><span id="hours-label">${t.hours}</span><div class="stepper" role="group" aria-labelledby="hours-label"><button type="button" id="minus" aria-label="-0,5">-</button><b id="hours" aria-live="polite">2</b><button type="button" id="plus" aria-label="+0,5">+</button></div></div></div>
<p class="what" id="what">${t.what}<span>${t.whatHint}</span></p>
<div class="types" role="group" aria-labelledby="what">
<button type="button" class="type standard" data-type="standard" aria-pressed="false">${icon(ICONS.tag)}<b>${t.standard}</b><span>${t.standardSub}</span></button>
<button type="button" class="type reduced" data-type="reduced" aria-pressed="false">${icon(ICONS.star)}<b>${t.reduced}</b><span>${t.reducedSub}</span></button>
<button type="button" class="type free" data-type="free" aria-pressed="false">${icon(ICONS.gift)}<b>${t.free}</b><span>${t.freeSub}</span></button></div>
<p class="cross" id="cross" hidden role="alert"></p>
<details class="rules" id="rules"><summary><b>${icon(ICONS.info, 18)}${t.rules}</b><span>${t.unfold} ${icon(ICONS.chevron, 16)}</span></summary><div class="rules-body"><div id="rules-text"><p>${t.pickType}</p></div><p>${t.vat}</p></div></details>
<button type="button" class="go" id="go" disabled>${t.calc} ${icon(ICONS.arrow, 16)}</button></section>
<section class="card result" id="result" hidden aria-live="polite"></section>
<dialog id="dlg"></dialog></div>
<script>window.HJ=${config};</script><script>${SCRIPT}</script></body></html>`;
}

/** The page's behaviour: the guide, the choices, the price from the server, the result and the booking request. */
const SCRIPT = String.raw`(function(){
var C=window.HJ,T=C.t,$=function(id){return document.getElementById(id)};
var state={hours:2,type:null,touched:{},calc:null,member:""};
var fmt=function(n){return Number(n).toLocaleString(C.lang==="da"?"da-DK":"en-GB")+" kr."};
var hoursText=function(h){return String(h).replace(".",C.lang==="da"?",":".")};
var esc=function(v){return String(v==null?"":v).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})};
function post(){try{parent.postMessage({type:"hjerterum-beregner-height",height:document.documentElement.scrollHeight},"*")}catch(e){}}
// The guide: at the time first, on to the booking types once two of the three time fields are touched, then to the button.
function guide(){var g=$("guide"),card=$("calc");if($("calc").hidden){g.hidden=true;return}
  var n=Object.keys(state.touched).length,target=n<2?$("time"):!state.type?$("what"):$("go");g.hidden=false;
  g.querySelector(".t").style.display=target===$("time")?"":"none";
  var top=target.offsetTop+(target===$("time")?target.offsetHeight/2+12:target===$("what")?target.offsetHeight/2+40:target.offsetHeight/2);
  g.style.top=(top-g.offsetHeight/2)+"px"}
function minutes(v){var p=v.split(":");return +p[0]*60+ +p[1]}
function crosses(){if(!state.type||state.type==="standard")return false;var d=+$("day").value;if(d===0||d===6)return false;var a=minutes($("start").value),b=a+state.hours*60;return a<1110&&b>1110}
function sync(){$("hours").textContent=hoursText(state.hours);$("minus").disabled=state.hours<=2;$("plus").disabled=state.hours>=10;
  document.querySelectorAll(".type").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.type===state.type))});
  var x=crosses();$("cross").hidden=!x;$("cross").textContent=x?T.cross:"";$("go").disabled=!state.type||x;
  $("rules-text").innerHTML=state.type?C.rules[state.type]:"<p>"+esc(C.lang==="da"?"Vælg en bookingtype ovenfor for at se priser og regler.":"Choose a booking type above to see prices and rules.")+"</p>";
  guide();post()}
function touch(k){state.touched[k]=1;sync()}
$("day").addEventListener("change",function(){touch("day")});$("start").addEventListener("change",function(){touch("start")});
$("day").addEventListener("focus",function(){});
$("minus").onclick=function(){state.hours=Math.max(2,state.hours-0.5);touch("hours")};$("plus").onclick=function(){state.hours=Math.min(10,state.hours+0.5);touch("hours")};
document.querySelectorAll(".type").forEach(function(b){b.onclick=function(){state.type=b.dataset.type;sync()}});
$("rules").addEventListener("toggle",function(){guide();post()});
function payload(extra){return Object.assign({day:+$("day").value,start:$("start").value,hours:state.hours,type:state.type},extra||{})}
async function price(member){var body=payload(state.type==="reduced"&&member!==""?{memberPrice:+member}:{});
  var r=await fetch("/beregner/api/pris",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error("price");return r.json()}
function line(label,value,cls){return '<div class="line'+(cls?" "+cls:"")+'"><span>'+label+'</span><b>'+value+'</b></div>'}
function result(){var c=state.calc,band=(c.band==="A"?T.bandA:T.bandB)+(c.weekend?", "+T.weekend:"");
  var rows=c.type==="standard"?line(T.basePackage.replace("{h}",hoursText(c.hours)),fmt(c.baseKr))+line(T.some,T.included)
    :c.type==="reduced"?line(T.base,fmt(c.firstTwoKr))+(c.extraHours?line(T.extra.replace("{n}",hoursText(c.extraHours)).replace("{r}",c.extraRateKr),fmt(c.extraHours*c.extraRateKr)):"")
      +(c.discountKr?line(T.discount.replace("{p}",c.discountPercent),"−"+fmt(c.discountKr),"disc"):"")+line(T.some,T.included)
    :line(T.freeRent,fmt(0));
  var extra=c.type==="reduced"?'<div class="member"><span>'+T.memberAsk+'</span><label><input id="mp" inputmode="numeric" placeholder="0" value="'+esc(state.member)+'" aria-label="'+esc(T.members)+'"> kr.</label><div class="out" id="mpout"></div></div>'
    :c.type==="free"?'<div class="freebox"><p>'+T.freeMembers+'</p><p>'+T.freeMin+" <b>"+fmt(c.minimumNonMemberKr)+'</b></p><p>'+T.freeTeacher+'</p><p><b>'+T.freeOnly+'</b></p></div>'
    :'<p class="obs" style="font-style:normal;margin-top:-10px">'+T.noDiscount+'</p>';
  $("result").innerHTML='<div class="head"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'+T.result+'</div><div class="body">'
    +'<div class="when"><small>'+T.chosen+'</small><b>'+C.days[c.day]+" "+T.at+" "+c.start+'</b><span>'+hoursText(c.hours)+" "+T.hoursUnit+" ("+band+')</span></div>'+rows
    +'<div class="total"><span>'+T.total+'</span><b>'+fmt(c.totalKr)+'</b></div><p class="obs">'+T.obs+'</p>'
    +'<div class="note"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>'+T.setup+'</span></div>'
    +extra+'<button type="button" class="go strong" id="book">'+T.book+'</button><button type="button" class="ghost" id="again">'+T.again+'</button></div>';
  $("again").onclick=function(){$("result").hidden=true;$("calc").hidden=false;state.calc=null;sync();window.scrollTo(0,0)};
  $("book").onclick=openForm;
  var mp=$("mp");if(mp){var tm;mp.oninput=function(){state.member=mp.value.replace(/[^0-9]/g,"");clearTimeout(tm);tm=setTimeout(member,300)};member()}
  post()}
async function member(){var out=$("mpout");if(!out)return;if(state.member===""){out.innerHTML="";state.calc.memberPriceKr=null;state.calc.nonMemberPriceKr=null;post();return}
  try{var c=await price(state.member);state.calc=c;out.innerHTML="<div><span>"+T.nonMember+"</span><b>"+fmt(c.nonMemberPriceKr)+"</b></div><div><span>"+T.advantage+"</span><b>"+fmt(c.memberAdvantageKr)+"</b></div>"}catch(e){out.textContent=T.error}post()}
$("go").onclick=async function(){$("go").disabled=true;try{state.calc=await price("");state.member="";$("calc").hidden=true;$("result").hidden=false;$("guide").hidden=true;result();window.scrollTo(0,0)}catch(e){alert(T.error)}finally{$("go").disabled=false}};
// The booking request.
function openForm(){var c=state.calc,d=$("dlg");
  var mem=c.type==="reduced"?(c.memberPriceKr!=null?fmt(c.memberPriceKr):T.missingMember):c.type==="free"?fmt(0):"-";
  var non=c.type==="reduced"?(c.nonMemberPriceKr!=null?fmt(c.nonMemberPriceKr):T.fillYourself):c.type==="free"?fmt(c.minimumNonMemberKr):"-";
  d.innerHTML='<div class="dlg"><button type="button" class="x" id="close" aria-label="'+T.close+'"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
   +'<h2>'+T.formTitle+'</h2><p class="sub">'+T.formLead+'</p><form id="bf" novalidate>'
   +'<label>'+T.eventName+' *<input name="eventName" required maxlength="160"></label>'
   +'<div><label>'+T.date+' *</label><div class="dates" id="dates"><input type="date" name="dates" required></div><button type="button" class="small" id="adddate" style="margin-top:8px">+ '+T.addDate+'</button></div>'
   +'<div class="box"><b>'+T.when+'</b>'+C.days[c.day]+" "+T.at+" "+c.start+"-"+c.end+" · "+hoursText(c.hours)+" "+T.hoursUnit+'<div class="hint" style="margin-top:4px">'+esc(document.querySelector(".lead").textContent)+'</div></div>'
   +'<div class="two"><label>'+T.maxP+'<input name="maxParticipants" inputmode="numeric" maxlength="6"></label><label>'+T.payment+'<select name="payment"><option value="">'+T.paymentChoose+'</option>'+T.payments.map(function(p){return "<option>"+p+"</option>"}).join("")+'</select></label></div>'
   +'<div class="box"><b>'+T.overview+'</b><div class="row"><span>'+T.total+'</span><b style="display:inline;margin:0">'+fmt(c.totalKr)+'</b></div><div class="row"><span>'+T.members+'</span><span>'+mem+'</span></div><div class="row"><span>'+T.minNon+'</span><span>'+non+'</span></div></div>'
   +'<label>'+T.description+' *<textarea name="description" required maxlength="5000"></textarea></label><label>'+T.notes+'<textarea name="notes" maxlength="3000" style="min-height:70px"></textarea></label>'
   +'<label>'+T.image+'<span class="hint">'+T.imageHint+'</span><input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></label>'
   +'<fieldset><legend>'+T.signup+'</legend><label class="radio"><input type="radio" name="signup" value="'+T.signupOnline+'" checked> '+T.signupOnline+'</label><label class="radio"><input type="radio" name="signup" value="'+T.signupDirect+'"> '+T.signupDirect+'</label></fieldset>'
   +'<fieldset><legend>'+T.contact+'</legend><label>'+T.name+' *<input name="name" required maxlength="120" autocomplete="name"></label><div class="two"><label>'+T.email+' *<input type="email" name="email" required maxlength="200" autocomplete="email"></label><label>'+T.phone+'<input name="phone" maxlength="40" autocomplete="tel"></label></div></fieldset>'
   +'<div><label for="linkin">'+T.social+'</label><div class="addrow" style="margin-top:6px"><input id="linkin" placeholder="https://"><button type="button" class="small" id="addlink">'+T.add+'</button></div><div class="links" id="links" style="margin-top:6px"></div></div>'
   +'<input class="trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
   +'<div id="fmsg" class="msg" hidden role="status"></div><div class="actions"><button type="button" class="ghost" id="cancel">'+T.cancel+'</button><button class="go strong" id="send">'+T.send+'</button></div></form></div>';
  var links=[];$("addlink").onclick=function(){var v=$("linkin").value.trim();if(!v)return;links.push(v);$("linkin").value="";$("links").innerHTML=links.map(function(l){return "<div class=\"hint\">"+esc(l)+"</div>"}).join("")};
  $("adddate").onclick=function(){var i=document.createElement("input");i.type="date";i.name="dates";$("dates").appendChild(i)};
  var shut=function(){d.close();post()};$("close").onclick=shut;$("cancel").onclick=shut;
  $("bf").onsubmit=async function(e){e.preventDefault();var f=e.target,m=$("fmsg");
    var need=["eventName","description","name"].filter(function(n){return !f[n].value.trim()});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim()))need.push("email");
    if(![].slice.call(f.querySelectorAll('input[name="dates"]')).some(function(i){return i.value}))need.push("dates");
    if(need.length){m.hidden=false;m.className="msg bad";m.textContent=T.required;return}
    var fd=new FormData(f);var linkLeft=$("linkin").value.trim();fd.set("links",links.concat(linkLeft?[linkLeft]:[]).join("\n"));
    var p=payload();Object.keys(p).forEach(function(k){fd.set(k,p[k])});if(state.type==="reduced"&&state.member!=="")fd.set("memberPrice",state.member);fd.set("started",C.started);
    $("send").disabled=true;m.hidden=false;m.className="msg";m.textContent=T.sending;
    try{var r=await fetch("/beregner/foresporgsel",{method:"POST",body:fd});var j=await r.json().catch(function(){return {}});
      if(!r.ok||!j.ok){m.className="msg bad";m.textContent=T.failed[j.error]||T.failed.other;$("send").disabled=false;return}
      f.innerHTML='<div class="msg good">'+T.sent+'</div><div class="actions"><button type="button" class="go strong" id="done">'+T.close+'</button></div>';$("done").onclick=shut}
    catch(err){m.className="msg bad";m.textContent=T.failed.other;$("send").disabled=false}post()};
  d.showModal();post()}
window.addEventListener("resize",function(){guide();post()});window.addEventListener("load",function(){sync()});sync();
})();`;
