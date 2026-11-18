import { isVoiceOpen } from '../../../domain/events/eventGuestbookVoiceSettings'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { VOICE_VARIANT } from '../../../domain/photos/mediaVariant'
import { DomainError } from '../../../domain/shared/errors'
import type { PhotoActor } from '../../../domain/photos/photo'
import type { EventId, GuestbookEntryId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import { type ByteRange, type MediaStore } from '../../ports/mediaStore'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireReadable } from '../shared/eventRole'

/**
 * The bytes of one voice message, for the host or a moderator who listens (spec 25, rule 11).
 *
 * **This is the only door a recording has**, and it is judged again on every request, a `Range`
 * request of a player included, before a byte is opened: the role (a moderator of **this** event),
 * the state of the client, that the message is **ready**, that the operator has not taken it down,
 * and that the secret is lifted. The recording's variant is outside `SERVED_VARIANTS`, so no photo
 * route can reach it whatever a client puts in a URL; the sweep in `mediaRoutes` proves it.
 *
 * Two answers, and only two, that are not the one refusal:
 *
 * - **`403 guestbook.voiceSealed`**, to **everybody**, the owner included: "kept secret until the end
 *   of the evening" is a promise the host made to themselves, and a rule with an exception for the
 *   person who set it is a rule one forgotten laptop can break. Asked only once the message is known
 *   to exist and be ready, so the answer says nothing a moderator could not already read from the
 *   book (`voice.sealed`), and cannot be used to probe an id.
 * - **`403 client.suspended`**, as the photographs' reads give a frozen client's members.
 *
 * Everything else is **`404 guestbook.notFound`**: an id nobody holds, another event's message, one
 * the operator took down (the repository never returns it), a written message (it has no voice), a
 * recording not ready yet or that failed, and a row whose file is gone (a restored backup). One
 * refusal for all of them, so the status says nothing about which.
 *
 * The author is refused like anybody else who is not a moderator: nothing here reads a guest. The
 * phone listens to its recording **before** it sends it, locally, and not after.
 */

export interface GuestbookVoiceMedia {
  readonly contentHash: ContentHash
  readonly byteSize: number
  readonly contentType: string
  readonly open: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array> | null>
}

export interface GetGuestbookVoiceMediaInput {
  readonly eventId: EventId
  readonly entryId: GuestbookEntryId
  /** Who listens, from the session and never from the request: a guest is refused outright. */
  readonly actor: PhotoActor
}

export interface GetGuestbookVoiceMediaDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly guestbook: Pick<GuestbookRepository, 'findById'>
  readonly memberships: Pick<MembershipRepository, 'roleFor'>
  readonly media: Pick<MediaStore, 'stat' | 'openRead'>
  readonly clock: Clock
}

export type GetGuestbookVoiceMedia = (
  input: GetGuestbookVoiceMediaInput,
) => Promise<Result<GuestbookVoiceMedia, DomainError>>

const notFound = (): DomainError => DomainError.notFound('guestbook.notFound')

export const makeGetGuestbookVoiceMedia =
  ({
    events,
    guestbook,
    memberships,
    media,
    clock,
  }: GetGuestbookVoiceMediaDeps): GetGuestbookVoiceMedia =>
  async ({ eventId, entryId, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    if (actor.kind === 'guest') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'moderator' }))
    }

    const allowed = await requireEventRole(memberships, eventId, actor.userId, 'moderate')
    if (!allowed.ok) return allowed

    const readable = requireReadable(event)
    if (!readable.ok) return readable

    // Scoped by the event of the URL, and the repository leaves out what the operator took down.
    const entry = await guestbook.findById(eventId, entryId)
    const voice = entry?.voice ?? null
    if (voice === null || !voice.isReady() || voice.audioHash === null) return err(notFound())

    if (!isVoiceOpen(event.settings.guestbookVoice, event, clock.now())) {
      return err(DomainError.forbidden('guestbook.voiceSealed'))
    }

    const hash = voice.audioHash
    const metadata = await media.stat(eventId, hash, VOICE_VARIANT)
    if (metadata === null) return err(notFound())

    return ok({
      contentHash: hash,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      open: (range) => media.openRead(eventId, hash, VOICE_VARIANT, range),
    })
  }
