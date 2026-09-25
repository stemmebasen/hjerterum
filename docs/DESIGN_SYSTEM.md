# Hjerterum visual design contract

## Purpose

Hjerterum must keep a recognisable, coherent aesthetic across migrations, new features and future pages. The current Hjerterum experience is the visual reference. Technical architecture changes must not silently become visual redesigns.

## Design authority

Until an explicit redesign is approved, use the existing Hjerterum/member-portal look and feel as the reference for:
- warmth and softness
- spacing rhythm
- typography hierarchy
- colour relationships
- border radii and card treatment
- navigation density
- content tone and section pacing
- mobile behaviour

Do not introduce a generic SaaS/dashboard aesthetic, developer-facing status language or visually unrelated page styles.

## Core visual language

### Colours
Use a warm, muted palette built from:
- cream/off-white backgrounds
- dusty rose/blush
- soft lavender
- pale sage
- apricot/sand
- warm brown accents
- dark warm charcoal for text

Avoid cold blue-grey UI palettes, bright primary colours and high-contrast enterprise dashboard styling unless required for accessibility or state feedback.

### Typography
- Editorial/serif feel for large display headings.
- Neutral sans-serif for navigation, labels, body copy and functional UI.
- Large headlines with generous whitespace.
- Small uppercase kickers/eyebrows used sparingly.
- Functional UI should remain readable and calm, not overly condensed.

### Shape and surface
- Generous rounded corners.
- Soft, lightly tinted surfaces rather than hard white cards everywhere.
- Minimal borders and very restrained shadows.
- Organic/asymmetric decorative shapes are allowed when they support the Hjerterum feeling.
- Avoid glassmorphism, neon effects, heavy gradients, hard dashboard grids and obvious AI-product visual tropes.

### Layout
- Content should breathe.
- Prefer larger editorial sections over dense control panels.
- Use alternating soft colour fields to create rhythm.
- Member/admin functionality may be more structured, but must still feel like Hjerterum rather than a separate software product.

## Content tone

The product voice should be warm, simple and grounded. Avoid technical implementation language in the user-facing UI. Words such as Cloudflare, D1, GitHub, runtime, migration, staging and Replit belong in development/admin diagnostics, not in public/member-facing copy.

## Component rule

New pages and flows should reuse shared design primitives rather than inventing new local styles. At minimum keep shared patterns for:
- site header/navigation
- buttons and text links
- section headings
- cards/panels
- event listings
- membership status
- forms
- empty states
- alerts/notices
- mobile navigation

If a new component needs a different visual treatment, the difference should be deliberate and documented.

## Visual parity workflow

For any significant migration or redesign:
1. Capture reference screenshots from the current approved Hjerterum experience at desktop and mobile widths.
2. Rebuild using shared tokens/components, not page-specific one-off styling.
3. Compare the new result side-by-side with the reference before considering the page finished.
4. Once approved, save the new screenshots as visual baselines.
5. Add automated screenshot regression tests for the most important pages and breakpoints when practical.

Initial visual baseline pages should include:
- public home
- member portal/dashboard
- calendar
- profile/contact
- login/sign-up
- event/room booking flow

Recommended viewport baselines:
- desktop: 1440px wide
- tablet: 820px wide
- mobile: 390px wide

## Migration rule

Architecture may change aggressively. Visual identity should not drift accidentally.

A migration is not considered visually complete merely because the new page is functional. Functional parity and visual/content parity are separate acceptance criteria.

## Current implementation

The shared CSS tokens and components in `apps/web/src/styles.css` and `apps/web/src/main.tsx` are the first implementation of this contract. They should be refined against approved reference screenshots rather than replaced ad hoc.

## Approved profile direction — 2026-09-25

The user approved the interactive profile proposal, including colours and typography.
The approved direction applies to all public, member and admin routes. Shared root tokens govern typography, surfaces, controls and system dark appearance.

- Georgia headings, Arial functional copy.
- Light palette: background #f1eee8, opaque surface #fffdfa, ink #292723, muted #716b62, warm brown action #58483d, sage #e4eadc, clay #eee0d5.
- System dark appearance: background #24231f, surface #302e29, ink #f3eee4, muted #c3bbb0, action #dfc9b7.
- Rounded 20–24px opaque cards, restrained borders, no decorative shadows.
- Private membership information collapses into its own editable section.
- Two independent cards introduce the public teacher/practitioner visit card and the private CIRKLER profile.
- Public profiles support private saved drafts, preview, explicit consent to publication, and hiding. Saving a draft never changes the published snapshot. The public directory uses the same card renderer as preview and includes only profiles with currently eligible, unblocked membership. Offering teaching/treatment does not change booking rights or internal teacher status.
- Publication is opt-in; private contact/payment data and CIRKLER data never enter the directory. Existing authenticated owners can still read and hide their profile after membership ends. Concurrent edits require reloading the saved version.
- CIRKLER starts with a detailed profile and explicit enrolment confirmation in its own system at the joint launch. The current Hjerterum introduction shows the planned steps and launch availability; it does not collect or claim to save CIRKLER information.


## Shared site and original content rollout — 2026-09-25

The user explicitly requested the same design everywhere and the original website's content first, with editorial cleanup later.

- All event listings use EventCard, including public home, public calendar and member calendar. Public calendar lists all returned upcoming events by month; home shows six.
- Public and member actions retain their own access checks and registration routes.
- Public navigation retains the old Sal, membership, about and English destinations.
- legacy-content.json contains 35 public article bodies from holistisk.org. Text, images, headings, lists, disclosures and document links are retained; old inline presentation and executable widgets are not.
- Only allowlisted static HTML is rendered. Script/style/event handlers/forms/iframes are stripped; interactive legacy services and videos have explicit external links. No old widget is represented as a native working feature.
- Internal links point to migrated routes; event fragment links and unmatched documents retain their original destinations.
- Existing source copy, including policies, fees and offers, is an imported snapshot, not a change to application eligibility, moderation, billing, trials or payment logic.
- WiFi credentials are not copied into the public repository; instructions refer users to Hjerterum. Public newsletter links omit subscriber tracking IDs.
- Content is checked into GitHub rather than fetched and executed from WordPress at runtime. Original images and PDF documents remain hosted at holistisk.org.
