# ADR 0017 — Guest replies (RSVP): a reply token kept as a digest, a first public write with no cookie, and health data erased early

## Status

Accepted. The first part came with the domain and the storage; **the household token in the clear** (decision 7) came with the
households (spec 30, lot 3). Spec 30 still completes this record with Web Push without a dependency, with the notifications.

## Date

2026-11-22

## Context

Spec 30 lets a guest answer the invitation of spec 29: whether they come, how many, what they eat, a word for the host.
It is the first **public write** of the product that is not tied to an event's join flow: a guest who only holds the
invitation link, with no account and no `es_guest` cookie, stores a name and, sometimes, an allergy. The same guest must be
able to come back and change their mind from the same phone or from another one, and to erase what they wrote.

Three decisions follow from that and a later reader would otherwise reopen them.

## Decision

1. **The guest's token is kept as its SHA-256 digest and travels in the URL fragment.** The server draws 128 random bits at
   the creation of a reply, returns them **once**, and stores only the digest (`guest_rsvps.edit_token_hash`, unique), as the
   gallery link does (`shareLink.ts`). It gives the right to read, change and delete **that** reply and nothing else. A
   reply typed by the host has none. The link the guest keeps is `/i/<invite>#r=<token>`: a fragment is never sent to a
   server, so it is in no access log and in no `Referer`; the client puts it in a header (`X-Rsvp-Token`) and removes it
   from the address bar once stored. Every lookup by digest is **bounded to the event of the invitation**
   (`findByEditTokenHash(eventId, hash)`): a token that is valid on another event answers `404`, as a reply that does not
   exist does.
2. **The first public write has no identity cookie, and is held by four things instead.** The page sets no cookie of its
   own; the writes go through the anti-CSRF cookie every public page of the instance already carries, which identifies
   nobody. What stands between the form and abuse is a write limiter per IP **and** per invitation, a ceiling of 1 000
   replies per event decided inside the write transaction (`GuestRsvpRepository.admit`, with the same arithmetic as the
   use case's early refusal), a body of at most 8 KB, and a honeypot field that is answered with a fake success and no
   write. There is no captcha: it would put a third party in front of a guest who has one thumb and bad Wi-Fi, and the
   ceiling bounds what a flood can cost the host.
3. **Allergies and diets are health data and are treated as such.** The field is optional and free text. The legal basis is
   the **explicit consent** of the guest who chooses to fill it in (GDPR article 9(2)(a)); it is shown to the host alone,
   never in anything a guest sees, and it is erased with the reply. A notice under the send button says who sees the
   reply, with which first name if the guest agrees, and until when.
4. **Replies are erased early and by rule, not by the host's memory.** They go **30 days after the event closed** (archiving
   stamps the same date), or **60 days after the invitation's start** for an event that was never closed, whichever comes
   first, and with the event itself if its purge comes sooner. The purge **hold does not keep them**: a hold exists to keep
   an album, not the names and diets of the people in it. Reopening an event brings nothing back. The rule is one function
   (`rsvpExpiryOf`) and the adapter's `DELETE` takes its two cutoffs from it. A guest may also delete their own reply at any
   time while the invitation is readable, **after the window and after the party included**: the right to erase does not end
   with the date limit.
5. **Settings live on the invitation's row; replies live in their own table.** The switch, the deadline (a local day in the
   invitation's zone), the host's manual closing and the form (JSON, restored leniently) are columns of `guest_invites`, so
   the public page reads them with the invitation it already reads. Replies are `guest_rsvps`, with `waitlist` and
   `household` in the `CHECK`s from the start (SQLite cannot change a `CHECK` without rebuilding the table) and a `details`
   JSON column that carries what the later lots add, so that none of them rebuilds the table.
6. **Whether replies are open follows the party's calendar, not the wall's status.** `off`, `open`, `closed` or `full` are
   derived (`rsvpStateOf`): the window ends at the start of the day after the deadline **where the party is**, daylight
   saving included, or at the start of the party, whichever comes first. Opening the wall the evening before for a trial does
   not close the replies, and a draft that was never opened does not keep them open for ever.
