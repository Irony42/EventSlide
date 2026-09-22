import { canManageEvent } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { ShareLinkRepository } from '../../ports/shareLinkRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host takes the link back. **Immediately**: every request a gallery makes — the page,
 * each thumbnail, each download, and each entry of an archive already streaming — re-reads
 * the link, so there is no signed URL still valid "until it expires" after this returns.
 *
 * Idempotent. Revoking when there is no current link succeeds, so a host pressing the
 * button twice, or in two tabs, is not shown an error about a link that is already gone.
 */

export interface RevokeShareLinkInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface RevokeShareLinkDeps {
  readonly events: EventRepository
  readonly shareLinks: ShareLinkRepository
  readonly memberships: MembershipRepository
  readonly clock: Clock
}

export type RevokeShareLink = (input: RevokeShareLinkInput) => Promise<Result<void, DomainError>>

export const makeRevokeShareLink =
  ({ events, shareLinks, memberships, clock }: RevokeShareLinkDeps): RevokeShareLink =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    await shareLinks.revokeCurrent(eventId, clock.now())
    return ok(undefined)
  }
