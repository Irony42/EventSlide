# ADR 0018 — Self-service signup: an address proven first, a disk guard or an operator before any client, and an invitation as the only way in

## Status

Accepted (2026-11-27).

## Date

2026-11-27

## Context

Today nobody can open an account on an EventSlide box by themselves. Every account comes from the bootstrap owner, from
an operator who provisions a client (`provisionClientOwner`: a client with no member, then a week-long invitation to the
owner's address), or from a host who invites a moderator. On the maintainer's hosted instance, a person who wants a wall
writes to `contact@`, the maintainer answers by hand, creates the client in the console and sends the invitation.

Two documents say this is on purpose. ROADMAP §10, "Deliberately out of scope for this category": _"Public self-service
signup. An open registration form on a box at a photographer's office is an abuse inbox. Clients arrive by invitation,
from an operator who already knows who they are."_ ADR 0007 keeps that bullet and adds that an access-request page for
the instance is a separate decision that "has to be argued against that bullet, because a public write surface is
exactly what the bullet rejects."

This ADR is that argument. The manual path does not scale past a few requests a week, it puts the maintainer's mailbox in
the middle of every account, and it gives a stranger no answer until a person reads the mail. What the bullet protects
against is still real: a form that creates accounts on demand is a way to fill a disk, to make the box send mail to
addresses that never asked for it, and to learn which addresses already use the box.

## Decision

1. **Signup is a request, not an account.** The public form (`POST /api/signup`) writes one row in a new table
   `signup_requests` (address, the name of the space, language, an optional "what for" note and event date). Terms are
   accepted later, on the invitation page, as today. It never writes a
   `users` row, never a `clients` row, and never stores a password. A user, a client and a password come into existence
   only through the **existing invitation** (`provisionClientOwner` → `issueInvitation` → `acceptInvitation`): the path
   that is already reviewed, already audited, and already the only way an owner arrives. So the bullet's last sentence
   stays true word for word: clients arrive by invitation.
2. **The address is proven before anyone looks at the request.** The form sends a confirmation mail (the
   `emailVerification` purpose of `account_tokens`, 24 h, spent once, which migration 010 already provided for and nothing
   spends yet; `account_tokens` itself is not altered). The confirmation page acts only on a button press, never on
   opening, because mail scanners open links. A request that is not confirmed is invisible to the operator and erased
   48 h after it was made. The box therefore never shows an operator, and never invites, an address whose holder did
   not ask.
3. **An operator still decides, unless the operator chose otherwise.** `SIGNUP` takes three values: `off` (default,
   every box that does not set it, so nothing changes for self-hosters), `review` (a confirmed request waits in the
   operator console; approving it provisions the client with the box's `NEW_CLIENT_*` ceilings and sends the
   invitation), `open` (confirming the address provisions the client at once and the invitation follows by mail; its
   link is never returned in a response, because `issueInvitation` returns a link only when no mail went out).
   Approval is **claimed** first (`pending` → `approving`, a conditional update), then provisioned, then finalised or
   released, so two approvals never open two clients. **The maintainer's instance runs `open` (decision 1 of spec 31)**: the
   maintainer chose not to review each account, and keeps `review` one variable away. `open` has one automatic brake,
   the **disk guard**: a confirmed request opens a client only if the free space still covers the operator's own rule
   (`MIN_FREE_DISK_BYTES` plus 5 GB per client with an unpurged event, plus 5 GB for the new one, `docs/costs.md`
   §4.4 on the instance); otherwise, or if the free space cannot be read, it waits for the operator as in `review`.
4. **The form is never an oracle.** Every request gets the same answer, and all the work (lookup, write, mail) happens
   off the response path, as the password reset does, whether the address is new, pending, already an account, refused
   earlier, or over its cap. **An address that already has an account follows the same path and gets the same mail**;
   at approval the console says so, and accepting the invitation asks that person to sign in (as it already does). The
   only different answer is "too many requests today", which reports the box-wide ceiling and nothing about an address.
5. **Signup requires a mail relay and the site role.** `SIGNUP` other than `off` refuses to boot (code 78) without
   `SITE_ADMIN=on` and a working `SMTP_URL` + `MAIL_FROM`. With no relay there is no proof of address, and a signup
   without proof is the abuse inbox the bullet describes.
6. **Abuse is bounded by counting, not by a third party.** A limiter per IP on the public route, at most 3 requests per
   address per 24 h, a box-wide ceiling of confirmation mails per day (`SIGNUP_MAX_PER_DAY`, default 50), a body of at
   most 4 KB, and a honeypot field answered like a real request with nothing written or sent. No captcha: it would put a
   third party (and its cookies and scripts) in front of every visitor, against the CSP and the privacy notice, and the
   daily ceiling bounds what a flood can cost. When the ceiling is reached, the form answers "too many requests today,
   come back tomorrow" (decision 4: the one different answer, which says nothing of an address), and the operator gets
   one audit line and one notice, at 100 %.
7. **The data are kept only as long as the request lives, 60 days at most.** An unconfirmed request is erased 48 h after
   it was made; a pending one with no decision 30 days after the request was made; a refused one 30 days after the refusal (that row is what
   keeps the same address quiet for 30 days); an approved one when its invitation is accepted, or at the invitation's expiry (7 days) plus 24 h (from
   then on the client and its audit entries are the record); a claim (`approving`) older than an hour is given back to
   `pending`, so a provisioning that never finished waits for the operator instead of for ever. The operator's decisions (`signup.approved`, `signup.refused`,
   `signup.expired`) go to the audit log under the subject type `access_request`, reserved in the CHECK list since
   migration 009 for exactly this, with the request id, never the address.

