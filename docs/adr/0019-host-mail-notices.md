# ADR 0019 — Host e-mail notices: a convenience never the only way to know, nothing of a guest in a mailbox, noted before sent, and a notice that expires

## Status

Accepted (2026-11-27).

## Date

2026-11-27

## Context

The box can send mail since roadmap §10.3 (`Mailer`, `SMTP_URL`, `MAIL_FROM`), and the product writes to people in a few
places: an invitation, a password reset, the warning before an album is purged (spec 22), and, since spec 31, the
signup's mails. Everything else a host needs to act on is on a screen the host has to open: the replies that are about
to be erased (spec 30), a deadline that is close, a book that is ready, the party being over with the album waiting,
the wall closing under the host's feet, a password changed by somebody else. A host who is not looking learns of it too
late, and the commitments the terms of use make in writing (reasons for a takedown or a suspension, thirty days'
notice of a change) are kept by hand from the operator's own mailbox.

Two earlier decisions bound what a mail may do. ADR 0017 (guest replies) and specs 29 and 30 settled that **no guest
address enters EventSlide**: a guest never receives a mail from the box, and this ADR does not reopen it. And the purge
warning set the pattern of a mail that is noted before it is sent and is never the only way to find out.

This ADR is the argument for writing to **hosts** (the owners of an event, and the account holder), and the rules
every such mail follows. The mails, the sweeps and the pages come in the pull requests of spec 32; this fixes what they
may and may not do.

## Decision

