# Saga, the board's assistant in Telegram

Status: Accepted — 2026-09-23 · amended 2026-10-03 (see "Amendments")

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

## Security

- The webhook (`POST /api/saga/telegram`) requires Telegram's `X-Telegram-Bot-Api-Secret-Token` header, compared in constant time. It answers 200 at once and continues the slow work with `waitUntil`.
- Tokens only go to their own hosts (Telegram, ElevenLabs, the configured AI endpoint, Google).
- Drive uses a service account. It sees and changes only the folders the chair shares with it.

## Configuration

Secrets: `SAGA_TELEGRAM_BOT_TOKEN`, `SAGA_TELEGRAM_WEBHOOK_SECRET`, `SAGA_LIVA_SECRET`, `AI_API_KEY`, `ELEVENLABS_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`.
Variables: `SAGA_TELEGRAM_BOT_USERNAME`, `SAGA_BOARD_CHAT_ID`, `SAGA_OWNER_TELEGRAM_ID`, `AI_BASE_URL` (OpenAI-compatible, default OpenAI), `AI_MODEL`, `GOOGLE_DRIVE_RECORDINGS_FOLDER_ID`, `GOOGLE_DRIVE_MINUTES_FOLDER_ID`.

Until the bot token and owner are set, Saga does nothing. The bot needs privacy mode turned off in BotFather to see the group's messages.

## Later

Answers from Drive documents (statutes, budgets), the chair's Hjerterum mail, and the platform's members, events and bookings (read first; any action only with approval).

## Amendments (2026-10-03)

The decision stands, with these changes made at the chair's request (details in BLUEPRINT, the checkpoint of 2026-10-03):

- **The board cockpit** (`admin.hjerterum.info`) is where the board works with Saga's output: minutes, meetings, tasks, decisions and votes, Posthus, events and members. Members log in with a personal link from Saga.
- **Minutes go up at once.** They no longer wait for the chair's approval. Every member signs off or corrects per point in the cockpit, and the chair can still correct by replying in Telegram. The group stays silent unless `SAGA_MINUTES_PING` is on.
- **team@ is read by Hjerterum itself** over IMAP (read-only, every relevant folder, password sealed). It is no longer relayed from Matrix (`POST /api/saga/liva/mail` is kept for compatibility, and an outside status report is ignored once Hjerterum reads the mailbox). Saga checks whether a mail was answered before calling it unanswered.
- **Liva asks Saga.** Besides reading the overview, Liva may ask Saga on the chair's behalf (`POST /api/saga/liva/ask`).
- **The AI route is EU-only:** Claude Sonnet 5.5 through Requesty's EU router on Vertex AI EU.
- **Saga may change the asker's own cockpit list when asked.** She never changes what concerns others or the whole association.
