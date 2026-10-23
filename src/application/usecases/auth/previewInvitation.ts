import type { ClientRole } from '../../../domain/clients/clientRole'
import { clientInvitationStillHonourable } from '../../../domain/clients/operatorGuard'
import { canInviteModerators } from '../../../domain/events/eventRole'
import { isMutable } from '../../../domain/events/eventStatus'
import type { TermsOfUse } from '../../../domain/legal/termsOfUse'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import {
  invitationTargetOf,
  type AccountToken,
  type InvitationTarget,
} from '../../../domain/users/accountToken'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { SecretTokens } from '../../ports/secretTokens'
import type { MembershipRepository, UserRepository } from '../../ports/userRepository'
import { makeIsStandingOwner } from '../clients/approvalGate'

/**
 * The code every way of holding a link that cannot be used answers with: unknown, malformed,
 * already used, revoked, expired, waiting for an approval it has not had, or pointing at an
 * event or a client that is gone. What separates them is something only the person the link
 * was written to may know, and a stranger probing links must learn nothing from the
 * difference.
 */
export const INVITATION_NOT_FOUND_CODE = 'invitation.notFound'

export const invitationNotFound = (): DomainError => DomainError.notFound(INVITATION_NOT_FOUND_CODE)

/** What an invitation is to, with the name a person gave it. */
export type InvitationPlace =
  | { readonly kind: 'event'; readonly slug: string; readonly name: string }
  | { readonly kind: 'client'; readonly name: string }

/** A usable invitation, found and checked: the record and what it admits its holder to. */
export interface ResolvedInvitation {
  readonly record: AccountToken
  readonly target: InvitationTarget
  readonly place: InvitationPlace
  /**
   * The client the invitation belongs to: the one it is into, or the one that owns its event,
   * `null` for an event no client owns. What an audit entry about this acceptance is filed
   * under, so that the client's own owner reads it (G2-16).
   */
  readonly clientId: ClientId | null
}

export interface ResolveInvitationDeps {
  readonly tokens: AccountTokenRepository
  readonly secrets: SecretTokens
  readonly events: Pick<EventRepository, 'findById'>
  readonly clients: Pick<
    ClientRepository,
    'findById' | 'memberRole' | 'countEvents' | 'countMembers'
  >
  readonly memberships: Pick<MembershipRepository, 'roleFor'>
  /** Only the lookup by id, for R1's "is the owner who approved or wrote this still one". */
  readonly users: Pick<UserRepository, 'findById'>
}

export type ResolveInvitation = (
  token: string,
  now: Date,
) => Promise<Result<ResolvedInvitation, DomainError>>

/**
 * Finds the invitation a link stands for and checks everything about it that does not depend
 * on who is holding it. The preview and the acceptance both start here, so what the page
 * shows and what the acceptance does cannot be two readings of one link.
 *
 * 1. **The link, by its digest.** Only a token that is unspent, unrevoked, unexpired, issued
 *    as an *invitation* and approved if it needed approval is found; anything else is
 *    `invitation.notFound`. A second, constant-time comparison (`SecretTokens.verify`) stands
 *    behind the lookup, so a repository that matched loosely cannot turn a near miss into a
 *    hit.
 * 2. **What it admits to still exists.** The event or the client is read; a link to one that
 *    is gone is dead (the table's cascade already removes it, this is the same answer for a
 *    store that does not cascade). An archived event is the one answer that differs
 *    (`409 event.immutable`): it is a record and takes no moderator, and the person holding
 *    the link is owed the reason rather than a shrug.
 * 3. **For an event, the inviter still has the authority they used.** Authority is read from
 *    storage on the request that uses it (CLAUDE.md §8), and an invitation is a request
 *    answered a week later. An owner who was removed, or whose account was switched off, or
 *    deleted, no longer has invitations that open anything — the moderator they meant to add
 *    is not added by a person who can no longer add one.
 * 4. **For a client, R1 of the operator guard is held again** (`clientInvitationStillHonourable`,
 *    G2-12 / P3-14). An invitation that waited for nobody was written for a client with no
 *    event, and the week it lives is long enough for the client to grow one: so unless an owner
 *    approved it, or an owner (or the system) wrote it, it is honoured only while the client
 *    **still has no event**. Otherwise it answers like any dead link and the operator writes a
 *    new one, which now waits for an owner. A client's invitation has no inviter authority to
 *    re-read beyond that: the operator who writes one holds no membership to read.
 */
