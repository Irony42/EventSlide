# ADR 0007 — AGPL licence and the maintainer's free hosted instance

## Status

Accepted. The relicensing itself — `LICENSE`, `package.json`, `package-lock.json`,
`NOTICE`, the README licence section — is a separate change (see the relicensing PR).
This ADR records the decision behind it, the shape of the maintainer's own hosted
instance, and the invariants that bind that instance. It touches none of those files.

Several things it relies on are **(planned)**, not built: the AGPL §13 source offer in
the application (`GET /api/about`), a contributor licence agreement, a licensing FAQ
(`docs/LICENSING-FAQ.md`), the instance's terms of use (CGU), an access-request page,
and a donation channel. Each is marked where it is named.

## Date

2026-10-02

## Context

At the time of writing EventSlide is GPL-3.0 (`package.json`, `LICENSE`). The GPL's
copyleft triggers on **distribution**. It does not trigger on **running** a modified
version as a network service: a party can fork the project, change it, and operate it for
the public without publishing a line, because nobody ever receives a copy of the program —
only its output, over HTTP. Closing that gap is the whole purpose of the AGPL (its
§13, "Remote Network Interaction"), and the gap is not hypothetical here: roadmap §10.9
already lets one box serve other people's events behind `SITE_ADMIN=on`, which is exactly
the shape a closed fork run as a service would take.

Two questions have to be answered together, because the second makes the first honest:

1. **Which licence.** AGPL-3.0, and specifically `-only`, not `-or-later`: the project
   carries no "or any later version" grant today, and a later version can be adopted
   deliberately instead of by default.
2. **What the maintainer does with a public instance of that code.** A common answer is
   open-core: a second, private repository that composes the AGPL core and adds billing,
   a commercial catalogue and a support organisation. None of that exists here. There is
   no company, no customer, no invoice and no second repository — only one person who
   would like to run one instance for people who cannot host an event wall themselves,
   funded by voluntary donations, with no contract and no service-level promise. Saying
   "there is a hosted instance" without saying that plainly, and without binding what its
   operator may do with other people's photographs, would be worse than not running it.

Roadmap §7 listed **"A hosted SaaS with billing"** as a deliberate non-goal, giving as its
reason that the whole proposition is that the photos stay on the host's machine. That is
still true of self-hosting, and the row still rules out a billed, commercial tier. What
it did not do is say what the one exception is.

## Decision

**AGPL-3.0-only (see the relicensing PR).** This ADR does not re-argue the choice of
`-only` over `-or-later`; it states the licence so that everything below can be read.

**No open-core, and no SaaS in this repository.** There is one product and one codebase.
The maintainer's hosted instance is not a second distribution or a second build, and it is
not something anyone buys. It is **one deployment of the published image, unmodified** —
what any self-hosting operator could run — with `SITE_ADMIN=on` (roadmap §10.9, the
`SITE_ADMIN` setting in `src/infrastructure/config/env.ts`) so that it can serve more than
one client. It admits clients by invitation. It is free, funded by donations that buy
nothing (**(planned)**), and offers no contract and no availability guarantee (terms of use,
**(planned)**).

Running the unmodified image obligates the operator to nothing beyond what the GPL already
asked. Only a _modified_ version served to others triggers §13, and that is what the
planned source offer (`GET /api/about`, with a configurable source URL) is for: an operator
who forks and serves the fork can point it at their own source. The maintainer's instance
needs no such change, so there is no private branch to keep in compliance.