1. **A mail is a commodity, never the only way to know.** Everything a notice says is already visible in the console
   (the dates on the event's page, the figures on the replies page, the state of the book). A box with no relay, a host
   who switched a family off, a mail that bounced: nothing is lost that a screen does not show. This is the rule of the
   purge warning, extended.
2. **Nothing of a guest's content is ever in a mail.** No first name, no diet, no word, no photograph, no caption, no
   reply to a question. Numbers, the event's name (the host wrote it), a date, a link. The replies are projected into a
   type with no nominative field (`RsvpFigures`, `src/domain/notices/`), and the mail templates receive that type and
   nothing wider; the menus are the host's own labels, and a text a guest typed is dropped from them. A test of leakage
   feeds a reply made of a name, companions' first names, a diet, a message, an answer and a word, and asserts that none
   of it appears in any mail.
3. **Plain text, at most one link, no tracking**, in the five languages, as the existing mails. A line at the end of
   every mail of a family says where to switch it off, without a link.
4. **Noted before sent, for every mail without exception** (rule 9). The decision to send is one conditional write
   (`EventMailNoticeLedger.note` answers `true` to the call that placed the row), so the retention timer and
   `npm run purge` running together send one mail, and a crash between the note and the send loses a mail and never
   sends two. The write is the lock: nothing relies on a flag in memory.
5. **Without a relay nothing is sent and nothing is noted** (`Mailer.canDeliver`), so the day a relay is configured no
   notice has been silently marked as served.
6. **Never in the way of an action.** A notice goes out from the retention sweep, or from a completion that is not
   awaited and catches everything; a failed send never breaks what the host did. Mail is not a transaction.
7. **A notice has a lifetime, and past it is noted as served without being sent.** The first run after an update, a
   relay that was down for a week, or a daily ceiling reached several days running would otherwise send the summary of
   replies already erased and an "after the party" for an album that is gone. Each kind has a validity (until the
   erasure instant for the warning, 24 hours after the stop for the deadline's summary, 48 hours after the closing for
   the "after the party", and so on: `isFresh`). **On the first run on a base with old events, everything is noted as
   stale and nothing is sent.**
8. **Who is written to is read when sending.** The owners of the event whose account is **active** (a disabled account
   is not written to, which is not what the purge warning does and is not changed here), once per address, with the
   account's switches. A moderator is never written to. Events taken down by the operator, archived, or of a suspended
   or closing client get no follow-up mail: they have nothing left to do in the console.
9. **Three kinds of mail, three rules about switching.** The security mails of an account (password changed or reset,
   second factor turned on or off, recovery codes renewed, account disabled or deleted), the warning before the
   guests' replies are erased and an operator's decisions **are not switchable**; two **families** are: `rsvp` (the
   calendar of the replies and, per event, a daily summary the owner ticks) and `event` (a long job finished, the
   party over, the wall about to close); an operator's announcements are the third family and are not the host's to
   switch. An account has two switches, on by default. `HOST_MAIL_NOTICES=off` switches the two families off for the
   whole box and nothing else.
10. **Quiet hours.** The sweep's mails leave between 08:00 and 21:00 in the invitation's time zone (`Europe/Paris`
    when there is none); outside it the notice waits for the next pass and is not noted. The mails that answer an
    action (a security mail, a long job's end) leave at once.
11. **A daily budget, and only some mails can wait.** `MAIL_FOLLOWUP_MAX_PER_DAY` is a ceiling on the mails of a UTC
    day, set against the relay's free quota (the hosted instance sets it; `off` by default). **Every mail counts**, but
    only the families' mails and the operator's announcements can be refused (`MailBudget.take`, atomic, all or
    nothing): a refused notice is neither noted nor sent and tries again on the next pass while it is fresh, then is
    noted without being sent. A security mail is only counted, never refused.
12. **A mail to a host is a new purpose of an existing datum.** The address of the account already serves invitations
    and resets; telling the holder about the life of the account and of the events is a new purpose (performance of the
    contract; legitimate interest for the security notices). The processing register and the privacy notice say so.
    The data added are a switch, a day's count and a ledger row with no personal content.

## Consequences

### Positive

- **The host hears of what is about to be lost** (the replies, the wall) without opening the console, and of what was
  done to their account without them.
- **A self-hoster with no relay sees no change**, and one with a relay gets two switches and a variable to turn it off.
- **One conditional write is the whole concurrency story**, the same for the timer and the command line.

### Negative

- **A box with a relay starts writing to hosts when it is updated** (the follow-up mails, on by default). It is written in
  UPGRADING, and `HOST_MAIL_NOTICES=off` is one variable. The security mails and the warning before the replies are
  erased cannot be switched off, and an account whose address does not exist (`admin@localhost`) will make the relay
  bounce them.
- **The relay's reputation is exposed to more mail**: about five to fifteen mails per event over its life. The daily
  ceiling and the 21:00 limit bound what a bad day costs.
- **A notice can be skipped on purpose** (stale, or the family off): the mail is a convenience, so that is the rule, not a
  defect.

### Neutral

- **No guest is ever written to.** A receipt for a reply, a reminder the day before and a message from the host to all
  are a different decision, with a data-protection impact assessment of their own (specs 29 and 30).
- **The operator's side** (a reason written to the host with each takedown or suspension, the announcements of a change of
  terms) is the second lot of the spec and follows these rules.

## Alternatives considered

- **A mail per reply.** Rejected: noise, and the push notification and the badge do it better. A daily summary the owner
  ticks, per event, replaces it.
- **Mail by default for nothing, and a switch to turn it on.** Rejected for the follow-up mails: the point is to reach
  the host who is not looking. The security mails and the erasure warning are not switchable at all.
- **Notices decided from memory (a flag, a timer per event).** Rejected: a restart loses it, and two processes can run the
  sweep. The ledger row is the decision.
- **Sending anything that is late, as late as it is.** Rejected (decision 7): a mail about a past thing is worse than none.
- **A mail to guests with a receipt.** Out of scope, and contrary to ADR 0017.
- **One-click unsubscribe by link (`List-Unsubscribe`).** Rejected for now: these are service mails to an account holder,
  not a mailing list, and a link in a mail is one more thing to forge. Reviewed if a relay requires it.

## Related

Spec 32. ADR 0017 (guest replies, no guest address), ADR 0018 (signup, whose mails and relay requirement these join), the
purge warning (spec 22, `sweepPurgeNotices`, the model of the ledger), `docs/SECURITY.md`, `docs/OPERATING.md`.
