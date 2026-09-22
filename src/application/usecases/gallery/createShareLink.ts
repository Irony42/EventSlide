import { canManageEvent } from '../../../domain/events/eventRole'
import { ShareLink } from '../../../domain/gallery/shareLink'
import { ShareLinkLifetime } from '../../../domain/gallery/shareLinkLifetime'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GallerySigner } from '../../ports/gallerySigner'
import type { IdGenerator } from '../../ports/idGenerator'
import type { PasswordHasher } from '../../ports/passwordHasher'
import type { ShareLinkRepository } from '../../ports/shareLinkRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host makes the link they will send after the event (docs/ROADMAP.md §4.1).
 *
 * **Owner only.** Sending the album to people outside the room is a decision about the
 * whole event, the same grant as its settings and its join code — a moderator handed a
 * laptop for the evening cannot publish the photographs to the internet.
 *
 * **Making a link replaces the current one, in the same transaction.** One link per
 * event keeps the host's mental model to one sentence — "the link I sent" — and it is the
 * lever for a link that has gone further than meant: make a new one, and the old one
 * stops opening at that instant.
 *
 * **Any status.** A link is about the album, and the album outlives the evening: a host
 * archives the event and *then* sends the photographs, which is the likeliest order of
 * all. Nothing about uploads, the wall or moderation is touched by a link existing.
 *
 * The token is returned **once**, here, and never again: only its digest is stored, so the
 * console cannot show it a second time. A host who loses it makes a new one.
 */

export interface CreateShareLinkInput {
  readonly eventId: EventId
  readonly actorId: UserId
  /** Whole days. Absent (or `null`) is the default month. */
  readonly lifetimeDays?: number | null
  /** Absent, `null` or empty is "no password". */
  readonly password?: string | null
}

export interface CreatedShareLink {
  readonly link: ShareLink
  /** The secret for the URL. The only time it exists outside the host's message. */
  readonly token: string
}

export interface CreateShareLinkDeps {
  readonly events: EventRepository
  readonly shareLinks: ShareLinkRepository
  readonly memberships: MembershipRepository
  readonly hasher: PasswordHasher
  readonly signer: GallerySigner
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type CreateShareLink = (
  input: CreateShareLinkInput,
) => Promise<Result<CreatedShareLink, DomainError>>

export const makeCreateShareLink =
  ({
    events,
    shareLinks,
    memberships,
    hasher,
    signer,
    ids,
    clock,
  }: CreateShareLinkDeps): CreateShareLink =>
  async ({ eventId, actorId, lifetimeDays, password }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    // `notFound` for a stranger, so this cannot confirm that the event exists.
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    const lifetime = ShareLinkLifetime.create(lifetimeDays ?? undefined)
    if (!lifetime.ok) return lifetime

    let passwordHash: PasswordHash | null = null
    if (password !== undefined && password !== null && password !== '') {
      // The account policy, and the account hasher: a gallery password protects a family's
      // photographs from whoever the link was forwarded to, which is no smaller a thing
      // than a moderator's login. The event's name is refused as a password for the reason
      // an account's email is.
      const parsed = Password.create(password, { displayName: event.name.value })
      if (!parsed.ok) return parsed
      passwordHash = await hasher.hash(parsed.value)
    }

    const minted = signer.mintToken()
    const now = clock.now()
    const link = ShareLink.create(
      {
        eventId,
        tokenDigest: minted.digest,
        passwordHash,
        createdBy: actorId,
        lifetime: lifetime.value,
      },
      ids.shareLinkId(),
      now,
    )
    if (!link.ok) return link

    await shareLinks.replaceCurrent(link.value, now)

    return ok({ link: link.value, token: minted.token })
  }
