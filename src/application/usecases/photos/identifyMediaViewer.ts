import type { Event } from '../../../domain/events/event'
import { canModerate } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestTokenService } from '../../ports/guestTokenService'
import type { MembershipRepository } from '../../ports/userRepository'
import { guestOfEvent } from '../guests/guestOfEvent'
import type { MediaViewer } from './getPhotoMedia'

/**
 * Who is asking for a photograph's bytes, in `getPhotoMedia`'s own vocabulary.
 *
 * Identity, not permission: `getPhotoMedia` owns the policy of which viewer may read which
 * variant of which status, and this only says who turned up. It is the third answer to "who is
 * this" beside `authenticateGuest` (a guest route, which refuses) and `requireRole` (a host route,
 * which refuses), and it is a different question because the media route has a public caller: a
 * projector holding the wall URL is legitimate and must not be turned away before the policy has
 * been applied. So where those two refuse, this **fails open to the public**, which is the least
 * privileged viewer and so the safe direction to fail in.
 *
 * - **A moderator first.** A host who also holds a guest cookie for their own event is a
 *   moderator: the broader identity wins, or their own moderation grid would show them less than
 *   they are entitled to see. A session with no membership of *this* event is the public here, and
 *   is told nothing more than the public is told. `canModerate` is asked rather than the two
 *   roles being listed, so a third, weaker role added tomorrow does not start granting.
 * - **Then a guest**, by the same three checks `authenticateGuest` makes ({@link guestOfEvent});
 *   a cookie that fails any of them (another wedding's, an event purged and recreated, a guest the
 *   host removed) leaves the caller public rather than rejected, because answering 401 would break
 *   the public wall for anyone who has ever joined anything.
 *   **Silent and not stamping the guest as seen**: a wall of thumbnails is a read per image, and a
 *   presence write per image is the cost the stamp's interval exists to avoid.
 * - **A suspended client's event** (roadmap §10.7) is `event.notFound` to the public and to a guest,
 *   as an event that is not there; its moderators are refused with `403 client.suspended` (S5), and a taken-down event is `event.notFound` to all. The rule is
 *   here and not in the handler, next to the identity it is a function of.
 */

export interface IdentifyMediaViewerInput {
  /** Resolved from the URL by the caller, never from anything the client sent. */
  readonly event: Event
  /** The raw `es_guest` cookie, if the request carried one. Untrusted until verified. */
  readonly guestToken: string | undefined
  /** The signed-in account, if the request carried a session. */
  readonly userId: UserId | undefined
}

export interface IdentifyMediaViewerDeps {
  readonly guests: GuestRepository
  readonly tokens: GuestTokenService
  readonly memberships: MembershipRepository
  readonly clock: Clock
}

export type IdentifyMediaViewer = (
  input: IdentifyMediaViewerInput,
) => Promise<Result<MediaViewer, DomainError>>

export const makeIdentifyMediaViewer =
  ({ guests, tokens, memberships, clock }: IdentifyMediaViewerDeps): IdentifyMediaViewer =>
  async ({ event, guestToken, userId }) => {
    const viewer = await identify({ guests, tokens, memberships, clock }, event, guestToken, userId)

    // Taken down by the operator: the same answer as an event that is not there, to everybody.
    if (event.isTakenDown()) return err(DomainError.notFound('event.notFound'))
    if (event.isClientSuspended()) {
      // A suspended client's members no longer read photographs either (launch review S5); they
      // are told why, as on every other refusal of a member, and everybody else is not.
      return viewer.kind === 'moderator'
        ? err(DomainError.forbidden('client.suspended'))
        : err(DomainError.notFound('event.notFound'))
    }
    return ok(viewer)
  }

const identify = async (
  { guests, tokens, memberships, clock }: IdentifyMediaViewerDeps,
  event: Event,
  guestToken: string | undefined,
  userId: UserId | undefined,
): Promise<MediaViewer> => {
  if (userId !== undefined) {
    const role = await memberships.roleFor(event.id, userId)
    if (role !== null && canModerate(role)) return { kind: 'moderator', userId }
  }

  if (guestToken === undefined || guestToken.length === 0) return { kind: 'public' }

  const claims = tokens.verify(guestToken, clock.now())
  if (!claims.ok) return { kind: 'public' }

  const guest = await guestOfEvent(guests, claims.value, event)
  return guest.ok ? { kind: 'guest', guestId: guest.value.id } : { kind: 'public' }
}
