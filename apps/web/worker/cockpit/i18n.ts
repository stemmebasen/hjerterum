import type { D1Database } from "../db.js";
import { RECORDER_SCRIPT_EN } from "./recorder.js";

/** Requested: "Der bør vær en engelsk oversættelses knap - Douglas taler engelsk" - "Ja byg det sådan": a language
 * chosen once per member. In English the cockpit's own words (menus, buttons, headings, notices) are English; the board's
 * material - summaries, decisions, tasks, mails - stays in Danish as written, and Saga's own short texts on the front page
 * come from translations she makes when they are written (cockpit/translate.ts).
 * The pages are written in Danish; for an English reader the finished HTML is translated here: a text node (or a
 * placeholder, label or title) that is exactly a known phrase is replaced, a few known phrases inside longer lines and
 * Danish dates are turned, and nothing inside translate="no" (the board's own text), a script, a style or a textarea is
 * touched - except the chat's few known messages. */

export type Lang = "da" | "en";
export const LANGS: Record<Lang, string> = { da: "Dansk", en: "English" };

export async function memberLang(db: D1Database, who: string | null): Promise<Lang> {
  if (!who) return "da";
  const row = await db.prepare("SELECT lang FROM cockpit_prefs WHERE member = ?").bind(who).first<{ lang: string }>().catch(() => null);
  return row?.lang === "en" ? "en" : "da";
}

export async function setMemberLang(db: D1Database, who: string, lang: Lang, nowMs: number): Promise<void> {
  await db.prepare("INSERT INTO cockpit_prefs (member, lang, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(member) DO UPDATE SET lang = excluded.lang, updated_at_ms = excluded.updated_at_ms")
    .bind(who, lang, nowMs).run();
}

/** The members who read the cockpit in English - Saga translates her front-page texts only when there is one. */
export async function englishReaders(db: D1Database): Promise<string[]> {
  return ((await db.prepare("SELECT member FROM cockpit_prefs WHERE lang = 'en' ORDER BY member").all<{ member: string }>().catch(() => null))?.results ?? []).map(r => r.member);
}

// ---- The cockpit's own words ----

