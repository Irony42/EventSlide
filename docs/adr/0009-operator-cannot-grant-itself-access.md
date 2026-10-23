# ADR 0009 — The operator cannot grant itself access to a client

## Status

Accepted. Built as free plan G2-12 / paid plan P3-14 (decision D-16): the rules, the use cases that
hold them, `OPERATOR_RESET_LINKS` and the owner's approval route. **Not built**, and said so where
each is named: the operator routes that call these use cases (G2-14), the owner's list of what waits
for them and the route that approves a password-reset request (G2-16), the break-glass command, and
the ownership transfer (P9-02). [docs/SECURITY.md §20](../SECURITY.md) is the reference for what holds
today.

## Date

2026-10-23

## Context

A box run for other people has an operator: the account whose site role is `operator`
([roadmap §10.1](../ROADMAP.md)). The operator is not a rung above an event's owner, and `requireRole`
never reads the site role, so on its face an operator can see nothing of a client's evening. That is
the promise the product makes to a client, and it is easy to keep until the operator is also the person
who **creates the client, invites its owner and resets its password**, which is what an operator is for.

Each of those is a way to take the account. Invite an address you control into a client that has a
wedding in it, and you are a member of it. Ask for a reset link for the client's owner and read it on
your own screen, and you are the owner. Neither needs a vulnerability, only the powers the role was
given for a legitimate reason. Every draft of the hosted-instance plan handed the operator a copyable
reset link, and its first version still made that the default on a box without a mail relay, which is
most of them.

## Decision

**Six rules, held in the use cases and not in the routes** (the plan's table; the tests, the code
comments and this ADR use its numbering):

1. An operator's invitation into a client **with an event or a member** is written as waiting, and opens
   nothing until an owner of that client approves it. A client with no event **and no member** is the
   case the operator handles alone (the plan says "no event"; the member is added because a client with a
   member and no event yet is somebody's account already), and the rule is judged again when the link
   is spent, against the owners who still stand.
2. An operator's password reset is **mailed to the address on record**, and the answer never carries a
   link. `OPERATOR_RESET_LINKS=mailOnly` is the default of every box, hosted or not.
3. Ownership moves only by an owner's decision.
4. No operator action grants an event role, opens a session for another account, or impersonates a
   client.
5. Each of those actions writes an audit line the client can read, **before** the act it records.
6. Inviting a moderator to an event stays the event owner's.

**The consent is the client's, and it is not the operator's to give.** An approval is made by an
enabled owner of the client who does not operate the box, and an operator is refused even when the
client made them an owner.

**A box with no relay has two ways out, and both are weakenings that are named as such.**

- **`copyLinkWithOwnerApproval`**, an opt-in: the operator's request waits, **another owner of the
  account's client** approves it, and the operator is then handed a link, once. The request holds no
  secret until that moment, so approving it hands nobody anything.
- **A break-glass command** (`eventslide reset-link --user <id> --reason <text>`): a written reason,
  an audit line the client reads, and a mail to the account if the box can send one. **Not built yet.**

Without either, an operator on a box with no relay cannot reset a password. That is an inconvenience
accepted on purpose: the default is the posture in which nothing an operator does can put a credential
for a client's account in front of the operator.

## Consequences

### Positive

- An operator can no longer become a member of a client in use, or hold a link that resets one of its
  owners' passwords, by using the powers the role was given. Each of the two takes an owner's yes, and
  the yes is in the client's own log.
- The rules hold whichever route reaches the use case: each reads the caller's site role itself and
  refuses a non-operator, so a route that forgets the gate is not a route that forgets the rule.
- The audit vocabulary gains five actions and no string kind: a line carries `pendingApproval` or
  `linkShown` and not an address, a link or a role.

### Negative

- An operator who invites a client's new owner, or a colleague, into a client that is in use now needs
  one of its owners to press a button, and the owner needs a screen that shows what waits (G2-16). Until
  then the id travels by hand: the invitation waits, which is a gap and not a hole.
- On a box with no mail relay the operator cannot reset a password under the default, and the
  break-glass command that would cover it is not built. The way out is still a hand-written hash.
- A box that turns `copyLinkWithOwnerApproval` on has an operator who can, after an owner's yes, read a
  link that resets that owner's colleague's password. `docs/SECURITY.md` says so, and the boot refuses
  the setting without `SITE_ADMIN=on`. Until the owner's route for a reset request exists the setting
  is fail-closed and unusable end to end.

### Neutral

- `ClientRepository.countEvents` and `AccountTokenRepository.findById` join the ports. Neither reads
  anything an operator is not already shown: a number, and a record that carries a digest and never a
  secret.
- The rules about **which** operator may reach these use cases (the second factor, the step-up, who may
  disable whom) are the operator API's, as they are for every other operator action.

## Alternatives considered

- **The rules in the operator's routes** (`/api/site/*`). A route that forgets a rule is the defect,
  and the next route is written by somebody who has not read this. The use cases read the caller's site
  role themselves and refuse a non-operator, so a rule does not depend on which route reached it. The
  routes' own sweep (G2-14) is the net under that, not a substitute for it.
- **The link on the operator's screen by default**, as every draft of the plan had it. It makes the
  operator able to take over any account on a box with no relay, and the audit line it would leave is
  read by the client after the fact.
- **A new token purpose for "a request awaiting approval".** `account_tokens` already has
  `requires_approval`, `approved_by` and `approved_at` (migration 010 added them for this guard), and
  the `purpose` `CHECK` could not be widened without rebuilding a table. A reset request is a
  `passwordReset` row whose secret was never kept, which nobody can spend, approved or not.
- **One approval for an account in several clients.** Whose consent it would be is the question, and
  an approval records one. Such an account has no approval and falls to the mail.
- **Counting the client's events at issue time only.** An invitation written for an empty client lives
  a week, and an operator who writes a second one in that week would be let in the day after the
  customer's first event. The count is read again when the link is spent.

## Related

- [docs/SECURITY.md §20](../SECURITY.md): the rules, what holds each, and what the guard does not do.
- [docs/ROADMAP.md §10.1, §10.3 and §10.6](../ROADMAP.md): the site role, the invitations and the
  support access that is the one exception, which is the client's to grant and is not built.
- [docs/API.md §6](../API.md): `POST /api/client/invitations/:invitationId/approve`.
- [ADR 0007](0007-agpl-and-hosted-instance.md): the hosted instance whose operator this binds.
