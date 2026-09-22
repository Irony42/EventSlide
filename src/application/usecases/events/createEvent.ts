import { Event } from '../../../domain/events/event'
import { EventName } from '../../../domain/events/eventName'
import { EventSettings } from '../../../domain/events/eventSettings'
import type { EventLanguage } from '../../../domain/events/eventLanguage'
import { eventTemplateSettings, type EventTemplateKey } from '../../../domain/events/eventTemplate'
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
  /**
   * Which of the four presets to start this event's settings from (roadmap 3.5).
   *
   * Absent means the product defaults, which is what every event created before this
   * field existed got and what a host who picks nothing still gets.
   *
   * **Read exactly once, here.** The chosen values are copied into the event's settings
   * and the key is not stored — no column, no DTO field, nothing to consult later. That
   * is the whole design: a host who picks "wedding" and then changes moderation has
   * changed their event and not departed from anything, because there is nothing left to
   * depart from. See `src/domain/events/eventTemplate.ts` for why the alternative — an
   * event that stays attached to a living template — is a worse product.
   */
  readonly template?: EventTemplateKey
  /**
   * The language the projected wall will speak (roadmap 1.5).
   *
   * Supplied by the create form as **the language its host was reading at that moment**,
   * which is the only signal anyone has about a screen nobody will be holding. Absent
   * means the domain's own default, which is what an event created through the API with
   * no opinion gets, and what every event created before this field existed has.
   *
   * Applied on top of the template, not merged into it: no preset has an opinion about
   * language, and one that grew one would be describing the room rather than the evening.
   */
  readonly wallLanguage?: EventLanguage
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

    // The template is applied here and then forgotten. `eventTemplateSettings` is
    // total — the catalogue is validated at import, so a preset can never reach a host
    // as a 400 on a form with no field to correct.
    const preset =
      input.template === undefined ? EventSettings.default() : eventTemplateSettings(input.template)

    // The creator's language on top, because no template has an opinion about it. This
    // is the one place the value is read from anybody's preference; from here on it is
    // the event's, and only the settings page moves it.
    const settings =
      input.wallLanguage === undefined
        ? ok(preset)
        : preset.with({ wallLanguage: input.wallLanguage })
    if (!settings.ok) return settings

    const now = clock.now()
    const created = Event.create(
      {
        ownerId: input.ownerId,
        name: name.value,
        slug: slug.value,
        joinCode: joinCode.value,
        settings: settings.value,
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