export const EN: Record<string, string> = {
  // Menus and frame
  "Overblik": "Overview", "Opgaver": "Tasks", "Møder": "Meetings", "Beslutninger": "Decisions", "Besluttet": "Decided", "Afstemninger": "Votes", "Forespørgsler": "Enquiries",
  "Arrangementer": "Events", "Huset": "Events", "Mere": "More", "Menu": "Menu", "Bestyrelsen": "The board", "Profil": "Profile", "Status": "Status", "Medlemmer": "Members",
  "Sagas fulde overblik": "Saga's full overview", "Ældre referater": "Older summaries", "Log ud": "Log out", "Vælg hvem du er": "Choose who you are", "Hjerterum bestyrelse": "Hjerterum board",
  "Adgang": "Access", "Luk adgang": "Close access", "Luk et medlems adgang: deres login på alle enheder ophører, og de skal bede Saga om et nyt link.":
    "Close a member's access: their login ends on all devices, and they must ask Saga for a new link.",
  "Sprog / Language": "Language / Sprog", "Dansk": "Dansk", "English": "English",
  // Saga's chat
  "Spørg Saga": "Ask Saga", "Chat med Saga": "Chat with Saga", "Hvis Saga tager fejl, så fortæl hende det - på den måde får vi bygget en klog og nyttig assistent med tiden.": "If Saga gets something wrong, tell her - that is how we build a smart and useful assistant over time.", "Det Saga har lært": "What Saga has learned", "Se, hvad Saga husker →": "See what Saga remembers →", "Ny samtale": "New conversation",
  "Start en ny samtale": "Start a new conversation", "Luk": "Close", "Send": "Send", "Skriv dit spørgsmål": "Write your question", "Dit spørgsmål": "Your question",
  "Hjælp mig med at opsætte event": "Help me set up an event", "Hvad er mine to-do's?": "What are my to-dos?", "Hvilke beslutninger har vi truffet om medlemskab?": "What have we decided about membership?",
  "Hvilke sager hænger lige nu?": "Which matters are pending right now?", "Hvilke arrangementer er der de næste to uger?": "Which events are on in the next two weeks?",
  // Login
  "Log ind": "Log in", "Fælles adgangskode": "Shared password", "Eller med den fælles adgangskode": "Or with the shared password", "Få dit login fra Saga på Telegram": "Get your login from Saga on Telegram",
  "Saga sender dig et personligt link, der logger dig ind som dig. Det virker én gang inden for 15 minutter. Du kan også skrive /login til hende.":
    "Saga sends you a personal link that logs you in as you. It works once within 15 minutes. You can also write /login to her.",
  "Bestyrelsens admin med møder, referater og beslutninger.": "The board's admin with meetings, summaries and decisions.", "Du logger ind som": "You are logging in as",
  "Linket er brugt eller udløbet. Skriv /login til Saga på Telegram for et nyt.": "The link is used or expired. Write /login to Saga on Telegram for a new one.", "Til login": "To login",
  "Hvem er du?": "Who are you?", "Så viser overblikket dine egne opgaver. Du vælger én gang: valget gælder, til du logger ud.": "Then the overview shows your own tasks. You choose once: it holds until you log out.",
  "Dit navn": "Your name", "Fortsæt": "Continue",
  // Front page
  "Her er det vigtigste i bestyrelsen lige nu.": "Here is what matters most in the board right now.", "Næste møde": "Next meeting", "Dine opgaver": "Your tasks", "Til godkendelse": "To approve",
  "Godkend referatet": "Approve the summary", "Til dig": "For you", "Det, der venter på dig - fra referaterne, bestyrelsen og Saga.": "What is waiting for you - from the summaries, the board and Saga.",
  "for at se dine opgaver.": "to see your tasks.", "Intet venter på dig lige nu.": "Nothing is waiting for you right now.", "Stil et forslag til afstemning →": "Make a proposal for a vote →",
  "Hvornår, hvor og hvad der er på dagsordenen.": "When, where and what is on the agenda.", "Hvornår og hvor.": "When and where.", "Mærkater": "Labels", "Tildel:": "Assign:", "Fjernet fra listen": "Removed from the list", "Sæt tilbage": "Put back", "Tallene er skrevet af fra MembershipWorks' dashboard. Gratis medlemskab, restance og opsagte er hver deres tal.": "The figures are copied from the MembershipWorks dashboard. Free membership, past due and cancelled are separate figures.", "Mails besvares indtil videre via Ones webmail.": "For now, mails are answered through One's webmail.", "Giv til": "Give to", "Ingen": "No one", "Mærkat": "Label", "Søg i afsender og emne": "Search sender and subject", "Søg i mails": "Search mails", "Intet": "None", "Medlem": "Member", "Event": "Event", "Økonomi": "Finance", "Generel": "General", "Automatisk": "Automatic", "Kritiske mails": "Critical mails", "Kritisk": "Critical", "Hvorfor:": "Why:", "Saga vurderer, at de skal tages stilling til hurtigst muligt.": "Saga judges that these need a decision as soon as possible.", "Kun Sagas forslag endnu - du finder dem under Rediger møde.": "Only Saga's suggestions so far - you will find them under Edit meeting.", "Optag et møde": "Record a meeting", "Ingen dagsorden endnu.": "No agenda yet.", "Åbn mødet og dagsordenen →": "Open the meeting and the agenda →",
  "Intet møde er sat i kalenderen, men Saga har set": "No meeting is in the calendar, but Saga has seen", "Sæt det i kalenderen →": "Put it in the calendar →",
  "Intet møde er sat i kalenderen.": "No meeting is in the calendar.", "Planlæg et møde →": "Plan a meeting →", "Vigtigste punkter fra sidste møde": "Key points from the last meeting",
  "Husk at godkende referatet": "Remember to approve the summary", "Ingen beslutninger i referatet.": "No decisions in the summary.", "har godkendt": "have approved",
  "Bestyrelsen lige nu": "The board right now", "Saga skriver det første korte resumé inden for en time (på hverdage).": "Saga writes the first short summary within an hour (on weekdays).",
  "Mere i Status →": "More in Status →", "Lige om lidt i Hjerterum": "Coming up at Hjerterum", "De næste arrangementer i Hjerterum.": "The next events in Hjerterum.", "Ingen arrangementer de næste dage.": "No events in the next few days.",
  "Alle arrangementer →": "All events →", "i team@ →": "in team@ →", "venter på godkendelse →": "awaiting approval →", "Kort fortalt": "In short", "Overblikket": "The overview",
  "Til overblikket": "To the overview",
  // Members
  "Ingen medlemstal endnu.": "No member figures yet.", "Upload et skærmbillede →": "Upload a screenshot →", "betalende medlemmer": "paying members", "medlemskontingent (årligt)": "membership fees (yearly)",
  "på gratis medlemskab": "on free membership", "Alle tal og opdatering →": "All figures and updating →", "Tjek tallene": "Check the figures", "Dato for tallene": "Date of the figures", "Fortryd": "Undo",
  "Gem tallene": "Save the figures", "Opdatér fra MembershipWorks": "Update from MembershipWorks",
  "Tag et skærmbillede af Dashboard › Current Stats i MembershipWorks og læg det her. Saga læser tallene, og du tjekker dem, før de gemmes.":
    "Take a screenshot of Dashboard › Current Stats in MembershipWorks and drop it here. Saga reads the figures, and you check them before they are saved.",
  "Lad Saga læse tallene": "Let Saga read the figures", "Udvikling": "Development", "Dato": "Date", "Betalende": "Paying", "Gratis": "Free", "I restance": "In arrears", "Årlig indtægt": "Yearly income",
  "Saga kunne ikke læse MembershipWorks-tal på billedet. Prøv et skærmbillede af hele Current Stats-siden.": "Saga could not read MembershipWorks figures in the image. Try a screenshot of the whole Current Stats page.",
  "Medlemstyper": "Membership types",
  // Minutes
  "Bestyrelsens godkendelse": "The board's approval", "Godkendt af:": "Approved by:", "for at godkende.": "to approve.", "Du har godkendt referatet.": "You have approved the summary.", "Opdater nu": "Update now", "Fold sammen ▴": "Fold up ▴", "Svar i gruppen →": "Answer in the group →", "Svar i Posthuset →": "Answer in the mailbox →", "Referatet kan ikke længere ændres.": "The summary can no longer be changed.", "Referatet er godkendt af alle og låst. Det kan ikke længere ændres.": "The summary is approved by everyone and locked. It can no longer be changed.",
  "Jeg godkender referatet": "I approve the summary", "Jeg har en rettelse": "I have a correction", "Send rettelsen til formanden": "Send the correction to the chair", "Saga spørger dig:": "Saga asks you:",
  "Svar Saga": "Answer Saga", "Ret dette punkt": "Correct this point", "Send rettelsen til Saga": "Send the correction to Saga", "Dagsorden": "Agenda", "Referat": "Summary", "Beslutning": "Decision",
  "Hvem": "Who", "Hvad": "What", "Frist": "Deadline", "← Møder": "← Meetings", "Åbn i Google Docs": "Open in Google Docs", "Print / gem som PDF": "Print / save as PDF",
  "Hjerterum · Bestyrelsen": "Hjerterum · The board", "Referat af bestyrelsesmøde": "Summary of board meeting", "Originalteksten fra referatdokumentet": "The original text from the summary document",
  "Åbn dokumentet": "Open the document", "Hvad skal rettes?": "What should be corrected?", "Dit svar til Saga": "Your answer to Saga",
  "Hvad skal rettes i punktet? Saga omskriver det - eller spørger dig, hvis hun er i tvivl.": "What should be corrected in the point? Saga rewrites it - or asks you if she is in doubt.",
  "Read in English": "Read in English", "Vis den danske original": "Show the Danish original",
  // Meetings
  "Ret dagsorden": "Edit agenda", "Fundet af Saga": "Found by Saga", "Sæt i kalenderen": "Put in the calendar", "Kommende møder": "Upcoming meetings", "Ingen møder planlagt.": "No meetings planned.",
  "Holdte møder": "Past meetings", "Ingen holdte møder endnu.": "No past meetings yet.", "Upload mødeoptagelse": "Upload a meeting recording",
  "Upload er ikke sat op endnu (lageret til optagelser mangler).": "Upload is not set up yet (the storage for recordings is missing).", "Læs referatet": "Read the summary",
  "Intet godkendt referat endnu.": "No approved summary yet.", "Optagelse af dette møde (mp3, m4a, wav, ogg - højst 60 MB)": "Recording of this meeting (mp3, m4a, wav, ogg - at most 60 MB)",
  "Saga skriver referatet ud fra optagelsen og dagsordenen og lægger det op her til bestyrelsens godkendelse.": "Saga writes the summary from the recording and the agenda and puts it here for the board's approval.",
  "Bed Saga om forslag til dagsorden": "Ask Saga for a suggested agenda",
  "Hun læser referaterne, hængepartierne, gruppen og team@ - forslaget gemmes først, når du trykker Gem.": "She reads the summaries, the open matters, the group and team@ - the suggestion is only saved when you press Save.",
  "Slet møde": "Delete meeting", "Hvilket møde er optagelsen fra?": "Which meeting is the recording from?", "Vælg mødet …": "Choose the meeting …", "Et andet møde …": "Another meeting …",
  "Optagelse (mp3, m4a, wav, ogg - højst 60 MB)": "Recording (mp3, m4a, wav, ogg - at most 60 MB)", "Mødedato": "Meeting date", "Upload og lav referat": "Upload and make a summary",
  "Saga skriver referatet ud fra optagelsen og lægger det op her. Bestyrelsen godkender det, og hvert medlem kan rette de enkelte punkter.":
    "Saga writes the summary from the recording and puts it here. The board approves it, and each member can correct the individual points.",
  "Tid": "Time", "Sted": "Place", "Dagsorden (ét punkt pr. linje)": "Agenda (one point per line)", "Gem møde": "Save meeting", "Læs referat": "Read summary", "I referatdokumentet": "In the summary document",
  "Upload optagelse": "Upload recording", "Mangler": "Missing", "Planlæg et møde": "Plan a meeting", "Forslag til næste dagsorden": "Suggested next agenda",
  "Lav et møde med denne dagsorden": "Make a meeting with this agenda", "Referatdokumentet": "The summary document", "Åbn referatdokumentet": "Open the summary document",
  "Referater du mangler at godkende": "Summaries you have yet to approve",
  // Status
  "Til dig som formand": "For you as chair", "Skriv en opgave": "Write a task", "Lige nu": "Right now", "Det vigtigste": "The most important", "Saga har ikke lavet et overblik endnu.": "Saga has not made an overview yet.",
  "Venter på svar": "Awaiting answer", "Hjerterum har haft over": "Hjerterum has had over", "events siden start": "events since the start", "Næste teammøde": "Next team meeting", "Se arrangementerne →": "See the events →", "team@ er ikke forbundet. Formanden forbinder den under Posthus.": "team@ is not connected. The chair connects it under Mail.",
  "team@ afviste adgangskoden. Formanden forbinder den igen under Posthus.": "team@ refused the password. The chair connects it again under Mail.", "team@ er ikke blevet tjekket endnu.": "team@ has not been checked yet.",
  "Seneste tjek af team@ blev ikke færdigt i tide.": "The last check of team@ did not finish in time.", "Mailserveren svarede ikke ved seneste tjek af team@.": "The mail server did not answer at the last check of team@.", "Marker dem som klaret under Opgaver.": "Mark them as done under Tasks.", "Kommende datoer": "Coming dates", "Se hele status →": "See the whole status →", "Seneste referat": "Latest summary", "Sagas overblik": "Saga's overview",
  "Ugeopsummering": "Weekly summary", "Seneste referater": "Latest summaries",
  "Ingen beslutninger.": "No decisions.", "Hele billedet af bestyrelsens arbejde: gruppen, referatdokumentet og de seneste referater.": "The whole picture of the board's work: the group, the summary document and the latest summaries.",
  "beskeder denne uge": "messages this week", "ugen før": "the week before", "har skrevet i ugen": "have written this week", "Ingen emner i gruppen de seneste to uger.": "No topics in the group in the last two weeks.",
  "åbn": "open", "Gruppen lige nu": "The group right now", "Åbn gruppen i Telegram": "Open the group in Telegram", "Hvem har hvad": "Who has what",
  // Decisions and archive
  "Kilde": "Source", "Afstemning": "Vote", "Dokumentet": "The document", "Ingen beslutninger endnu.": "No decisions yet.", "Arkiv": "Archive", "Referater fra Saga": "Summaries from Saga",
  "Ingen endnu.": "None yet.", "Tidligere referater": "Earlier summaries", "Ingen referater fundet i dokumentet.": "No summaries found in the document.",
  // Tasks
  "Opgave": "Task", "Frist (valgfri)": "Deadline (optional)", "Til": "To", "Mig selv": "Myself", "Alle": "Everyone", "Stil et forslag til afstemning i bestyrelsen →": "Make a proposal for a vote in the board →",
  "Intet venter på dig. Godt gået.": "Nothing is waiting for you. Well done.", "Hvad bevæger sig": "What is moving",
  "Hele bestyrelsens opgaver fra referaterne den seneste måned - de nyeste øverst.": "The whole board's tasks from the summaries in the last month - newest first.",
  "Hele bestyrelsens åbne opgaver fra referaterne - de nyeste øverst.": "The whole board's open tasks from the summaries - newest first.", "Intet er i gang lige nu.": "Nothing is under way right now.", "Klik her for detaljer": "Click here for details", "Skjul detaljer": "Hide details", "Klik her for at se alle møder": "Click here to see all meetings", "Skjul de ældre møder": "Hide the older meetings", "Klik her for at se alle beslutninger": "Click here to see all decisions", "Skjul de ældre beslutninger": "Hide the older decisions", "Klik her for at se alle aftaler": "Click here to see all agreements", "Skjul de ældre aftaler": "Hide the older agreements", "Klik her for at se alle kommende arrangementer": "Click here to see all coming events", "Skjul de senere arrangementer": "Hide the later events",
  "Klik her for at se flere": "Click here to see more", "Skjul de ældre": "Hide the older", "Skjul de øvrige": "Hide the rest", "Klik her for at se alle kategorier": "Click here to see all categories", "Skjul de øvrige kategorier": "Hide the other categories",
  "Klik her for at se flere mails": "Click here to see more mails", "Skjul de ældre mails": "Hide the older mails", "Klik her for at se alle samtaler": "Click here to see all conversations", "Skjul de ældre samtaler": "Hide the older conversations",
  "Klik her for at se alle": "Click here to see all", "Klik her for at se alle referater": "Click here to see all summaries", "Skjul de ældre referater": "Hide the older summaries", "Klik her for at se alle tidligere referater": "Click here to see all earlier summaries",
  "Opgaver fra referaterne, og dem du eller andre i bestyrelsen skriver til dig - de nyeste øverst. Tryk på firkanten, når en er klaret.":
    "Tasks from the summaries, and the ones you or others in the board write to you - newest first. Tap the square when one is done.",
  "Slet punktet": "Delete the item", "Slet": "Delete", "Fx ring til udlejer om nøgler": "E.g. call the landlord about keys", "Klaret": "Done", "Opgaver, der er klaret, forsvinder automatisk efter syv dage.": "Tasks that are done disappear automatically after seven days.", "Vis kun": "Show only", "Dine to-do's": "Your to-dos", "Hvad har du ansvar for?": "What are you responsible for?",
  "Skriv det med dine egne ord, så ved Saga, hvad hun skal give dig besked om, og hvem hun skal pege på, når noget kommer ind. Du kan altid rette det under din profil.": "Write it in your own words, so Saga knows what to tell you about and who to point to when something comes in. You can always edit it under your profile.",
  "Mine ansvarsområder": "My areas of responsibility", "Skriv med dine egne ord, hvad du har ansvar for i Hjerterum. Så ved Saga, hvad hun skal give dig besked om, og hvem hun skal pege på, når noget kommer ind.": "Write in your own words what you are responsible for in Hjerterum. Then Saga knows what to tell you about and who to point to when something comes in.",
  "Gemt. Saga kender dem nu.": "Saved. Saga knows them now.", "Fx lokaler og nøgler, økonomi, nyhedsbrev": "E.g. rooms and keys, finances, newsletter",
  "Tilføj": "Add", "Gem": "Save",
  // Votes
  "GODKENDT": "APPROVED", "Træk forslaget tilbage": "Withdraw the proposal", "Jeg ønsker at drøfte dette på et møde": "I want to discuss this at a meeting", "Fortryd: drøft på et møde": "Undo: discuss at a meeting",
  "Opret forslag til afstemning": "Create a proposal for a vote", "Forslag": "Proposal", "Begrundelse (valgfri)": "Reasoning (optional)", "3 dage": "3 days", "7 dage": "7 days", "14 dage": "14 days",
  "Stil forslaget": "Make the proposal", "for at stille et forslag.": "to make a proposal.", "Ingen forslag til afstemning lige nu.": "No proposals to vote on right now.", "Afgjort": "Decided",
  "Til afstemning": "Up for vote", "Godkendt": "Approved", "Ikke vedtaget": "Not adopted", "Trukket tilbage": "Withdrawn", "Stem for": "Vote for", "Stem imod": "Vote against", "Undlad at stemme": "Abstain", "Undlad": "Abstain", "at stemme": "",
  "Fx Vi åbner salen om søndagen": "E.g. We open the hall on Sundays",
  "Forslaget er stillet. Hele bestyrelsen har det nu på sin to-do.": "The proposal is made. The whole board now has it on their to-do.", "Din stemme er registreret.": "Your vote is registered.",
  "Forslaget er allerede afgjort.": "The proposal is already decided.", "Forslaget er trukket tilbage.": "The proposal is withdrawn.",
  "Noteret: du ønsker forslaget drøftet på et møde. Saga tager det med i sit forslag til næste dagsorden.": "Noted: you want the proposal discussed at a meeting. Saga includes it in her suggestion for the next agenda.",
  "Dit ønske om at drøfte forslaget på et møde er taget tilbage.": "Your wish to discuss the proposal at a meeting is withdrawn.",
  // Enquiries
  "Scan nu": "Scan now", "Ingen åbne forespørgsler.": "No open enquiries.",
  "Henvendelser til team@ om lokaler, undervisning, arrangementer, medlemskab og samarbejde - fundet af Saga, de nyeste øverst. Tryk Klaret, når en er taget hånd om.":
    "Enquiries to team@ about rooms, teaching, events, membership and collaboration - found by Saga, newest first. Press Done when one has been handled.",
  // Events
  "Se teksten": "See the text", "Godkend": "Approve", "Afvis": "Reject", "Ingen medlems-events venter på godkendelse.": "No member events are awaiting approval.", "Fjern": "Remove",
  "Nyt arrangement med Saga": "New event with Saga",
  "Skriv med dine egne ord: hvad, hvem (navn og mail), hvornår, priser for medlemmer og ikke-medlemmer. Saga laver et udkast med prisen fra prisberegneren - hun finder ikke på noget, der mangler.":
    "Write in your own words: what, who (name and email), when, prices for members and non-members. Saga makes a draft with the price from the calculator - she does not invent anything that is missing.",
  "Lav udkast": "Make draft", "Saga kan ikke lave udkast lige nu (hendes AI er ikke sat op).": "Saga cannot make drafts right now (her AI is not set up).", "Udkast": "Drafts",
  "Events, medlemmer selv har oprettet på hjemmesiden. De vises først offentligt, når de er godkendt. Saga godkender kun, når alle kriterier klart er opfyldt - ellers lander de her. På hverdage.":
    "Events members have created themselves on the website. They are only shown publicly once approved. Saga only approves when all criteria are clearly met - otherwise they land here. On weekdays.",
  "← Arrangementer": "← Events", "Mangler:": "Missing:", "Kategori": "Category", "Vælg": "Choose", "Lejetype": "Rental type", "Tilmelding": "Sign-up", "På hjemmesiden": "On the website",
  "Direkte til underviser": "Directly to the teacher", "Beskrivelse": "Description", "Opret i Hjerterums nye system": "Create in Hjerterum's new system", "Kassér": "Discard", "Til MembershipWorks": "For MembershipWorks",
  "Så længe vi kører begge systemer: kopiér teksten ind som nyt event i MembershipWorks.": "While we run both systems: copy the text into MembershipWorks as a new event.", "Kopiér": "Copy",
  "Bemærkning (valgfri)": "Note (optional)", "Bemærkning": "Note", "Navn": "Name", "Mail (som på hjemmesiden)": "Email (as on the website)", "Mail": "Email",
  "Fjernet fra kalenderen": "Removed from the calendar", "Alle år": "All years", "Søg": "Search", "Ingen arrangementer fundet.": "No events found.", "Kommende": "Upcoming",
  "Ingen kommende arrangementer i kalenderen.": "No upcoming events in the calendar.", "Arrangementer pr. år": "Events per year", "* indtil nu, inkl. planlagte.": "* so far, incl. planned.",
  "Mest aktive det seneste år": "Most active in the last year", "Underviserne står ikke i kalenderen.": "The teachers are not in the calendar.", "Kategorier": "Categories", "Seneste afholdte": "Latest held",
  "Saga henter stadig hele historikken fra kalenderen. Den er klar inden for en time.": "Saga is still fetching the whole history from the calendar. It is ready within an hour.",
  "de næste 30 dage": "the next 30 days", "Undervisere →": "Teachers →", "Søg fx yoga, lydhealing, et navn": "Search e.g. yoga, sound healing, a name", "Søg i arrangementer": "Search events", "År": "Year",
  "Antal arrangementer pr. år": "Number of events per year", "Faste undervisere": "Regular teachers",
  // Teachers
  "Fast": "Regular", "Mangler kontakt": "Missing contact", "Undervisere": "Teachers",
  "Alle, der har undervist eller holdt arrangementer i Hjerterum - samlet automatisk fra kalenderen (siden 2019), bookingerne i det nye system og listen over faste undervisere.":
    "Everyone who has taught or held events in Hjerterum - collected automatically from the calendar (since 2019), the bookings in the new system and the list of regular teachers.",
  "Aktive": "Active", "Kommende arrangementer eller aktive det seneste år.": "Upcoming events or active in the last year.", "Ingen.": "None.", "nyt system": "new system", "Intet resumé endnu.": "No summary yet.",
  "← Undervisere": "← Teachers", "Kontakt": "Contact", "Systemet kender allerede:": "The system already knows:", "Systemet har ingen kontaktoplysninger endnu - udfyld dem her.": "The system has no contact details yet - fill them in here.",
  "Telefon": "Phone", "Hjemmeside / Facebook": "Website / Facebook", "Note til bestyrelsen": "Note for the board", "Gem kontakt": "Save contact", "Samarbejdet": "The collaboration",
  "Saga læser arrangementerne, mails til team@, bestyrelsens gruppe og referaterne - hun finder ikke på noget.": "Saga reads the events, mails to team@, the board's group and the summaries - she does not invent anything.",
  "Søg på navn": "Search by name", "Tidligere": "Earlier",
  "Posthus": "Mailbox", "Indbakke": "Inbox", "Vigtige mails, der stadig er ubesvarede": "Important mails still unanswered", "Besvaret": "Answered",
  "Ingen ubesvarede henvendelser.": "No unanswered enquiries.", "Saga tjekker team@ for svar. Har du svaret fra en anden mail eller telefonen, så tryk Besvaret.": "Saga checks team@ for answers. If you answered from another mail or the phone, press Answered.", "Saga tjekker team@ for svar. Har du svaret fra en anden mail eller telefonen, så tryk på fluebenet.": "Saga checks team@ for answers. If you answered from another mail or the phone, press the check mark.", "Marker som besvaret": "Mark as answered", "Fortryd: åbn igen": "Undo: open again", "Svar kan ikke følges": "Answer cannot be followed", "Intet nyt de seneste to uger.": "Nothing new in the last two weeks.", "Ingen mails endnu.": "No mails yet.",
  "Hjerterums fælles mail (team@). Øverst de vigtige mails, der stadig venter på svar - nedenunder hele indbakken.": "Hjerterum's shared mail (team@). On top the important mails still waiting for an answer - below, the whole inbox.",
  "Henvendelser om lokaler, undervisning, arrangementer, medlemskab og samarbejde - fundet af Saga. Tryk Besvaret, når nogen har svaret.": "Enquiries about rooms, teaching, events, membership and collaboration - found by Saga. Press Answered when someone has replied.",
  // Found when going through the pages in English
  "Referatdokumentet er ikke koblet på endnu.": "The summary document is not connected yet.", "Saga har læst alle nye mails i team@.": "Saga has read all new mails in team@.", "Åbne": "Open",
  "Din egen opgave": "Your own task", "Ikke sat": "Not set", "Læs og godkend →": "Read and approve →", "Planlæg det under Møder": "Plan it under Meetings",
  "Sagas korte resumé af, hvad der rører sig.": "Saga's short summary of what is going on.", "Åbn dine opgaver →": "Open your tasks →", "Siden findes ikke.": "The page does not exist.",
  "Markér som klaret": "Mark as done", "Skrevet af dig": "Written by you", "Ingen har godkendt endnu.": "No one has approved yet.", "Saga skriver referatet": "Saga is writing the summary",
  "Lægges op om lidt": "Coming up shortly", "Referatet kunne ikke laves - upload igen": "The summary could not be made - upload again", "Bed Saga om et nyt resumé": "Ask Saga for a new summary",
  "Bed Saga om et resumé af samarbejdet": "Ask Saga for a summary of the collaboration", "Betalende medlemmer": "Paying members", "Til stede": "Present", "Fraværende": "Absent",
  "Tak - din godkendelse er noteret.": "Thank you - your approval is noted.", "Tak - formanden har fået din rettelse.": "Thank you - the chair has received your correction.",
  "Gratis medlemskab": "Free membership", "Konti i alt": "Accounts in total", "Konti med medlemskab": "Accounts with membership", "Venter på opsigelse": "Awaiting cancellation",
    "Saga kunne ikke oversætte referatet lige nu. Prøv igen om lidt.": "Saga could not translate the summary right now. Try again shortly.",
  // The login code (cockpit/personalLogin.ts) - the login page is also read in English.
  "Saga sender dig et personligt link og en kode. Begge virker én gang inden for 15 minutter. Du kan også skrive /login til hende.": "Saga sends you a personal link and a code. Both work once, within 15 minutes. You can also write /login to her.",
  "Har du en kode fra Saga?": "Do you have a code from Saga?", "Log ind med kode": "Log in with the code",
  "Åbner linket i Telegrams egen browser, bliver du kun logget ind dér. Skriv i stedet koden her, i den browser du plejer at bruge til admin.": "If the link opens in Telegram's own browser, you are only logged in there. Write the code here instead, in the browser you usually use for admin.",
  "Står du i Telegrams egen browser? Så bliver du kun logget ind her. Vil du være det i din almindelige browser, så tryk ikke - gå til admin-siden dér, og skriv koden fra Saga.": "Are you in Telegram's own browser? Then you are only logged in here. If you want to be logged in in your usual browser, do not press - go to the admin page there and write the code from Saga.",
  // The proposals on everyone's front page and the clearer form (cockpit/votes.ts).
  "Forslag til afstemning": "Proposals for a vote", "Stem her - eller læs hele forslaget under Beslutninger.": "Vote here - or read the whole proposal under Decisions.", "Du mangler at stemme": "You still need to vote",
  "Vedtaget": "Adopted", "Stemt ind af bestyrelsen den seneste uge.": "Voted in by the board in the last week.", "Vedtaget den seneste uge": "Adopted in the last week", "Stil et nyt forslag →": "Make a new proposal →", "+ Stil et forslag": "+ Make a proposal", "Skriv forslaget her. Det står på alles forside og to-do, til de har stemt.": "Write the proposal here. It stands on everyone's front page and to-do list until they have voted.",
  // A proposal for the next meeting, the fold-out tab and the laurel on historic decisions (cockpit/votes.ts).
  "Opret forslag": "Create proposal", "Det står på alles forside og to-do - eller på næste dagsorden.": "It stands on everyone's front page and to-do list - or on the next agenda.",
  "Hvordan skal der stemmes?": "How should it be voted on?", "Opslagstavle": "Notice board", "Opslagstavlen": "The notice board", "Nyt opslag": "New post", "+ Nyt opslag": "+ New post", "bestyrelsen stemmer digitalt eller på mødet": "the board votes online or at the meeting", "vedtaget ved flertal": "adopted by majority", "Saga sætter det på dagsordenen": "Saga puts it on the agenda", "Digital afstemning": "Digital vote", "Bestyrelsen stemmer her. Vedtaget ved flertal.": "The board votes here. Adopted by a majority.",
  "På næste møde": "At the next meeting", "Saga foreslår det som punkt på næste dagsorden.": "Saga suggests it as an item on the next agenda.", "Frist for afstemningen": "Deadline for the vote",
  "Vil nogen hellere tage et digitalt forslag op på et møde, kan de trykke": "Would anyone rather raise a digital proposal at a meeting, they can press",
  "Til næste møde": "For the next meeting", "Når mødet har stemt:": "When the meeting has voted:", "Vedtaget på mødet": "Adopted at the meeting", "Møde": "Meeting",
  "Forslaget er stillet til næste møde. Saga foreslår det som punkt på dagsordenen.": "The proposal is made for the next meeting. Saga suggests it as an item on the agenda.",
  "Noteret: forslaget er vedtaget på mødet.": "Noted: the proposal was adopted at the meeting.", "Noteret: forslaget blev ikke vedtaget på mødet.": "Noted: the proposal was not adopted at the meeting.",
  // Decisions and informal agreements (cockpit/decisionKinds.ts).
  "Uformelle aftaler": "Informal agreements", "Beslutninger og aftaler": "Decisions and agreements", "Aftale": "Agreement", "Aftaler": "Agreements", "Aftaler mellem enkelte personer, anbefalinger, forslag og noter - alt det, der ikke er afgjort som en beslutning i bestyrelsen, og derfor uden laurbær. Er en af dem i virkeligheden en beslutning, så tryk": "Agreements between a few people, recommendations, proposals and notes - everything that is not settled as a decision of the board, and so has no laurel. If one of them is really a decision, press", "Ret sortering": "Correct the sorting", "Færdig med at rette": "Done correcting", "Flyt til aftaler": "Move to agreements", "Flyt til beslutninger": "Move to decisions", "Saga sorterer beslutninger og aftaler - genindlæs siden om lidt.": "Saga is sorting decisions and agreements - reload the page in a moment.", "Flyttet til de uformelle aftaler.": "Moved to the informal agreements.", "Flyttet til beslutningerne.": "Moved to the decisions.", "Uformelt aftalt eller anbefalet - ikke afgjort som beslutning i bestyrelsen.": "Agreed informally or recommended - not settled as a decision of the board.",
  // The agenda as a list of points (cockpit/page.ts meetingPage).
  "Ingen punkter endnu.": "No points yet.", "Nyt punkt, fx Økonomi": "New point, e.g. Finances", "Nyt punkt": "New point", "Tilføj punkt": "Add point", "Sagas forslag": "Saga's suggestion", "Fjern punktet": "Remove the point", "Dato, tid og sted": "Date, time and place", "Gem dato, tid og sted": "Save date, time and place", "Saga læser referaterne, hængepartierne, gruppen og team@ og lægger sine forslag som punkter nederst. Slet dem, du ikke vil have, med krydset.": "Saga reads the summaries, the open threads, the group and team@ and puts her suggestions at the bottom as points. Delete the ones you do not want with the cross.", "Dagsordenens punkter tilføjes ét ad gangen på mødets side.": "The points of the agenda are added one at a time on the meeting's page.", "Saga fandt ikke noget nyt at foreslå ud fra materialet.": "Saga found nothing new to suggest from the material.", "Saga har allerede fem forslag på dagsordenen - flere ad gangen er for mange. Slet et med krydset, så finder hun et nyt.": "Saga already has five suggestions on the agenda - more at a time is too many. Delete one with the cross and she will find a new one.", "Saga kan ikke lave forslag lige nu (hendes AI er ikke sat op).": "Saga cannot make suggestions right now (her AI is not set up).", "Saga kunne ikke lave et forslag lige nu. Prøv igen om lidt.": "Saga could not make a suggestion right now. Try again in a moment.",
  // Kind of meeting: team meeting or other (cockpit/page.ts).
  "Hvilken slags møde er det?": "What kind of meeting is it?", "Teammøde": "Team meeting", "Andet møde": "Other meeting", "Slags møde": "Kind of meeting", "Saga foreslår kun punkter til teammøder - fx ikke til en generalforsamling.": "Saga only suggests points for team meetings - not, say, for a general assembly.", "Saga foreslår kun punkter til teammøder - sig først, hvad det er.": "Saga only suggests points for team meetings - say first which it is.", "Det er et teammøde": "It is a team meeting", "Det er et andet møde": "It is another kind of meeting", "Sig, hvilken slags møde det er": "Say which kind of meeting it is", "(Saga foreslår kun punkter til teammøder)": "(Saga only suggests points for team meetings)", "Saga foreslår kun punkter til teammøder. Sig først, at det er et teammøde.": "Saga only suggests points for team meetings. Say first that it is a team meeting.", "Saga laver kun forslag, når du beder hende om det - de står nederst som punkter. Slet dem, du ikke vil have, med krydset - det koster ingen AI.": "Saga only makes suggestions when you ask her to - they stand at the bottom as points. Delete the ones you do not want with the cross - it costs no AI.",
  // Editing a meeting and a point of its agenda (cockpit/page.ts).
  "Rediger møde": "Edit meeting", "Træk for at flytte punktet - eller brug pil op og ned": "Drag to move the point - or use the up and down arrows", "Ret punktet": "Edit the point", "Annullér": "Cancel", "Sæt kryd, hvis det er et teammøde - så kan Saga foreslå punkter, når du beder hende om det på mødets side.": "Tick this if it is a team meeting - then Saga can suggest points when you ask her to on the meeting's page.", "Saga foreslår kun punkter til teammøder. Sæt kryd ved Teammøde under Dato, tid og sted, og tryk Gem.": "Saga only suggests points for team meetings. Tick Team meeting under Date, time and place, and press Save.",
  // The meeting page: roles, the reminder note.
  "Påmindelse om mødet:": "Reminder about the meeting:", "Om morgenen på mødedagen (fra kl. 8) skriver Saga i gruppen, at dagsordenen er klar, med punkterne, hvornår I ses og et link til dagsordenen. Det sker for teammøder, der har punkter på dagsordenen.": "On the morning of the meeting (from 8 o'clock) Saga writes in the group that the agenda is ready, with the points, when you meet and a link to the agenda. It happens for team meetings that have points on the agenda.", "Mødeleder": "Meeting leader", "Ordstyrer": "Moderator", "Ikke valgt": "Not chosen", "Dato, tid, sted og roller": "Date, time, place and roles", "Gem ændringer": "Save changes",
  // The meeting recorder (cockpit/recorder.ts).
  "Optag mødet her": "Record the meeting here", "Alle, der deltager, ved, at mødet bliver optaget.": "Everyone taking part knows the meeting is being recorded.",
  "● Start optagelse": "● Start recording", "Stop og lav referat": "Stop and make the summary", "Sender optagelsen …": "Sending the recording …", "Send nu": "Send now", "Hent filen": "Download the file",
  "Optager": "Recording", "Pause": "Pause", "Tjek mikrofonen": "Check the microphone",
  "Lydfilen slettes 14 dage efter, at referatet er lagt op. Referatet og transskriptionen beholdes.": "The audio file is deleted 14 days after the summary is put up. The summary and the transcript are kept.",
  "Optagelsen bruger enhedens mikrofon: læg telefonen eller computeren midt på bordet, og hold siden åben og skærmen tændt, mens I optager. Når I trykker stop, skriver Saga referatet ud fra optagelsen og dagsordenen.":
    "The recording uses the device's microphone: put the phone or computer in the middle of the table, and keep the page open and the screen on while you record. When you press stop, Saga writes the summary from the recording and the agenda.",
  "Hold siden åben og skærmen tændt - lukker du siden eller låser telefonen, stopper optagelsen.": "Keep the page open and the screen on - if you close the page or lock the phone, the recording stops."
};