## Consequences

### Positive

- **The account itself is still created by the same invitation code as before**, in every mode, and only for a proven
  address. In `review` an operator still opens every client.
- **The manual mail exchange disappears** for the maintainer: in `open` nothing waits on them; in `review` a confirmed
  request with its "what for" note is already in the console, with one button to approve.
- **The token purpose, the invitation, the ceilings, the audit subject and the mail templates already exist.** The new
  code is a table, three public and two operator use cases, four mails, three visitor pages and one console page.

### Negative

- **A new public write surface.** It is bounded (limiters, caps, honeypot, daily ceiling) and it creates nothing but a row
  and, at most, a mail; it is still one more thing to watch. SECURITY gets a section.
- **The box now sends mail to addresses typed by strangers.** One confirmation per address per 24 h at most, plain text,
  no tracking, and a sentence saying what to do if you did not ask. The relay's reputation is exposed anyway; the
  maintainer's instance needs SPF, DKIM and DMARC aligned before `SIGNUP` is switched on.
- **The daily ceiling can be spent by an attacker.** Five IP addresses at ten an hour reach 50 in an hour; real
  visitors are then told to come back tomorrow. Accepted for v1: the cost is a delay, not a breach; the operator gets
  the audit line and the notice when the ceiling is reached, and a captcha is reconsidered only if it happens.
- **An `approved` request does not silence its address.** A moderator may ask for a space of their own, so in `open` one
  mailbox can open up to 3 clients a day. What bounds it: the per-address cap (3 confirmations per 24 h), the daily
  ceiling and the `NEW_CLIENT_*` ceilings.
- **`open` mode gives a disk to anyone with a mailbox, and the maintainer's instance uses it.** "From an operator who
  already knows who they are" is no longer true there. What bounds it: the daily ceiling, the `NEW_CLIENT_*` ceilings
  (one event, 5 GB by default), the disk guard, and the operator's existing tools (suspending a client, takedown).
  The instance's DPIA screening names "public opening without approval" as a trigger, so the DPIA is redone before
  `SIGNUP=open` is set. OPERATING says all of this. Not the default: a box that sets nothing stays `off`.

### Neutral

- **ROADMAP §10's bullet is rewritten**, not deleted: "Public self-service signup **without proof of address**" stays
  out of scope, and the paragraph points here.
- **ADR 0007's "by invitation" stays true** and its "access-request page (planned)" is this decision.
- **Self-hosted boxes see no change** unless they set `SIGNUP`.

## Alternatives considered

- **A real signup (password at the form, unverified account, login refused until verified).** Rejected: it stores a
  password for an address nobody proved, needs a "verified" gate on every sign-in path, and creates `users` rows that a
  flood would fill. The invitation already does "prove the address, then choose a password".
- **A mailto or a contact form, as today.** Rejected for the reasons in the Context: it does not scale, and the request
  reaches the operator with no proof that the address is real.
- **A captcha or proof-of-work.** Rejected for v1 (decision 6). Revisit if the daily ceiling is reached by floods in
  practice.
- **Skipping confirmation in `open` mode and sending the invitation directly.** Rejected: provisioning creates a client
  before the address is proven, and a flood would leave empty clients behind.
- **A "you already have an account" mail for known addresses.** Rejected: it needs its own counter (no row is written
  for it), and it would lock out an existing account with no client of its own (a moderator) from asking for one.

## Related

ROADMAP §10 (bullet rewritten), ADR 0007 (hosted instance), ADR 0009 (approval goes through `provisionClientOwner`
exactly as `POST /api/site/clients` does; rule 1 already lets an operator invite itself into a fresh empty client, so
this adds no power), SECURITY §§ auth, mail, rate limits and the new "Signup" section, spec 31.
