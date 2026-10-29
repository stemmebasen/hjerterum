# Saga, the board's assistant in Telegram

Status: Accepted — 2026-09-23

## Decision

Saga is a Telegram bot in the board's group chat. She keeps the board's messages, drafts minutes from meeting recordings and writes a weekly summary. Liva, the chair's assistant in Matrix, reads what is going on through a read-only endpoint.

**Nothing is posted to the board chat without the chair's approval.** Every post (a reply, the weekly summary, the decisions and tasks from approved minutes) is saved as a pending draft and sent privately to the chair with Godkend/Afvis buttons. Replying to that message revises the draft. A draft is decided exactly once, so a double tap cannot post twice.

## Listening only (the default)

Requested by the chair: "Jeg vil ikke have hun interagerer i gruppen." Unless `SAGA_BOARD_POSTING` is `on`, Saga only reads the board group. A question to her there is just part of the chat. The weekly summary goes to the chair privately, and approved minutes are saved on Drive (or kept as the file he already has) without being shared in the group. Everything below about posting applies only when posting is switched on.

## The board's minutes document

The board keeps all minutes and decisions in one Google Doc (`GOOGLE_MINUTES_DOC_ID`), shared with Saga's service account as editor. Saga reads it (exported as text, trimmed to its start and newest end) for her private answers and as background for new minutes. When the chair approves minutes, she appends them at the end, with the title as a heading and nothing above it touched. This replaces a new Doc per meeting and avoids service-account file ownership.

## Hjerterum's mailbox (team@holistisk.org)

Requested: "Saga can use it to read the temperature and let me know if something demands my attention", without it appearing in Posthus or Samtaler. Matrix reads the mailbox over IMAP in its own, separate mailbox (never the chair's) and relays new mail to `POST /api/saga/liva/mail` (bearer `SAGA_LIVA_SECRET`). Saga stores each mail once (`board_mail`), judges it (attention / fyi / ignore) and sends the chair one Telegram message per batch with only what demands his attention. A mail she cannot judge is shown to him rather than dropped. The mail is part of her private answers, the weekly summary and Matrix' Hjerterum page. She never replies to it.

## Behaviour

- **Board chat.** Every text message is stored (`board_messages`). A message that mentions `@<bot>`, replies to Saga, or names "Saga" in a question gets a drafted answer for approval, as a reply to the question.
- **Private chat.** Only the chair (`SAGA_OWNER_TELEGRAM_ID`) is answered; everyone else is ignored, and only the chair's approvals count. The chair can ask questions about the board's chat and minutes, request `/opsummering`, and send recordings.
- **Minutes.** A recording comes from the chair's private chat (Telegram lets a bot download at most 20 MB) or the Drive recordings folder (polled every five minutes, each file once). ElevenLabs Scribe transcribes it in Danish with speakers told apart, and the AI drafts the minutes: attendees, items with discussion and decision, decisions, tasks (who, what, when) and next meeting. The draft goes to the chair as a file. When it is approved it is saved as a Google Doc in the minutes folder, and the title, decisions, tasks and link are posted to the board. Without Drive, the file is attached instead. A failing recording is retried up to three times, and then the chair is told why.
- **Weekly summary.** On Sunday between 18 and 19 Copenhagen time, once per week (`job_claims`), if the board wrote anything that week.
- **Liva.** `GET /api/saga/liva/overview?days=N` with `Authorization: Bearer <SAGA_LIVA_SECRET>` returns recent messages, the latest minutes' decisions and tasks, and the number of pending approvals.
- **Brief for Matrix' front page.** `GET /api/saga/liva/brief` (same bearer secret, `worker/saga/brief.ts`; Matrix fetches it on weekdays at 09, 12 and 16 Copenhagen time and on Opdatér) answers `{ at, lead?, items[] }`: at most ten points, each `weight` `must` (the chair must act: minutes or posts awaiting his yes, a vote whose deadline is within three days, minutes to sign off that are under two weeks old, a member event starting within three days), `should` (soon: a more distant vote, an agenda missing three days before a meeting, a past meeting with no recording or minutes registered, a recording that failed or stalled, important mails in team@ unanswered for more than three days, a stopped mail watch, a failing AI), or `fyi` (the next meeting within a week; a part Saga could not read). `lead` is Saga's own one- or two-sentence line from `board_now` when it is under 36 hours old. Only what Saga's own data shows: the chair's tasks are not repeated (they are on Matrix' list through `chair-tasks`), team@ is only counted (no sender, subject or text), and nothing names Matrix. Targets are `hjerterum` and `cockpit:<path>` with the admin's own paths (`beslutninger`, `referat/<id>`, `moder/<id>`, `posthus`, `arrangementer`). A quiet day is an empty list. Every part is read on its own with an 8-second limit, so one slow or failing part cannot hold up or break the rest. The brief is not cached: it is a handful of D1 queries.

## Security

- The webhook (`POST /api/saga/telegram`) requires Telegram's `X-Telegram-Bot-Api-Secret-Token` header, compared in constant time. It answers 200 at once and continues the slow work with `waitUntil`.
- Tokens only go to their own hosts (Telegram, ElevenLabs, the configured AI endpoint, Google).
- Drive uses a service account. It sees and changes only the folders the chair shares with it.

## Configuration

Secrets: `SAGA_TELEGRAM_BOT_TOKEN`, `SAGA_TELEGRAM_WEBHOOK_SECRET`, `SAGA_LIVA_SECRET`, `AI_API_KEY`, `ELEVENLABS_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`.
Variables: `SAGA_TELEGRAM_BOT_USERNAME`, `SAGA_BOARD_CHAT_ID`, `SAGA_DEPUTY_CHAT_ID` (optional: the deputies' group - see `cockpit/deputies.ts`; without it there are no deputy logins), `SAGA_OWNER_TELEGRAM_ID`, `AI_BASE_URL` (OpenAI-compatible, default OpenAI), `AI_MODEL`, `GOOGLE_DRIVE_RECORDINGS_FOLDER_ID`, `GOOGLE_DRIVE_MINUTES_FOLDER_ID`.

Until the bot token and owner are set, Saga does nothing. The bot needs privacy mode turned off in BotFather to see the group's messages.

## Later

Answers from Drive documents (statutes, budgets), the chair's Hjerterum mail, and the platform's members, events and bookings (read first; any action only with approval).