**ROADMAP §7.** The "A hosted SaaS with billing" row is rewritten from a bare rejection
into what is actually true (the row's wording, minus its link to this ADR):

> Not in this repository. The maintainer runs a free instance of the published image,
> `SITE_ADMIN=on`, unmodified and unbridled (see ADR 0007). Self-hosting stays the way the
> photos never leave the host's machine.

The row still says no to a billed, commercial product. **"Public self-service signup"**,
the non-goal under §10's "Deliberately out of scope for this category", is untouched and
keeps its meaning: clients of the instance arrive by invitation, never through an open
registration form. An access-request page for the instance is a separate, **(planned)**
decision, and when it is designed it has to be argued against that bullet, because a
public write surface is exactly what the bullet rejects.

**ARCHITECTURE §1.** "One deployment, one box, one venue" is the default shape, not the
only one roadmap §10.9 permits: with `SITE_ADMIN=on` one box serves several clients, each
with their own venue. Only the switch and the operator's `/api/site` namespace exist
today; clients as records, link invitations, the operator console and per-client ceilings
(§10.2–§10.8) are **(planned)**. It is still one deployment and one box; "one venue" is
the part that stops being universal.

**SECURITY §16** states the trust boundary of the instance plainly. The single operator
holds root on the VM and could technically read any client's media straight off the disk or
out of a backup, bypassing every route. No shell-session logging is in place. So the
invariant stated elsewhere — the operator never looks at a client's photograph — rests on
two things together, not one: the application's refusal to show photograph bytes through
any operator-facing route (SECURITY §2, "The site role, and what it deliberately does not
grant"), and the operator's **written commitment** in the instance's terms of use
(**(planned)**) never to use the root access the machine necessarily grants. The second is
a promise, not a control, and §16 says so.

**README.** "Why" gets one sentence: the hosted instance is an option for people who
cannot host, while self-hosting — the only way the photos never leave a machine you control
— stays the recommended path. "It survives the venue" is clarified: it is true for a box
running on site, and a wall served by the hosted instance depends on the venue's own
internet connection.

**CLAUDE.md and AGENTS.md** each get one paragraph naming the licence and pointing here,
so that an agent does not have to infer the distribution model from `package.json`.

## Consequences

### Positive

- **The network-use gap closes before the instance is opened to strangers.** The order
  matters: switching after a closed fork had appeared would mean arguing this ADR's Context
  in public, after the event it exists to prevent.
- **One product, one set of rules.** No second extension-point concept, no second CI
  matrix, no "which repository is this bug in". The hexagonal boundaries
  ([ADR 0001](0001-hexagonal-architecture.md)) gain no cloud/core seam to maintain.
- **Compliance costs nothing because nothing is hidden.** The instance runs the public
  image; there is no private branch that can drift out of the licence's own terms.
- **An honest answer to "can I use yours?"** — free, by invitation, no contract — written
  down next to the decision that makes it defensible, without building or pretending to run
  a commercial product.

### Negative

- **AGPL is easily misread as "commercial use needs another licence".** It does not:
  running EventSlide for other people, unmodified, obliges nothing new; only modifying it
  and serving the modified version triggers §13. That needs its own document
  (`docs/LICENSING-FAQ.md`, **(planned)**) or it will cost adoption among the self-hosting
  photographers and venues who are the audience.
- **The privacy invariant of the instance is a promise, not a control.** A maintainer with
  root can read media; nothing in the application changes that. It is weaker than the
  support-access design in roadmap §10.6 (time-boxed, announced to the client, written to
  an append-only log the client can read) and is accepted only because this is one person
  running one free instance with no contract.
- **No shell-session logging is a named gap, not a mitigated one.** This ADR does not
  close it; SECURITY §12 and §16 record it so that it is an accepted risk on the record
  rather than an assumption nobody wrote down. Closing it — session recording first, the
  cheapest option — is future work.
- **ARCHITECTURE's terse first paragraph picks up a qualification.** A reader who stops at
  "one box, one venue" describes the product one exception short. Accepted, in exchange for
  not contradicting §10.9 in the document that defines the architecture.
- **Two repository documents now speak of an instance that is not yet open.** The README
  says it exists "by invitation, for now". Anyone who cannot self-host and goes looking will
  find that it is not open to requests, which is accurate and is the cost of saying so
  early.

### Neutral

- **The instance is not promised to exist indefinitely.** This ADR records the licence and
  the operating model, not a commitment to keep it running; whether and when it accepts
  public access requests is a later decision.
- **Nothing here is an announcement.** The announcement of the instance, the licence change
  notes and the FAQ are separate, later work.
- **Other installations are unaffected.** `SITE_ADMIN` stays `off` by default (roadmap
  §10.9); this ADR describes the one instance the maintainer personally operates.

## Alternatives considered

### Open-core

A private second repository composing the AGPL core with billing, a commercial catalogue
and support, sold as a hosted tier. Rejected: it is built for a business with customers and
invoices and solves problems — plan enforcement without touching the core's transactions,
a commercial surface, revenue-shaped compliance — that one free, donation-funded instance
does not have. Roadmap §10.9 had already rejected a separate repository or image for the
site-administration category; this would reopen that at larger scale for nothing on the
other side of the split.

### Stay on GPL-3.0

Simpler, and it defers a change nobody has yet been inconvenienced by. Rejected: the point
of running a hosted instance of this code is to stand behind the network-copyleft promise,
not to depend on nobody forking it before the licence catches up.

### A commercial SaaS with billing, run by the maintainer

Already a non-goal in roadmap §7, and this ADR narrows that row's wording, not its meaning.
A billed service changes what the maintainer is — a vendor with customers rather than a
volunteer — and brings the consumer-law, tax and accounting surface with it.

### A privately modified fork as the hosted instance

Run whatever is convenient and keep the changes to oneself. Rejected: that triggers §13
for the maintainer's own users, opens a gap between what self-hosters test and what the
instance runs, and puts the maintainer in the position this licence change is meant to
prevent others from taking.

### Enforcing the privacy invariant technically (per-client encryption of media at rest)

Rejected as a substitute for the commitment, not as a future hardening: the process that
serves the wall must hold the key to serve it, and root can read that process's memory, so
encryption moves the trust rather than removing it, while costing the wall its simplicity.

## Related

- [ROADMAP §7](../ROADMAP.md#7-deliberate-non-goals) — the rewritten non-goal row — and
  [§10.9](../ROADMAP.md#109-one-product-with-site-administration-off-by-default-p1-effort-s-risk-low),
  the `SITE_ADMIN` mode the instance runs in
- [ARCHITECTURE §1](../ARCHITECTURE.md#1-purpose-and-the-three-surfaces) — "one deployment,
  one box, one venue", re-scoped
- [SECURITY §16](../SECURITY.md#16-the-maintainers-hosted-instance) — the trust boundary of
  the hosted instance — and §12, where the risk is listed
- [README](../../README.md) — "Why" and "It survives the venue"
- [CLAUDE.md](../../CLAUDE.md) §1 and [AGENTS.md](../../AGENTS.md) — the pointer back here
- [ADR 0001](0001-hexagonal-architecture.md) — the boundary this decision adds no second
  side to
