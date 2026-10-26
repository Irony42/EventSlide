import type { SiteRole } from '../users/siteRole'
import type { ClientRole } from './clientRole'

/**
 * The operator's anti-escalation guard (docs/ROADMAP.md §10.1 and §10.6; free plan G2-12, paid
 * plan P3-14, decision D-16): the rules that stop the person who **runs the box** from using
 * that power to become somebody's **client**.
 *
 * An operator creates clients, invites their owners, and is asked to reset a password when a
 * client cannot sign in. Every one of those is also a way to end up holding a client's account
 * (and from it, their events). The rules below are what the use cases hold to; the text is the
 * plan's, and the numbering is the plan's too, so a test named `R1` and a line of the plan are
 * one thing.
 *
 * | Rule | In one line |
 * | --- | --- |
 * | R1 | An operator's invitation into a client **with an event, a member or another live invitation** waits for an owner's approval. |
 * | R2 | An operator's password reset is **mailed**; the answer never carries a link. |
 * | R3 | Ownership moves only by an owner's decision, never by an operator's. |
 * | R4 | No operator action grants an event role, opens a session, or impersonates a client. |
 * | R5 | Every action under R1 to R4 writes an audit entry the client can read. |
 * | R6 | Inviting a moderator to an event stays the event owner's alone. |
 *
 * This module is the part of those rules that is a pure decision. The parts that need storage
 * (counting a client's events, reading who is an owner, writing the entry) are in the use cases
 * under `application/usecases/clients/` and `application/usecases/auth/`, each of which asks a
 * question of this file rather than restating the answer.
 */

// ---------------------------------------------------------------------------- R1 ---

/**
 * What of a client an operator's invitation could take: how many events it has, in any status,
 * and how many accounts belong to it, whether or not they can sign in today.
 */
export interface ClientHoldings {
  readonly eventCount: number
  readonly memberCount: number
}

/**
 * What an operator's invitation is written against: what the client holds, **and the other
 * invitations into it that are still waiting to be accepted** (G2-14). `otherLiveInvitationCount`
 * counts those written to a different address than the one being invited: re-sending the same
 * person their link replaces the old one and is not a second invitation.
 */
export interface ClientHoldingsAtWrite extends ClientHoldings {
  readonly otherLiveInvitationCount: number
}

const holdsSomething = (client: ClientHoldings): boolean =>
  client.eventCount > 0 || client.memberCount > 0

/**
 * R1, at the moment the invitation is written: **does it have to wait for an owner?**
 *
 * It does as soon as the client is somebody's. **A client with no event and no member** is the
 * case the operator has to be able to handle alone (a customer who has just signed up, whose
 * first owner is the operator's own invitation), and there is nothing in it and nobody in it
 * yet. A client with even one event, in any status, is somebody's evening; and a client with a
 * member and no event yet is somebody's account, where an operator's invitation (to sit beside
 * the customer as an owner, or to raise a member to owner) is the same thing R1 stops, a week
 * before the first event instead of a week after.
 *
 * The plan's sentence says "no event" and this adds "and no member": the first alone leaves that
 * window open for every client between its owner's sign-up and its first event, and for every
 * client whose events retention has purged. It costs the provisioning flow nothing, which is a
 * client with neither.
 *
 * **And with no other invitation waiting** (G2-14). `POST /api/site/clients` invites the client's
 * first owner, and that invitation is one nobody had to approve: it is the operator's one free
 * invitation into an empty client. Without this clause the operator could write a second, to an
 * address it controls, before the customer had accepted the first; accept it; and so hold an
 * "owner" of the client whose approval is the consent R1 and R2 are made of (it approves the
 * operator's next invitation, and, with `copyLinkWithOwnerApproval`, the operator's request for
 * the customer's password-reset link) while the customer's own invitation, now an unapproved link
 * into a client that holds a member, is dead until that account approves it. **An empty client
 * admits exactly one live operator invitation**; the second waits, and nobody exists to approve
 * it until the first has been accepted, which is the point.
 */
export const operatorInvitationNeedsApproval = (client: ClientHoldingsAtWrite): boolean =>
  holdsSomething(client) || client.otherLiveInvitationCount > 0

