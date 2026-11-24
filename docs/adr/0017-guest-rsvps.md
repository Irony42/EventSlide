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

8. **Browser notifications for the host (Web Push, lot 4) without a dependency.** The host's page can ask their browser to say "3 nouvelles
   réponses" when replies come in: a second way to be told that adds no e-mail address, no phone number and nothing sent _to guests_.
   It is built on `node:crypto` alone (RFC 8291 message encryption, `aes128gcm`, one record; RFC 8292 VAPID, ES256 in the raw 64-byte form; the
   worked example of RFC 8291 appendix A is a test, byte for byte), because the one library that does it would be the largest dependency for forty
   lines of arithmetic and one more thing to keep in step. **The keys come only from the environment** (`VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, all three or none; CLAUDE.md §3 rule 10: this box has no secret store), and the feature is **off while they
   are missing**. The message holds the event's address and a count, **never a guest's name, diet or word**, and at most one is sent per event
   and per five minutes. It is the **first outbound request to an address a user supplied**, so it is bounded as docs/SECURITY.md §29 says: `https`
   only, an allowlist of the browsers' push services (replaceable by the operator, never an IP address), the connection only to public addresses
   and to the addresses it checked, no redirect, a 10 second deadline, 4 KB of answer, and the endpoint, the keys and the message never logged. A
   subscription is the owner's browser for one event (`UNIQUE (endpoint, event_id, user_id)`, ten per account and event); a push service that says
   `404` or `410` removes it.

## Consequences

### Positive

- A database dump holds no working reply token: only digests, which cannot be turned back into the link.
- No reply token ends up in a log, a `Referer` or a browser history that syncs the URL to a server.
- Names and diets do not outlive the party by more than two months, whatever the host does or forgets.
- The ceilings and the capacity are decided in one transaction, so overlapping requests cannot pass them.
- A household answers once for everyone on any of its devices with a link the host can show again and cut.
- A host can be told in their browser that replies came in, with no dependency and nothing about a guest in the message.

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

### Web Push, the page and the worker (lot 4, PR 16)

- The worker (`web/sw/serviceWorker.ts`) gains `push` and `notificationclick` handlers; their logic (reading the message, wording it in the browser's language among the five, picking the window to focus) is in `web/src/lib/push/pushNotice.ts`, tested like any module. A push always ends in a notification, and the click only follows a path of the host's console.
- The checkbox of the Réponses page asks the permission **from the click only**; a denial is said and never asked again; the box is absent while the server has no key. One browser holds one push subscription for the whole site, so unticking an event tells the server to forget that event for this browser and leaves the browser's subscription.
- The worker is registered when the box is ticked even if the offline queue is off. `removeUploadWorker` (the kill switch) keeps a registration a push subscription lives on and tells its worker to stop serving the shell and the outbox (`eventslide:push-only`). That mode is **kept in the Cache Storage** (a cache of its own, `eventslide-push-only`), not in memory, because the browser stops and restarts a worker freely; the page says it again whenever the worker becomes active, and `eventslide:queue-on` ends it. **With the queue off and photos still queued on the phone, only the page drains them** (the worker no longer answers a Background Sync in that mode), as the kill switch already documents for a removed worker.
- A **key rotation** (a new `VAPID_*` pair) makes every browser subscription stale: the checkbox compares the subscription's `applicationServerKey` with the box's key, reads a mismatch as off, and ticking again drops the old subscription and makes a new one. **A permission revoked after ticking** leaves the box ticked with the denial said, so it can still be unticked (which removes the server's row; the address is kept in the browser for that). **A sign-out removes this browser's rows for every event** (`DELETE /api/push-subscriptions`) and drops the browser's subscription, as does unticking the last event.
- A click only takes a window of the host's console (`/admin`, the one already on the event first) to the Réponses page; the wall and the guest screens are never taken over, and a window that refuses to move is replaced by a new one.
- iPhone: Web Push exists only for an app added to the home screen (iOS 16.4+); the page says so instead of offering a box that cannot work. The manifest (`display: standalone`, icons, `start_url: /join`) already qualifies the app as installable.

### The word of those who cannot come (lot 4, PR 17)

A guest who answered "no" may leave a written message in the guestbook, **through the guestbook's own door** (`createGuestbookEntry`: its text rules, its ceilings of 3 per author and 500 per event, its signal to the host's console) **and a note is always held for the host, whatever the event's moderation mode** (spec 30 §12: a word from outside the room; `createGuestbookEntry` takes the note's own `held` flag, the guests' own messages are unchanged), not a second one. The guestbook's authors are `guests` rows, so one is made for the note: `guests.via_rsvp = 1` (migration 039), **no device token, nobody can sign in as it, and it is left out of every count of guests** (the host's list, the people present, the statistics, the dashboard), signed with the first word of the reply's name. One note per reply (`guest_rsvps.absent_note_guest_id`, claimed in the write); the reply's own token or the household's link is the key, the write limiter and CSRF apply, and a honeypot answers a script as a person and writes nothing. The guest edits the signature before sending (prefilled with that first word, emptied: "Un invité absent"), judged like a guest name. **Deleting the reply deletes the author and the entry in the same transaction** (the guest's, the host's, the retention sweep), and the event's purge takes them with it; **every path that erases replies retires the photo book and the archive that print the guestbook before and after, and publishes `guestbook.changed`** (`absentNoteErasure.ts`, held by a guard test); the guestbook keeps no retention of its own for them. The host's switch (`form.absentNote`, on by default) and the page's `absentNoteAvailable` (the switch, `allowGuestbook`, the event live or closed for less than seven days) decide whether it is offered.
