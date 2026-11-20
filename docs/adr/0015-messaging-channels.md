# ADR 0015 — Messaging channels: photographs come in through an outbound long poll, on a generic core

## Status

Accepted.

## Date

2026-11-19

## Context

The group of a party already exists, almost always, in a messaging app, and that is where the photographs are posted
anyway. Spec 27 lets a Telegram group send its photographs and films to an event: the host adds the bot to the group and
types `/soiree CODE`. Telegram is the only messaging app that allows a bot in an ordinary group, officially and for free,
and it will be little used in France. It is built first because it forces the **core** a later WhatsApp channel will need:
the link from a conversation to an event, a guest per sender, a queue of media, a notice, an erasure. The decisions below
are the ones a later reader would otherwise reopen.

Spec 27 carries the whole argument; this record keeps the choices whose reasons are not visible in the code.

## Decision

1. **The core is generic, the adapter is Telegram's.** `src/domain/channels/` speaks of a conversation, a sender and a
   media, never of a chat or an update. An adapter translates each update into exactly one `InboundMessage` (a command, a
   media, a conversation that moved, a bot that was removed, or `ignored`), and the use cases never learn what it looked
   like. The channel name is a column with **no SQL `CHECK`**: adding `whatsapp` is one value and one adapter, not a table
   rebuild; a stored value is parsed with `parseChannelKind` when it is read.
2. **The box calls Telegram; Telegram never calls the box.** The bot receives its updates by **long polling**
   (`getUpdates`), an outbound connection that is opened only when `TELEGRAM_BOT_TOKEN` is set. A webhook would be a public
   write endpoint, which `docs/ROADMAP.md` refuses; the polling opens none, so that line stays true. Without a token there
   is no poller, no worker and no outbound connection. `docs/SECURITY.md` and `compose.yaml`, which say "nothing leaves
   the box", will say (PR 4 updates them) "nothing leaves the box unless the operator sets a bot token".
3. **A binding keeps the event, never the join code.** The code rotates and the old one stops at once; a link that kept
   it would break on the evening a host rotates it. One active binding per conversation (a partial unique index holds it),
   a conversation points to one event, and a conversation already linked to another event that is still live is refused
   rather than silently moved: the host of that event did not agree to lose their group.
4. **A sender becomes a guest without a cookie, and is stored as a fingerprint.** The key is
   `HMAC(key derived from GUEST_TOKEN_SECRET, channel:eventId:senderRef)`: no new secret, and a copy of the database does not
   contain a Telegram account number, and the same person has a different key at each event, so rows of two events cannot be linked. The guest carries the first name and the initial of the last (`Léa M.`), nothing
   else: no number, no handle, no text.
5. **Receiving is fast and replayable; downloading is a queue.** `receiveChannelMessage` stores a job and answers; a
   worker, one media at a time, downloads, stores and acknowledges. A job is unique per (channel, conversation,
   message), so an update delivered twice is taken once, and the cursor of `getUpdates` is saved **after** the work, so a
   crash replays rather than loses.
6. **The words of the group are read and thrown away.** Telegram sends every message to the bot. Text that is not a
   command is dropped by the adapter before it becomes a domain value, and nothing of it is stored or logged.
7. **The token is in every URL, so no URL is ever shown.** Errors from the client are rebuilt (`telegram.unreachable`,
   `telegram.rejected` and a numeric code) and never propagated as they came; a test proves the token is absent from
   everything the adapter can render.
8. **The channel has the same two gates as a clip**: the host's switch (`allowTelegram`) and the client's ceiling
   (`channelsAllowed`, off for a new client unless the operator says otherwise). Moderation stays the event's own mode: a
   photograph from the group is pending or published exactly like one from a phone.
9. **Erasure is the existing erasure.** `/oublier` is `eraseGuestContribution` plus the deletion of the sender's queued jobs (`deleteBySender`), so a media posted
   a second earlier is not stored a second after; every new table cascades from `events`.

## Consequences

### Positive

- A group's photographs reach moderation, the wall, the album, the ZIP, the book and the reel through the one path every
  other photograph takes: no second pipeline to keep consistent.
- A WhatsApp channel later is an inbox and a sending adapter on a core that does not change.
- No public surface is added: no route, no webhook, no secret to sign.

### Negative

- The first outbound connection of the product, and a secret (the token) that, if it leaks, lets anyone act as the bot.
  Mitigated by the rules above, not removed.
- One token is one instance: two boxes polling with the same token fight (Telegram answers 409), and the adapter backs off
  and says so rather than stopping the server.
- Telegram's public API lets a bot download files up to 20 MB: a longer video stays in the group.
- The bot sees a group's photographs only if it is an administrator or its privacy mode is off; the panel and the guide say
  so, and nothing can lift it from our side.

### Neutral

- Only the refusals of a media are rationed in memory (one per conversation, sender and reason per hour); commands are always
  answered. A restart forgets the ration, which only lets the bot speak once more.
- A video longer than a clip keeps its first seconds instead of being refused.
- The host's "photos received" counter of a binding is not decremented by `/oublier` (it counts what arrived, not what is still
  there), and the conversation title is kept until the event purge, since it is the host's own label for the group.
- A document declared `video/*` with no duration is **not** trimmed (a trim past the end of a short source fails with
  `clip.trimOutOfRange`). The clip pipeline decides: if it refuses it as `clip.tooLong` while the duration was unknown, the
  drain treats it as a permanent failure and says "too long" in the conversation.

## Alternatives considered

- **A webhook**: lower latency and no long connection, but a public endpoint to authenticate and a change to a line the
  roadmap holds. Out of scope; a later channel that needs it revises the line then.
- **A Telegram library**: the Bot API used here is five calls over `fetch`, and the precedent is "by hand, no dependency"
  (`magicBytes.ts`). A library would also be one more thing that logs a URL.
- **One table per channel**: a WhatsApp channel would copy it. One generic table with a free channel column is the cheaper
  shape.
- **Storing the sender's Telegram id in clear**: it is personal data and a way to find a person on the network; the
  fingerprint does the job.
- **Moving a conversation silently to the newer event**: it takes a group from a host who did not agree. The refusal is
  explicit and the host can unlink.
- **Taking the caption of a Telegram photograph as its caption**: not now; a group's banter is not a caption.

## Related

- Spec 27 (`canal-telegram`); the study `whatsapp-faisabilite-2026-11-19` it comes from.
- ADR 0007 (the hosted instance), `docs/SECURITY.md` ("Outbound connections"), `docs/ROADMAP.md` (the public write API
  line the long poll leaves true).
- `src/domain/channels/`, `src/application/usecases/channels/`, `src/infrastructure/channels/telegram/`.
