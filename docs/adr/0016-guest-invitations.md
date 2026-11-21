# ADR 0016 — Guest invitations: a link the host can show again, so its token is stored in the clear

## Status

Accepted (the token decision; the image dependency is added by a later pull request of spec 29, which completes this record).

## Date

2026-11-21

## Context

Spec 29 lets a host invite guests before the party: a title, a moment, a place and a word, sent by e-mail from the
host's own mailbox, printed on a card, or shared as an image. All three carry the same link and the same QR code,
`/i/<token>`, and the page behind it becomes the way into the wall on the evening. The host fills the invitation in
once, weeks before, and comes back to it: to reprint a card, to share the link from another phone, to switch it off.

Two credentials already exist in the product and neither fits. The **join code** rotates and the old one stops at once,
so a QR printed three weeks before cannot carry it. The **gallery token** is kept only as its SHA-256 and is shown once
(`shareLink.ts`), which is right for a link that hands out originals and wrong for a link the host must be able to read
again. The decision below is the one a later reader would otherwise reopen.

## Decision

1. **The token is stored in the clear**, in `guest_invites.token` (unique). A digest cannot give the link back, and the
   host's right to see it again is the feature. It is a bearer credential of the same standing as the join code, which is
   also stored in the clear, and it is protected the same way: a refusal that is one neutral `404` for every cause, a
   per-IP limiter, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`, and the token
   **masked in the logs** (`/i` and `/api/i` join the token-bearing prefixes of the error handler, in the change that adds the public route) because it is no
   longer only a digest on disk.
2. **16 characters of Crockford's base32, 80 bits**, drawn from the injected `IdGenerator.bytes` and mapped by a pure
   domain function (`GuestInviteToken`), the join code's alphabet and its tolerant reading (`I`, `L`, `O`). Short enough
   for a QR code readable at 30 mm and a link that can be dictated; long enough that no enumeration under the per-IP
   limit reaches it.
3. **Switching off keeps the token; changing the link replaces it.** `enabled` is a switch, so a host who turned the
   invitation off by mistake after printing the cards gets the same link back. "Changer le lien" mints a new token and the
   old one, with every QR printed from it, stops at once. Neither touches the join code, and rotating the join code does
   not touch the invitation.
4. **The public read starts from the secret and never joins the event.** `findByToken` returns the invitation alone; the
   use case then reads the event **by id**, the only read that fills the client's suspension and the operator's
   take-down, and decides the page's state from both (`inviteStateOf`). A join in the invitation repository would have
   answered a suspended client's page as if it were live.
5. **The page is derived, never stored, and it serves less as time passes.** `upcoming`, `joinable`, `over` or
   `unavailable` come from the event's status, not from the hour of the party. The join code is put in the answer only
   while `joinable`; once the event is `over` the address and the host's word are no longer served at all (a closed event
   may be kept for years).
6. **The audit log says that an act happened, never what.** The four acts are `event.guestInviteSaved`, `…Enabled`,
   `…Disabled` and `…Rotated`, with the event as subject: the subject types are a `CHECK` on an append-only table, and
   widening it to name the invitation would mean rebuilding that table for four lines that carry no content.

## Consequences

### Positive

- The host can reprint, reshare and switch the invitation off without ever losing the link, which is the whole of the
  use.
- One credential per surface: the invitation link can be changed without invalidating the cards on the tables, and the
  other way round.
- A suspended client, a taken-down event and an archived one all end the page the same way, with no case of their own.

### Negative

- A database dump or a backup holds working invitation links, which the gallery's digest would not give away. What a link
  opens is bounded (the details of a party the host chose to publish to the link's holders, and from the evening the way
  into a wall that any table QR code already opens), and the host can change it at once; the join code has always been in
  the same position.
- The token is in the clear in the logs unless the masking is complete; the error handler's list is therefore held by a
  test, and a new route that carries it must join that list.

### Neutral

- No e-mail address enters EventSlide and nothing is sent by the server: the invitation goes out from the host's own
  mailbox, so there is no SMTP to configure and no risk that an instance is used to send spam.

## Alternatives considered

- **A digest, like the gallery.** Refused: the link could not be shown again, so a host who lost it would have to change
  it and lose every card already printed.
- **The join code in the QR.** Refused: it rotates, and the old code stops at once; a card printed three weeks before
  would be dead on the evening. It would also open the wall before the host opened it.
- **A longer token or a UUID.** Refused: a QR code at 30 mm and a link read aloud both want it short, and 80 bits do not
  fall to any request rate the limiter allows.
- **A column on `events.settings`.** Refused: the public page reads by token (a unique index), and the content, an address
  and a personal word, has no business in the blob that the wall and the guests' interface receive.

## Related

- [ADR 0007 — AGPL and the hosted instance](0007-agpl-and-hosted-instance.md)
- `docs/SECURITY.md` §15 (the shared gallery link, the other capability URL)
- Spec 29 (`eventslide-suivi/specs/29-invitations.md`)
