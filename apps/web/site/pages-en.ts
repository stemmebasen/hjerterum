import type { SitePage } from "./pages.js";

/** The English pages: the holistisk.org English section (welcome, events, membership, the room, the team,
 * contact), gathered into four pages that say the same as the Danish ones. */

const DISCLAIMER_EN = `For events that are not arranged directly by Hjerterum, Hjerterum acts solely as mediator and lessor of the premises. Hjerterum is not responsible for content, teaching, advice or other matters in the collaboration between participants and external teachers or organisers. Any agreements, courses or disagreements are a matter between the participant and the third party.

If, at events or activities, individuals are repeatedly experienced as disruptive or as crossing boundaries, you can always contact Hjerterum's board.`;

const SIGNUP_URL_EN = "https://holistisk.org/become-a-member/";

export const SITE_PAGES_EN: SitePage[] = [
  {
    path: "/en", lang: "en", section: "en",
    kicker: "English", title: "Welcome to", em: "Hjerterum",
    lead: "A warm community for meaningful experiences, curiosity and connection – a quiet space in a fast and chaotic world, in the heart of Aarhus.",
    description: "Hjerterum in Aarhus: holistic events, community, membership and a room to rent. Information in English.",
    card: { title: "Welcome to Hjerterum", text: "Information in English." },
    body: `## What is Hjerterum? {#about}
Hjerterum offers holistic events at our centre in Aarhus, Denmark. We often tend to live in our heads and forget about our body, heart and soul. At Hjerterum there is calm and space for deepening, so you can experience the truth in yourself. We honour the wisdom of the heart.

Hjerterum is an invitation to a community where we find joy in creating an inner positive change that resonates in the world around us. We applaud each other's awakening to the truth that we are not separate, but deeply connected.

Let's start by saying what we are **not**:

- Not a place with ready-made answers or quick fixes.
- Not a closed group or sect.
- Not tied to one specific faith, religion or political position.
- Not a place without room for humour and lightness.

**Hjerterum is for everyone.** It is an open and safe space for community, creativity and personal development. You can join many nourishing and meaningful events – talks, concerts, yoga, breathwork, workshops and social events. If you are a teacher or facilitator, you are always welcome to [use our room](/en/rent).

Whether you are looking for peace, inspiration or new acquaintances, you are welcome. Welcome to a place that **gives space to be** ♡

## Events {#events}
Healing, sharing, singing, music, dancing, talks, workshops, yoga, rebirthing, breathwork, meditation, community dinners, film evenings and much more – each with its own approach to getting in touch with the core of who you really are.

{{events}}

Most events can be booked right here. If you can't sign up for an event, it is full, or registration happens elsewhere (e.g. by email or on the organiser's own website). Do you have a good idea for an event? Write to [events@holistisk.org](mailto:events@holistisk.org).

### Hjerterum Open {#hjerterum-open}
Hjerterum Open are events created and organised by Hjerterum itself – concerts, talks, community dinners, dance, meditation, themed evenings and more – to strengthen and bring the community together, to invite new people in, and to create collaboration across the house. They are open to members and non-members, often free or reduced for members; prices for non-members are set event by event, and some events are free for everyone. Ideas are very welcome at [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org).

+++ Photography and video policy
**Ask before filming and photographing – and respect a no.**

At Hjerterum we generally don't take out our phones to film or photograph. If you still want to, you need clear and explicit consent from everyone involved, and you tell them what the material will be used for. You always have the right to withdraw your consent and ask for pictures or videos you appear in to be deleted.

At concert evenings, pictures and videos that capture the atmosphere may be taken. If individuals are clearly recognisable, you always ask first – and of course respect a no. At Hjerterum we look after each other's safety, privacy and trust – also digitally.
+++

+++ Disclaimer
${DISCLAIMER_EN}
+++

## Contact {#contact}
**Hjerterum**, Guldsmedgade 26B, ground floor, 8000 Aarhus C. Would you like to see the place? Schedule a visit by email.

Write to us with the form, or to one of the addresses below.

{{enquiry-generel}}

- **Membership and bookings:** Team Hjerterum – [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org)
- **Accounting:** the treasurer – [regnskab@holistisk.org](mailto:regnskab@holistisk.org)
- **Other enquiries:** Jacob Hauge, chair – [jh@holistisk.org](mailto:jh@holistisk.org)

Please write only once – with the form or to one of the addresses; you can expect an answer within 3–5 working days. Teachers in an emergency: see the [communication policy](/en/rent#communication). The team cannot be contacted via private Messenger or text messages.

**Payment:** MobilePay 734388 · Djursland Bank, reg. no. 7268, account no. 1211404 · Hjerterum F.M.B.A., CVR 40827692.

**Parking:** free on Sundays and public holidays in Aarhus Municipality, and 2 hours free in the yellow zone. We recommend Kirkegårdsvej, which often has space during the day – a 10–15 minute walk. See [Aarhus Municipality](https://aarhus.dk/borger/trafik-og-parkering/parkering) for rules and zones. Unfortunately Hjerterum is not accessible for wheelchair users: there are 5 steps up to the front door and no room for a wheelchair in the toilet. There is a disabled parking bay in front of the main entrance.

When you use Hjerterum, you are responsible for any damage to yourself or your belongings.

{{newsletter}}`,
    image: { src: "/media/2021-06-p1010197.webp", alt: "Chairs in a circle around a candle in the room" },
    children: ["/en/membership", "/en/rent", "/en/team"],
    sources: ["welcome", "vision-en", "events-en", "contact-us"]
  },
  {
    path: "/en/membership", lang: "en", section: "en",
    kicker: "English · Membership", title: "Become part", em: "of Hjerterum",
    lead: "Choose the membership that suits you – and join a community built on presence and human warmth.",
    description: "Membership of Hjerterum in Aarhus: prices, benefits, terms and donations.",
    card: { title: "Membership", text: "Prices, benefits, terms and donations." },
    body: `> **30-day free trial.** If you sign up by 15 October 2026 and have not been a member before, the first 30 days are free. If you cancel before the trial ends, you will not be charged anything.

{{membership-plans}}

## How to join {#join}
For now, you sign up in our membership system on holistisk.org: [become a member here](${SIGNUP_URL_EN}). Already a member? [Log in](/sign-in) to see your membership.

The **reduced price** (111 DKK a month or 1,155 DKK a year) is for you on a low income – e.g. SU or social benefits, or a net salary below 11,000 DKK a month. Please upgrade to the standard price if your income rises above the limit.

## Benefits of membership {#benefits}
- You join events at a discount and often completely free.
- You regularly get offers on Hjerterum's own events – concerts, talks, themed evenings, community dinners, film evenings and more – as part of [Hjerterum Open](/en#hjerterum-open).
- It is easier to sign up for events when you are logged in.
- You get a discount on organic speciality coffee, other speciality drinks and biodynamic cake and snacks in the café every Thursday afternoon and at other events.
- You get offers on events with Hjerterum's partners in Aarhus and East Jutland.
- You can take part in the association with contributions, ideas and wishes.
- You support Hjerterum financially, so together we can keep living the vision of a heart space for healing, connectedness and inner peace.

## Terms of membership {#terms}
- **Agreement:** the terms apply between you and Hjerterum F.M.B.A. The membership is personal and cannot be transferred or shared.
- **Payment:** we accept Dankort/Visa-Dankort, Visa, Visa Electron and Mastercard. The first payment is drawn when you join; after that the price is drawn automatically the day before each new period. You are responsible for a valid card being registered.
- **Receipt:** after joining you get a confirmation email with all information about your membership.
- **Validity:** the membership is valid from the day you join until it is cancelled.
- **Cancellation or pause:** write to [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org).
- **Binding period:** the current month + 1 month – you pay once more after cancelling. If a card payment fails, you remain a member until you cancel and are expected to continue paying.
- **Free trial:** a free trial can only be used once. To rejoin, log in to your account and update your payment details.
- **Your data:** we keep your account information for at most 2 years for statistical purposes.

## Donations {#donations}
Donations – together with membership fees and renting out the room – are what keep Hjerterum running. Every donation, big or small, is received with great gratitude: MobilePay 734388, or for amounts over 1,000 DKK a bank transfer to Djursland Bank, reg. no. 7268, account no. 1211404. Thank you from the team behind the scenes ♡`,
    sources: ["become-a-member", "benefits-of-membership", "conditions-of-membership", "donations"]
  },
  {
    path: "/en/rent", lang: "en", section: "en",
    kicker: "English · Rent the room", title: "A room for what", em: "you want to create",
    lead: "Rent our beautiful room of about 110 m² for your workshop, talk or course – from early morning until late evening, every day of the week.",
    description: "Rent Hjerterum's room in Aarhus C: facilities, prices, booking, practical information, terms and marketing.",
    card: { title: "Rent the room", text: "Facilities, prices, booking and practical information." },
    body: `## The room {#room}
When you book your event with us, you get an inspiring room – and you become part of a large and engaged community in East Jutland: your event is shown on our website and Facebook page, reaching our many members and followers. As organiser you plan and run your event yourself, including setting up and tidying, but our volunteers are happy to lend a hand.

**Facilities:** a room of about 110 m² · a fully equipped kitchen with tableware for 40 · 2 toilets · 20 yoga mats, 22 mattresses, 16 meditation chairs and 20 yoga blocks · cushions and blankets · chairs for 40 and 8 tables · sound system with mixer, mini-jack and Bluetooth, a hi-fi and a Bluetooth speaker · projector with HDMI · wifi.

## Prices {#prices}
All prices include VAT.

**A) Standard price – no member discount.** A fixed price by length: 2 h 720 DKK · 3 h 1,080 · 4 h 1,380 · 5 h 1,680 · 6 h 1,920 · 7 h 2,160 · 8 h 2,340 · 9 h 2,520 · 10 h 2,700 DKK.

> **Members only:** B) Reduced price – with member discount and C) Free rental require that you are a paying member of Hjerterum yourself. In those cases you create your event yourself on the [member site](https://medlem.hjerterum.info/member-portal/events).

**B) Reduced price – with member discount**, for events where members pay less than non-members:

| | B-time: weekdays before 18:30 | A-time: weekdays after 18:30 and weekends |
|---|---|---|
| Base price incl. the first 2 hours | 150 DKK | 400 DKK |
| Each extra hour | 75 DKK | 150 DKK |
| Minimum member discount | 50 DKK | 100 DKK |

For a period we offer 25% off the A-time prices – you'll see it in the calculator.

**C) Free rental**, for events where Hjerterum charges nothing for the room. Members attend for free; non-members pay at least 150 DKK in A-time or 75 DKK in B-time. To use free rental you must be a paying member yourself, and you create your event yourself on the member site.

**Rules:** with a member discount or free rental a booking cannot cross 18:30 on a weekday · minimum 2 and maximum 10 hours · set-up and tidying must be within the booked time (we recommend 30 minutes before and after).

{{price-calculator}}

## How to book {#booking}
Use the [price calculator with the booking form](/beregner) and send us: the title; the event text (purpose, programme and a little about you); prices for members and non-members and how participants pay; how people sign up (via Hjerterum's website or directly with you); date suggestions (check the [calendar](/en#events)); start and end times of both the event and the booking; a cover image (royalty-free, preferably not AI-generated, 1920 × 1005 px, jpg or png) and any links.

Once the booking is agreed, we send you an invoice, and we create your event once it is paid. If you have a Facebook business page, create the event there first and send us the link. Plan 4–8 weeks ahead; we need up to about 5 working days once we have all material. Promoting your event is your responsibility – see [marketing](#marketing).

## Practical information {#practical}
- **Keys:** two key sets hang in a small key box on the outer wall by the iron gates on Guldsmedgade. A set has a green chip for the gate and basement door and a key for the front door and the padlock of the inner basement door. You get the key-box code by email. Hold the chip in front of the black device under the key box; when it turns green, turn it clockwise and the gate opens. **Return the keys to the key box after your event.**
- **Door phone:** guests ring at the gate on Guldsmedgade; let them in from the door phone in the hallway with the key icon. If the bottom bell button is red, the sound is off – press it to turn it on.
- **Kitchen:** fridge, freezer, oven, 2 hotplates and a kettle. Bring your own tea and coffee, and leave the kitchen as you found it.
- **Sound:** mini-jack and Bluetooth (bring an adapter if needed). [Watch the video on setting up the sound system](https://www.youtube.com/watch?v=m-L0wmaNCf4). Keep windows and door closed for loud music or drums, and air out in the breaks – out of consideration for the neighbours.
- **Projector:** an HDMI cable hangs from the projector on the pillar; bring an adapter if needed. The remote lives in the pillar's "V".
- **Wifi:** network and password come with your booking – or ask us.
- **Cleaning:** vacuum the room, put chairs and mats back behind the curtain, fold cushions and blankets onto the shelf, return borrowed items, air out; do the dishes or start the dishwasher if more than half full (always if you have the last booking of the day); tidy the kitchen; wipe sinks and toilets as needed; empty bins when half full. Cleaning supplies are in the hallway by the toilets; rubbish goes in the container behind the wooden gate at the end of the building or on Guldsmedgade. If cleaning is not done, we charge a cleaning fee of 250 DKK.
- **Courtyard:** we share it with neighbours – keep participants near Hjerterum's door, avoid long breaks and noise; short 10-minute breaks are fine.

## Terms for renting {#conditions}
### Payment {#payment}
Once a booking is agreed, we email you an invoice; your event is created when it is paid. Questions: [regnskab@holistisk.org](mailto:regnskab@holistisk.org).

### Cancellation {#cancellation}
Hjerterum always keeps the base price to cover administration (for courses and recurring events only one base price). On weekdays you get 100% of the remaining amount back when cancelling 4 weeks before, 50% at 3 weeks; for weekends and courses 100% at 8 weeks and 50% at 6 weeks. A last-minute cancellation costs a 250 DKK fee unless you cancel by 14:00 the day before. If you are prevented at the last minute, you may cancel the event yourself to avoid the fee – only for last-minute cancellations – and always email [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org). [See the cancellation guide](https://docs.google.com/document/d/1Z_eatceSFqqgWLqFq0AEqWP2fce0wayFvvHKr3YZWzA/edit?usp=sharing).

## Communication {#communication}
Email is the first channel: always write to [hjerterum@holistisk.org](mailto:hjerterum@holistisk.org) first. [Hjerterum's Messenger page](https://www.facebook.com/share/1BNdSQTGWU/?mibextid=wwXIfr) is for PR material for events already created and for urgent matters – include your phone number and we'll call you back. Board members are often in the café on Thursday afternoons. Please don't send private Messenger messages to board members or call or text their private numbers – shared channels mean nothing gets lost.

## Your events {#your-events}
Log in to the [member area](/member-portal/events) and choose **My events** to see sign-ups, edit or cancel. Events in the former calendar on holistisk.org are still managed there ([video guide](https://www.youtube.com/watch?v=aKVv_aVjuTA)).

## Marketing {#marketing}
Your event is published on our website and on our Facebook page with more than 6,000 followers. Beyond that, promoting it is up to you – e.g. Facebook ads, inviting your network and sharing in relevant groups (read each group's rules first): [Events in Aarhus](https://www.facebook.com/groups/281989928869750), [Aarhus Events Community](https://www.facebook.com/groups/1972770316279876), [Spiritual Events in Denmark](https://www.facebook.com/groups/spiritualseventsindenmark), and the Danish groups on [our list](/brug-hjerterum/markedsfoering).

+++ Disclaimer
${DISCLAIMER_EN}
+++`,
    sources: ["use-hjerterum", "price-list", "book-your-event", "guidelines-for-teachers", "conditions-for-renting-the-room", "marketing-of-your-event", "managing-your-event", "pay-your-invoice"]
  },
  {
    path: "/en/team", lang: "en", section: "en",
    kicker: "English · The team", title: "The people", em: "behind Hjerterum",
    lead: "The Hjerterum association is led by a team of dedicated people who also make up the board.",
    description: "The board and team behind Hjerterum in Aarhus, and how we work.",
    card: { title: "The team", text: "The board and how we work." },
    body: `![The board of Hjerterum](/media/2025-12-pcgo-hdy.webp "From left: Gitta Kaas, Douglas Crawford, Jacob Hauge (chair), Frederik Kærgaard (treasurer) and Lisbeth Jespersen (vice-chair).")

## The board
- **Jacob Hauge** – founder, chair and team leader (volunteer)
- **Lisbeth Jespersen** – vice-chair (employed 8 hours a week): bookings with new teachers, general enquiries, sign-ups and cancellations.
- **Frederik Kærgaard** – treasurer (employed 5 hours a week): finance, invoicing etc.
- **Gitta Kaas** – (employed 5 hours a week): social media, PR and bookings with regular teachers.
- **Douglas Crawford** – board member (volunteer): membership system, website, maintenance and café.

Our employees rarely stop at their scheduled hours – they often add volunteer time because they care about Hjerterum and the community.

We have deliberately chosen a flat structure: employees and volunteers share responsibility, and there is no traditional boss. Hjerterum runs on fewer working hours than before, so teachers and organisers do more of the preparation themselves. If you write to us, expect an answer within 3–5 working days. When booking, have concrete dates and times, your text and cover image ready, follow the guides we send, and check the website first. Our shared goal: that Hjerterum is led professionally and with heart ♥`,
    sources: ["team"]
  }
];
