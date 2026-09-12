import { Event } from '../../../domain/events/event'
import { EventName } from '../../../domain/events/eventName'
import { EventSettings } from '../../../domain/events/eventSettings'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { JoinCode } from '../../../domain/shared/joinCode'
import { err, ok, type Result } from '../../../domain/shared/result'
import { Slug } from '../../../domain/shared/slug'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * Five, because 32^6 is a billion codes: a working generator does not collide five
 * times in a row, so a sixth attempt would only be there to hide a generator stuck on
 * a constant — which must surface as a failure instead of spinning forever.
 */
const MAX_JOIN_CODE_ATTEMPTS = 5

export interface CreateEventInput {
  readonly ownerId: UserId
  readonly name: string
  /** Absent means "derive it from the name", which is what the host-facing form does. */
  readonly slug?: string
  readonly startsAt?: Date | null
  readonly quotaBytes?: number
}

export interface CreateEventDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly ids: IdGenerator
  readonly clock: Clock
  /**
   * `uploads.defaultEventQuotaBytes` from configuration. The create form asks for a
   * name and nothing else, so the quota has to come from somewhere that is not the
   * host — and an application layer that cannot read `process.env` is handed it.
   */
  readonly defaultQuotaBytes: number
}

export type CreateEvent = (input: CreateEventInput) => Promise<Result<Event, DomainError>>

/**
 * A free join code, or the reason there is none.
 *
 * The code space is shared by every event on the box, because `/join/:code` resolves
 * without knowing which event it belongs to. A collision would send a guest to the
 * wrong party — 1.0's worst defect, in a new shape — so the unique index refuses it and
 * `save` would throw rather than return a `Result`. Asking the repository first turns
 * that into an ordinary retry.
 */
const allocateJoinCode = async (
  events: EventRepository,
  ids: IdGenerator,
): Promise<Result<JoinCode, DomainError>> => {
  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const candidate = JoinCode.fromBytes(ids.bytes(JoinCode.entropyBytes))
    if (!candidate.ok) return candidate
    if (!(await events.joinCodeTaken(candidate.value))) return ok(candidate.value)
  }
  // `unexpected`, not `conflict`: nothing about the host's input collided, and there is
  // nothing for them to change and retry. It is the box that is broken.
  return err(
    DomainError.unexpected('event.joinCodeExhausted', { attempts: MAX_JOIN_CODE_ATTEMPTS }),
  )
}

export const makeCreateEvent =
  ({ events, memberships, ids, clock, defaultQuotaBytes }: CreateEventDeps): CreateEvent =>
  async (input) => {
    const name = EventName.create(input.name)
    if (!name.ok) return name

    // One slugifier for the whole product: the host-facing form previews the slug with
    // the same function, so "the slug I saw is not the slug I got" cannot happen.
    const slug =
      input.slug === undefined ? Slug.fromName(name.value.value) : Slug.create(input.slug)
    if (!slug.ok) return slug

    if (await events.slugTaken(slug.value)) {
      return err(DomainError.conflict('event.slugTaken', { slug: slug.value.value }))
    }

    const joinCode = await allocateJoinCode(events, ids)
    if (!joinCode.ok) return joinCode

    const now = clock.now()
    const created = Event.create(
      {
        ownerId: input.ownerId,
        name: name.value,
        slug: slug.value,
        joinCode: joinCode.value,
        settings: EventSettings.default(),
        quotaBytes: input.quotaBytes ?? defaultQuotaBytes,
        startsAt: input.startsAt ?? null,
      },
      ids.eventId(),
      now,
    )
    if (!created.ok) return created

    await events.save(created.value)
    // The owner role is a membership row, not the `owner_id` column alone: every
    // authorization decision in this product reads `roleFor(eventId, userId)`, so a
    // creator without this row could not open the event they just created.
    await memberships.grant({
      eventId: created.value.id,
      userId: input.ownerId,
      role: 'owner',
      grantedAt: now,
    })

    // Nothing is announced. The bus is subscribed per event by phones and projectors
    // that cannot yet be watching an event which did not exist a moment ago.
    return ok(created.value)
  }