export const makeResolveInvitation = ({
  tokens,
  secrets,
  events,
  clients,
  memberships,
  users,
}: ResolveInvitationDeps): ResolveInvitation => {
  const isStandingOwner = makeIsStandingOwner({ users, clients })

  return async (token, now) => {
    const record = await tokens.findUsable(secrets.digestOf(token), 'invitation', now)
    if (record === null) return err(invitationNotFound())
    if (!secrets.verify(token, record.tokenDigest)) return err(invitationNotFound())

    const target = invitationTargetOf(record)
    if (target === null) return err(invitationNotFound())

    if (target.kind === 'client') {
      const client = await clients.findById(target.clientId)
      if (client === null) return err(invitationNotFound())

      // Both read now: an approval is worth what the owner who gave it still is, and so is an
      // owner's own invitation. An author the box no longer has (`null`) is nobody.
      const approvedByAStandingOwner =
        record.approvedAt !== null && (await isStandingOwner(target.clientId, record.approvedBy))
      const writtenByAStandingOwner = await isStandingOwner(target.clientId, record.createdBy)
      // Counted only when the answer depends on it.
      const exempt = approvedByAStandingOwner || writtenByAStandingOwner
      const holdings = exempt
        ? { eventCount: 0, memberCount: 0 }
        : {
            eventCount: await clients.countEvents(target.clientId),
            memberCount: await clients.countMembers(target.clientId),
          }
      if (
        !clientInvitationStillHonourable({
          ...holdings,
          approvedByAStandingOwner,
          writtenByAStandingOwner,
        })
      ) {
        return err(invitationNotFound())
      }

      return ok({
        record,
        target,
        place: { kind: 'client', name: client.name.value },
        clientId: client.id,
      })
    }

    const event = await events.findById(target.eventId)
    if (event === null) return err(invitationNotFound())
    if (!isMutable(event.status)) {
      return err(DomainError.conflict('event.immutable', { status: event.status }))
    }

    const inviterRole =
      record.createdBy === null ? null : await memberships.roleFor(event.id, record.createdBy)
    if (inviterRole === null || !canInviteModerators(inviterRole)) {
      return err(invitationNotFound())
    }

    return ok({
      record,
      target,
      place: { kind: 'event', slug: event.slug.value, name: event.name.value },
      clientId: event.clientId,
    })
  }
}

export interface InvitationPreview {
  readonly kind: 'event' | 'client'
  /** What accepting grants: `moderator` of an event, or the role in the client. */
  readonly role: 'moderator' | ClientRole
  /** The event's or the client's name, as its owner wrote it. */
  readonly targetName: string
  readonly expiresAt: Date
  /**
   * The terms the person is about to agree to by accepting (G2-20), `null` on a box that asks
   * for none. **The same for every link on the box**, so it says nothing about this one, and
   * it is read after the link was found: a dead link still answers 404 and never this.
   */
  readonly terms: TermsOfUse | null
}

export interface PreviewInvitationInput {
  /** From the link. A secret: never logged, never stored. */
  readonly token: string
}

export type PreviewInvitation = (
  input: PreviewInvitationInput,
) => Promise<Result<InvitationPreview, DomainError>>

export interface PreviewInvitationDeps extends ResolveInvitationDeps {
  readonly clock: Clock
  /** `LEGAL_TERMS_URL` and `LEGAL_TERMS_VERSION`, both or neither. Absent: no terms (G2-20). */
  readonly terms?: TermsOfUse | null
}

/**
 * What a link would do, for the page that asks its holder to accept (paid plan P3-10): the
 * purpose, the target's name and when it ends — and nothing else.
 *
 * **Neutral on purpose.** It says nothing about who invited, nothing about the address the
 * link was written to, and above all nothing about whether that address already has an
 * account: the person holding a link may be the one who wrote it, and a preview that said
 * "sign in" for some addresses and "choose a password" for others would let a host learn who
 * is on the box by inviting them and looking. The page asks for a name and a password, and
 * the acceptance says what to do instead when the address turns out to be taken.
 *
 * It spends nothing and changes nothing, so opening a link in a mail client that fetches
 * links to preview them cannot use one up.
 */
export const makePreviewInvitation = (deps: PreviewInvitationDeps): PreviewInvitation => {
  const resolve = makeResolveInvitation(deps)

  return async ({ token }) => {
    const resolved = await resolve(token, deps.clock.now())
    if (!resolved.ok) return resolved

    const { record, target, place } = resolved.value
    return ok({
      kind: target.kind,
      role: target.role,
      targetName: place.name,
      expiresAt: record.expiresAt,
      terms: deps.terms ?? null,
    })
  }
}
