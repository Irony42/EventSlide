import { canManageEvent } from '../../../domain/events/eventRole'
import type { ShareLink } from '../../../domain/gallery/shareLink'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { ShareLinkRepository } from '../../ports/shareLinkRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { eventBehind } from './galleryAccess'

/**
 * What the host's console shows about the event's link: whether there is one, until when,
 * whether it has a password — and whether it **actually opens right now**.
 *
 * `available` is computed by the very function the gallery itself asks (`eventBehind`),
 * so the console and a guest's phone cannot disagree. That matters for the one case a
 * host cannot see from the dates: a link made by a co-owner whose account has since been
 * switched off opens nothing, and the owner looking at the console is told so rather than
 * shown a link that looks fine.
 *
 * Owner only, like making one. The URL is not here, because it is not stored — see
 * `createShareLink`.
 */

export interface ShareLinkView {
  readonly link: ShareLink
  readonly available: boolean
}

export interface GetShareLinkInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface GetShareLinkDeps {
  readonly events: EventRepository
  readonly shareLinks: ShareLinkRepository
  readonly memberships: MembershipRepository
  readonly clock: Clock
}

export type GetShareLink = (
  input: GetShareLinkInput,
) => Promise<Result<ShareLinkView | null, DomainError>>

export const makeGetShareLink =
  ({ events, shareLinks, memberships, clock }: GetShareLinkDeps): GetShareLink =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    const link = await shareLinks.findCurrent(eventId)
    if (link === null) return ok(null)

    const available = (await eventBehind({ events, memberships }, link, clock.now())) !== null
    return ok({ link, available })
  }
