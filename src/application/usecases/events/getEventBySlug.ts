import type { Event } from '../../../domain/events/event'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import { Slug } from '../../../domain/shared/slug'
import type { EventRepository } from '../../ports/eventRepository'

/**
 * Resolve `/e/:slug` and every `/api/events/:slug` route to its aggregate.
 *
 * Deliberately status-blind. A host has to be able to open a `draft` event to set it
 * up, and to reopen an `archived` one to read the album; refusing anything here would
 * make the console unusable the day before the party. Who may see what is the role
 * check's job, and it runs before this.
 */

export interface GetEventBySlugInput {
  readonly slug: string
}

export interface GetEventBySlugDeps {
  readonly events: EventRepository
}

export type GetEventBySlug = (input: GetEventBySlugInput) => Promise<Result<Event, DomainError>>

export const makeGetEventBySlug =
  ({ events }: GetEventBySlugDeps): GetEventBySlug =>
  async ({ slug }) => {
    const parsed = Slug.create(slug)
    // A string that is not slug-shaped names no row, so it answers exactly as an
    // absent one does. Two distinguishable errors for "there is no such event" would
    // only give a caller a way to sort real slugs from unreal ones.
    if (!parsed.ok) return err(DomainError.notFound('event.notFound'))

    const event = await events.findBySlug(parsed.value)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    return ok(event)
  }
