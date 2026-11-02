import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import { requireReadable } from '../shared/eventRole'

/**
 * What the host's best-of panel shows: how many favourites there are.
 *
 * The count is the repository's `countHighlighted`, the same predicate the ZIP lists with,
 * so "12 favourites" never becomes an empty archive.
 */

export interface GetHighlightsDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly photos: Pick<PhotoRepository, 'countHighlighted'>
}

export type GetHighlights = (input: {
  readonly eventId: EventId
}) => Promise<Result<{ readonly count: number }, DomainError>>

export const makeGetHighlights =
  ({ events, photos }: GetHighlightsDeps): GetHighlights =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const readable = requireReadable(event)
    if (!readable.ok) return readable

    return ok({ count: await photos.countHighlighted(eventId) })
  }