7. **A household's token is kept in the clear, and it is the household's one key.** The host's guest list (lot 3) gives each
   household a personal link, `/i/<invitation>#f=<token>`, so that a family answers once for everyone with the places the host
   kept for it. Unlike a reply's token, **the host must be able to show this link again** (to copy it, to print it on a card, to
   send it from another device), which a digest cannot give back: the token is stored as it is (`guest_households.token`,
   unique), as the invitation's own token is (ADR 0016), and is the same kind of credential: 16 characters of Crockford's
   base32, 80 bits, tolerant on input, masked like the invitation's. What it opens is **bounded**: the read, the change and the
   deletion of **the household's one reply** (`source = household`, which has no reply token: every device of the household
   shares the link), and its own name and places, never another household, the list, the host's notes or another reply. It
   travels in the fragment and in an `X-Household-Token` header, never in a path or a query; every lookup is **bound to the
   event** of the invitation (`findByToken(eventId, token)`), so a household token valid elsewhere is `404 rsvp.notFound`. The
   host can change it at any time (`rotate`): the old link, and a card printed with it, stops at once, and the reply stays.
   The household's places are the ceiling of its reply (the host counted them). No e-mail address or phone number is held: the
   list holds names and places only, and the host reminds from their own applications. Households are **erased with the
   replies**, on the same dates and whatever the purge hold says (decision 4): they are names the host typed, and nothing
   about them outlives the party by more than two months.

## Consequences

### Positive

- A database dump holds no working reply token: only digests, which cannot be turned back into the link.
- No reply token ends up in a log, a `Referer` or a browser history that syncs the URL to a server.
- Names and diets do not outlive the party by more than two months, whatever the host does or forgets.
- The ceilings and the capacity are decided in one transaction, so overlapping requests cannot pass them.
- A household answers once for everyone on any of its devices with a link the host can show again and cut.

### Negative

- A guest who loses their link and clears their phone cannot change their reply: the host can, from the replies page. This
  is the price of not asking for an e-mail address or a phone number, which EventSlide never collects.
- A household link is a bearer credential held in the clear: whoever the family forwards it to can answer for the household,
  and a database dump holds working household links (never working reply tokens). That is bounded by what it opens (one reply
  of a party the host invited), by the host's "changer le lien", and by the early erasure.
- No captcha: a determined script can fill the 1 000 places of an event with replies that the host then deletes. The
  limiter makes it slow and the ceiling makes it bounded, and the host can close the replies at once.

### Neutral

- Nothing is sent by the server and no address enters EventSlide: the host reminds guests from their own applications.

## Alternatives considered

- **The token in the clear, like the invitation's.** Refused: the invitation's token must be shown again to the host, which
  is the whole of its use. A reply's token is shown to the guest once, and nobody needs to read it back.
- **The token in the path or the query.** Refused: it would be in every access log and in `Referer`; the fragment is not.
- **A cookie to recognise the guest.** Refused: the invitation page sets no identity cookie (spec 29), and a cookie would not
  follow the guest to another phone, which the token does.
- **A captcha.** Refused, above.
- **The household token as a digest, like a reply's.** Refused: the host would never see the link again, and the whole point of
  the list is to hand the link out, reprint a card and resend it.
- **One line per person with a toggle, in the household's page** (the mock-up's first idea). Refused: it needs a second model of
  a reply; the household fills the same form as the common link, pre-filled, with its places as the ceiling.
- **A separate table for the settings.** Refused: the public page already reads `guest_invites` by token, and the settings
  have no life of their own outside the invitation (one per event, deleted with it).

## Related

- [ADR 0016 — Guest invitations](0016-guest-invitations.md)
- `docs/SECURITY.md` §15 (the shared gallery link, the other token kept as a digest)
- Spec 30 (`eventslide-suivi/specs/30-reponses-invites.md`)