/**
 * R1, at the moment the invitation is **spent**: is it still good?
 *
 * An invitation that needed no approval was written for a client that held nothing, and the
 * week it lives is long enough for that to stop being true: the customer's first owner signs
 * up, or creates a wedding. An operator who wrote a second invitation (to themselves) in the
 * meantime would otherwise be let in without anybody's say. So it is judged again, and it is
 * honoured when:
 *
 * - an owner **still standing** approved it, which is the whole of R1's remedy; or
 * - it was written by an owner of that client **who still stands** and does not operate the box
 *   (who is not who R1 is about); or
 * - the client still holds nothing, which is the case that never needed anyone.
 *
 * "Standing" is read now, on this request, as authority always is: an account that can sign in,
 * that is not an operator, and that is still an owner of this client. **An author the box no
 * longer has (`null`, once the account was deleted) is not an owner**: reading it as "the
 * system" would turn the deletion of an operator's account into an approval. Anything else is
 * **dead**, and answers like every other dead link: the operator writes a new invitation, which
 * now waits for an owner.
 */
export const clientInvitationStillHonourable = (
  facts: ClientHoldings & {
    readonly approvedByAStandingOwner: boolean
    readonly writtenByAStandingOwner: boolean
  },
): boolean =>
  facts.approvedByAStandingOwner || facts.writtenByAStandingOwner || !holdsSomething(facts)

/**
 * Who may approve something that waits for an owner (R1's invitation, R2's reset link), as the
 * answer the caller gives:
 *
 * - `ok`: a signed-in owner of that client who does not operate the box.
 * - `stranger`: not a member of the client. Answered exactly as a request about something that
 *   does not exist, **for an operator too**, so the endpoint is not a way to learn which
 *   clients and invitations exist. (docs/API.md reserves 403 for a principal that is
 *   genuinely in scope.)
 * - `operator`: **an operator never approves**, whether or not they are also a member of the
 *   client. An approval is the client's consent, and an operator who could give it to their own
 *   request would have removed the only thing R1 and R2 stand on.
 * - `notOwner`: a member of the client who is not an owner.
 */
export type ApprovalVerdict = 'ok' | 'stranger' | 'operator' | 'notOwner'

export const approvalVerdictFor = (approver: {
  readonly siteRole: SiteRole
  readonly clientRole: ClientRole | null
}): ApprovalVerdict => {
  if (approver.clientRole === null) return 'stranger'
  if (approver.siteRole === 'operator') return 'operator'
  if (approver.clientRole !== 'owner') return 'notOwner'
  return 'ok'
}

// ---------------------------------------------------------------------------- R2 ---

/**
 * `OPERATOR_RESET_LINKS`: whether a password-reset link that an operator asked for may ever be
 * put in front of the operator (decision D-16).
 *
 * - **`mailOnly`**, the default of every box, hosted or not: the link goes to the account's
 *   own mailbox and nowhere else. On a box with no mail relay an operator cannot reset another
 *   account's password at all, and the answer says so; the break-glass command of D-16 is what
 *   is left.
 * - **`copyLinkWithOwnerApproval`**, an opt-in that **weakens the invariant** and is documented
 *   as doing so: on a box with no relay the link is handed to the operator, but only after
 *   **another owner of the account's client** has said yes.
 *
 * A word that is neither is a refusal at boot (`config/featureFields.ts`), never a guess at which was meant.
 */
export const OPERATOR_RESET_LINK_MODES = ['mailOnly', 'copyLinkWithOwnerApproval'] as const

export type OperatorResetLinks = (typeof OPERATOR_RESET_LINK_MODES)[number]

export const DEFAULT_OPERATOR_RESET_LINKS: OperatorResetLinks = 'mailOnly'

/**
 * What an operator-initiated reset does (R2).
 *
 * - `mail`: the link is mailed to the address on record. The only way a link travels while the
 *   box can mail, **in either mode**: a link on the operator's screen is for a box that has no
 *   other way, and a box that has one never shows it.
 * - `refused`: the box cannot mail and the mode does not allow a link. Nothing is issued.
 * - `needsApproval`: the box cannot mail and the mode allows a link, but not yet: an owner has
 *   not approved the request.
 * - `link`: the box cannot mail, the mode allows it, and an owner approved. The one case where
 *   the operator is handed a link.
 */
export type OperatorResetPlan = 'mail' | 'refused' | 'needsApproval' | 'link'

export const operatorResetPlan = (facts: {
  readonly mode: OperatorResetLinks
  readonly mailerCanDeliver: boolean
  readonly ownerApproved: boolean
}): OperatorResetPlan => {
  if (facts.mailerCanDeliver) return 'mail'
  if (facts.mode === 'mailOnly') return 'refused'
  return facts.ownerApproved ? 'link' : 'needsApproval'
}
