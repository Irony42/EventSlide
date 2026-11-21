import { GuestInviteToken } from '../../../domain/guestInvites/guestInviteToken'
import { servedInviteOf } from '../../../domain/guestInvites/inviteStateOf'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { EVENT_LOGO } from '../../../domain/photos/mediaVariant'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { ByteRange, MediaStore } from '../../ports/mediaStore'

/**
 * The event's logo, for the public invitation page (spec 29).
 *
 * The usual logo route serves a logo only while the wall is served, which would leave the page of
 * a **draft** (the weeks before the party, which is when the invitation is read) with no logo. The
 * rule here is the page's own: the logo is served as long as the invitation page is (`upcoming`,
 * `joinable` or `over`), and **never otherwise**, so a token that no longer opens the page does not
 * open its logo either.
 *
 * The bytes are the one the event's settings name **now**, so a replaced or removed logo is
 * unreadable the moment the row changes. Every refusal is the page's own `404
 * guestInvite.notAvailable`, a malformed token and an event without a logo included.
 */

export interface GuestInviteLogoMedia {
  /** The ETag: the name changes when the bytes do. */
  readonly contentHash: ContentHash
  readonly byteSize: number
  readonly contentType: string
  /** The bytes, opened only if they are going to be sent. Call it at most once. */
  readonly open: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array> | null>
}

export interface GetGuestInviteLogoMediaDeps {
  readonly events: EventRepository
  readonly invites: GuestInviteRepository
  readonly media: MediaStore
}

export type GetGuestInviteLogoMedia = (input: {
  readonly token: unknown
}) => Promise<Result<GuestInviteLogoMedia, DomainError>>

const notAvailable = (): Result<never, DomainError> =>
  err(DomainError.notFound('guestInvite.notAvailable'))

export const makeGetGuestInviteLogoMedia =
  ({ events, invites, media }: GetGuestInviteLogoMediaDeps): GetGuestInviteLogoMedia =>
  async ({ token: raw }) => {
    const token = GuestInviteToken.create(raw)
    if (!token.ok) return notAvailable()

    const invite = await invites.findByToken(token.value)
    if (invite === null) return notAvailable()
    const event = await events.findById(invite.eventId)
    if (event === null || servedInviteOf(event, invite) === null) return notAvailable()

    const hash = event.settings.logo
    if (hash === null) return notAvailable()
    const metadata = await media.stat(event.id, hash, EVENT_LOGO)
    if (metadata === null) return notAvailable()

    return ok({
      contentHash: hash,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      open: (range?: ByteRange) => media.openRead(event.id, hash, EVENT_LOGO, range),
    })
  }