const MONTHS_DA = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS: Record<string, string> = { mandag: "Monday", tirsdag: "Tuesday", onsdag: "Wednesday", torsdag: "Thursday", fredag: "Friday", lørdag: "Saturday", søndag: "Sunday" };
const SHORT_DAYS: Record<string, string> = { man: "Mon", tir: "Tue", ons: "Wed", tor: "Thu", fre: "Fri", lør: "Sat", søn: "Sun" };
const month = (m: string) => { const i = MONTHS_DA.findIndex(x => x === m.toLowerCase() || x.slice(0, 3) === m.toLowerCase().slice(0, 3)); return i; };

/** Known phrases inside longer lines, and Danish dates. */
const MONTH_NAMES_EN: Record<string, string> = { januar: "January", februar: "February", marts: "March", april: "April", maj: "May", juni: "June", juli: "July", august: "August", september: "September", oktober: "October", november: "November", december: "December" };

const RULES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [/^Hej (.+?) 🙂 Jeg er Saga\. Spørg mig f\.eks\. om vedtægter, beslutninger, sager, møder, arrangementer og medlemskab\.$/, (_, name) => `Hi ${name} 🙂 I'm Saga. Ask me e.g. about the statutes, decisions, matters, meetings, events and membership.`],
  [/^Hej 🙂 Jeg er Saga\. /, "Hi 🙂 I'm Saga. "],
  [/^Godkendt af alle og låst (.+)\.$/, "Approved by everyone and locked $1."],
  [/^(Fra Telegram gruppen|Fra team@|Fra Saga) ·$/, (_, where) => `${({ "Fra Telegram gruppen": "From the Telegram group", "Fra team@": "From team@", "Fra Saga": "From Saga" } as Record<string, string>)[where]} ·`], [/^Godkendt af (.+)$/, "Approved by $1"],
  [/^Hej (\S+)$/, "Hi $1"],
  [/\b(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)(?: den)? (\d{1,2})\. (januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)(?: (\d{4}))?/gi,
    (_, d, n, m, y) => `${DAYS[d.toLowerCase()] ?? d} ${n} ${MONTHS_EN[month(m)]}${y ? ` ${y}` : ""}`],
  [/\b(\d{1,2})\. (januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\b/gi, (_, n, m) => `${n} ${MONTHS_EN[month(m)]}`],
  [/\b(\d{1,2})\. (jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\.?(?![a-zæøå])/gi, (_, n, m) => `${n} ${MONTHS_EN[month(m)]!.slice(0, 3)}`],
  [/\b(man|tir|ons|tor|fre|lør|søn)\. (?=\d)/g, (_, d) => `${SHORT_DAYS[d]} `],
  [/\bkl\. (?=\d)/g, "at "],
  [/^Flyt punktet: /, "Move the point: "],
  [/^Mødeleder: /, "Meeting leader: "], [/^Ordstyrer: /, "Moderator: "], [/ · Ordstyrer: /, " · Moderator: "],
  [/^Ret punktet: /, "Edit the point: "],
  [/^Fjern punktet: /, "Remove the point: "], [/^Tilføj Sagas forslag fra dokumentet \((\d+) punkt(?:er)?\)$/, (_, n) => `Add Saga's suggestions from the document (${n} point${n === "1" ? "" : "s"})`],
  [/^Tag Sagas forslag med som punkter på dagsordenen \((\d+)\)$/, "Take Saga's suggestions along as points on the agenda ($1)"],
  [/^Saga har lagt (\d+) (?:punkt|punkter) nederst på dagsordenen\. Slet dem, du ikke vil have, med krydset\.$/, (_, n) => `Saga has put ${n} point${n === "1" ? "" : "s"} at the bottom of the agenda. Delete the ones you do not want with the cross.`],
  [/^Sorteret af /, "Sorted by "],
  [/^Referatet: (\d+) af (\d+) har godkendt$/, "Summary: $1 of $2 have approved"],
  [/^Saga foreslår det som punkt på dagsordenen til mødet (.+?)\.?$/, "Saga suggests it as an item on the agenda for the meeting $1."],
  [/^Forslag, der stemmes om på det næste bestyrelsesmøde(?: (\(.+?\)))?\. Saga foreslår dem som punkter på dagsordenen\.$/, (_, d) => `Proposals to be voted on at the next board meeting${d ? ` ${d}` : ""}. Saga suggests them as items on the agenda.`],
  [/^Stemmes om på det næste bestyrelsesmøde(?: (\(.+?\)))? - Saga sætter dem på dagsordenen\.$/, (_, d) => `Voted on at the next board meeting${d ? ` ${d}` : ""} - Saga puts them on the agenda.`],
  [/ · stemmes om på næste møde/g, " · voted on at the next meeting"], [/ - Saga sætter det på dagsordenen$/, " - Saga puts it on the agenda"],
  [/ · vedtaget på mødet /g, " · adopted at the meeting "], [/ · ikke vedtaget på mødet /g, " · not adopted at the meeting "], [/ · trukket tilbage /g, " · withdrawn "], [/^Vedtaget på mødet (?=\d)/, "Adopted at the meeting "],
  [/^Stillet af /, "Proposed by "], [/^Vedtaget (?=\d)/, "Adopted "], [/^Aftalt på mødet d\. /, "Agreed at the meeting on "], [/^Aftalt på et møde$/, "Agreed at a meeting"], [/ · frist /g, " · deadline "], [/ · vedtaget ved (\d+) stemmer for/g, " · adopted with $1 votes for"], [/ · afgjort /g, " · decided "],
  [/\b(\d+) for, (\d+) imod, (\d+) undlader sig af (\d+)/g, "$1 for, $2 against, $3 abstain of $4"], [/: imod\b/g, ": against"], [/: undlader\b/g, ": abstain"],
  [/^Du har stemt (for|imod|undlader)\. Du kan ændre din stemme, indtil forslaget er afgjort\.$/, (_, v) => `You voted ${v === "for" ? "for" : v === "imod" ? "against" : "abstain"}. You can change your vote until the proposal is decided.`],
  [/^💬 Ønskes drøftet på et møde af /, "💬 Wished discussed at a meeting by "],
  [/^Stem om: /, "Vote on: "], [/^Forslag fra (.+?) · (?:frist|deadline) /, "Proposal from $1 · deadline "],
  [/^Bestyrelsens beslutninger fra referaterne og de digitale afstemninger\. Et forslag er vedtaget ved flertal: mindst (\d+) af (\S+) stemmer for\.$/,
    (_, n, of) => `The board's decisions from the summaries and the digital votes. A proposal is adopted by a majority: at least ${n} of ${of === "bestyrelsens" ? "the board's" : of} votes for.`],
  [/^Alle har forslaget på deres to-do, til de har stemt\. Vil nogen hellere tage det op på et møde, kan de trykke$/, "Everyone has the proposal on their to-do until they have voted. Would anyone rather raise it at a meeting, they can press"],
  [/^Afgjorte afstemninger \((\d+)\)$/, "Decided votes ($1)"], [/^Besluttet$/, "Decided"],
  [/^Stil et forslag, og bestyrelsen stemmer digitalt\. Ved flertal - mindst (\d+) af (\S+) stemmer for - er forslaget vedtaget\. Alle har forslaget på deres to-do, til de har stemt\. Vil du hellere tage det op på et møde, så tryk$/,
    (_, n, of) => `Make a proposal, and the board votes digitally. With a majority - at least ${n} of ${of === "bestyrelsens" ? "the board's" : of} votes for - the proposal is adopted. Everyone has the proposal on their to-do until they have voted. Would you rather raise it at a meeting, press`],
  [/^- afstemningen fortsætter, og Saga sætter forslaget på sit forslag til næste dagsorden\.$/, "- the vote goes on, and Saga puts the proposal on her suggestion for the next agenda."],
  [/^Du er (.+?) · skift$/, "You are $1 · change"], [/^Logget ind som /, "Logged in as "], [/ · profil og log ud$/, " · profile and log out"], [/ · profil$/, " · profile"],
  [/^og (\d+) punkt(?:er)? mere$/, (_, n) => `and ${n} more point${n === "1" ? "" : "s"}`],
  [/^Klaret de sidste 7 dage \((\d+)\)$/, "Done in the last 7 days ($1)"], [/^Opdateret /, "Updated "], [/^Fra Telegram gruppen$/, "From the Telegram group"], [/^Fra team@$/, "From team@"],
  [/\bventer på dig\b/g, "waiting for you"], [/^(\d+) af (\d+)$/, "$1 of $2"],
  [/^(.+?) · Hjerterum bestyrelse$/, (_, t) => `${translateText(t)} · Hjerterum board`],
  [/^Faste undervisere \((\d+)\) - deres events kræver ikke godkendelse$/, "Regular teachers ($1) - their events need no approval"],
  [/^(\d+) referat(?:er)?$/, (_, n) => `${n} ${n === "1" ? "summary" : "summaries"}`], [/^i restance · (\d+) opsagt$/, "in arrears · $1 cancelled"], [/^i restance$/, "in arrears"], [/^Betaling stoppet$/, "Payment stopped"],
  [/^Opsagt$/, "Cancelled"], [/^Aktiv$/, "Active"], [/^(\d+) medlemmer$/, "$1 members"],
  [/^Hjerterum har haft over ([\d.]+) events siden start\.$/, (_, n) => `Hjerterum has had more than ${n.replace(/\./g, ",")} events since the start.`],
  [/^arrangementer siden (\d{4})$/, (_, year) => `events since ${year}`],
  [/^Det første i kalenderen var i (\S+) (\d{4}) - og huset er fyldt med liv hver uge\.$/, (_, m, y) => `The first in the calendar was in ${MONTH_NAMES_EN[m as string] ?? m} ${y} - and the house is full of life every week.`],
  [/^Ventet (under en time|\d+ (?:time|timer|dag|dage|uger))$/, (_, t) => `Waited ${t.replace("under en time", "under an hour").replace(/timer?$/, m => m === "time" ? "hour" : "hours").replace(/dage?$/, m => m === "dag" ? "day" : "days").replace("uger", "weeks")}`],
  [/^Vis alle (\d+) mails$/, "Show all $1 mails"], [/^Ældre end to uger \((\d+)\)$/, "Older than two weeks ($1)"], [/^Se mailen: /, "See the mail: "],
  [/^Møde (?=\d)/, "Meeting "], [/ · har referat$/, " · has summary"], [/ · fast underviser$/, " · regular teacher"], [/^Fra (?=\d)/, "From "], [/^Skrevet af /, "Written by "],
  [/^Fra MembershipWorks · opdateret (.+)$/, "From MembershipWorks · updated $1"],
  [/^Tallene fra MembershipWorks, senest (.+?)\. Kun tal - aldrig navne eller kontaktoplysninger\.$/, "The figures from MembershipWorks, latest $1. Figures only - never names or contact details."],
  [/^(Standard|Reduceret pris|Generøst|Støtte|Support)( \(.*\))?$/, (_, name, rest = "") => `${({ "Reduceret pris": "Reduced price", "Generøst": "Generous", "Støtte": "Support" } as Record<string, string>)[name] ?? name}${rest.replace(/kr\.\/md\./g, "DKK/month").replace(/kr\.\/år/g, "DKK/year").replace(/ eller /g, " or ")}`],
  [/^Lagt op (.+?) · Skrevet af Saga ud fra mødeoptagelsen$/, "Posted $1 · Written by Saga from the meeting recording"],
  [/^Bestyrelsens referat, overført fra referatdokumentet og stillet op af Saga/, "The board's summaries, transferred from the summary document and laid out by Saga"]
];

/** Saga's chat script: its few fixed messages. */
const SCRIPT: Array<[string, string]> = [...RECORDER_SCRIPT_EN, ["Saga tænker …", "Saga is thinking …"], ["Du er logget ud. Genindlæs siden.", "You are logged out. Reload the page."],
  ["Ingen forbindelse. Prøv igen.", "No connection. Try again."], ["Saga kunne ikke svare lige nu.", "Saga could not answer right now."]];

const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'" })[e]!);
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Requested: "I think that overview, tasks, and decisions should be automatically translated". What the members and
 * Saga write (tasks, to-do's, proposals, decisions) is not in the dictionary: on those pages it is translated with the
 * EU model and kept (translate.ts). `kept` holds those translations; `missing` collects what has none yet. */
export type AutoTranslation = { kept?: Map<string, string>; missing?: Set<string> };

/** Worth sending to the model: real Danish words, not a name, a number, a date or an address. */
export function worthTranslating(text: string): boolean {
  if (text.length < 4 || text.length > 2000 || /^(https?:\/\/|[\w.+-]+@[\w-]+\.)/i.test(text)) return false;
  const words = text.match(/[A-Za-zÆØÅæøå]{2,}/g) ?? [];
  return words.length >= 2 || /[æøåÆØÅ]/.test(text);
}

export function translateText(text: string, auto?: AutoTranslation): string {
  const raw = text.trim();
  if (!raw || !/[A-Za-zÆØÅæøå]/.test(raw)) return text;
  // Pages escape their text; the phrases are plain.
  const escaped = /&(?:amp|lt|gt|quot|#39);/.test(raw);
  const core = escaped ? unescape(raw) : raw;
  const exact = EN[core];
  let out = exact ?? core;
  if (exact === undefined) for (const [pattern, to] of RULES) out = out.replace(pattern, to as never);
  if (out === core && auto) {
    const kept = auto.kept?.get(core);
    if (kept) out = kept;
    else if (worthTranslating(core)) auto.missing?.add(core);
  }
  return out === core ? text : text.replace(raw, () => escaped ? escape(out) : out);
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea"]);

/** The finished page, in English. */
export function translateHtml(html: string, auto?: AutoTranslation): string {
  const out: string[] = [];
  const stack: string[] = [];
  let skipDepth = -1;
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const text = html.slice(last, m.index);
    out.push(skipDepth >= 0 || !text.trim() ? text : translateText(text, auto));
    let tag = m[0];
    const name = (m[1] ?? "").toLowerCase();
    last = re.lastIndex;
    if (!name) { out.push(tag); continue; }
    if (tag.startsWith("</")) {
      const at = stack.lastIndexOf(name);
      if (at >= 0) stack.length = at;
      if (skipDepth >= 0 && stack.length <= skipDepth) skipDepth = -1;
      out.push(tag);
      continue;
    }
    if (skipDepth < 0) {
      tag = tag.replace(/\b(placeholder|aria-label|title|alt)="([^"]*)"/g, (all, attr: string, value: string) => `${attr}="${translateText(value)}"`);
      if (name === "html") tag = tag.replace(/lang="da"/, 'lang="en"');
    }
    out.push(tag);
    if (RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, last);
      let raw = html.slice(last, end < 0 ? html.length : end);
      if (name === "script" && skipDepth < 0) for (const [da, en] of SCRIPT) raw = raw.split(da).join(en);
      out.push(raw);
      last = end < 0 ? html.length : end;
      re.lastIndex = last;
      continue;
    }
    if (VOID.has(name) || tag.endsWith("/>")) continue;
    stack.push(name);
    if (skipDepth < 0 && /\btranslate="no"/.test(tag)) skipDepth = stack.length - 1;
  }
  const rest = html.slice(last);
  out.push(skipDepth >= 0 || !rest.trim() ? rest : translateText(rest, auto));
  return out.join("");
}
