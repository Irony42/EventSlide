import { beforeEach, describe, expect, it } from 'vitest'
import type { Event } from '../../../domain/events/event'
import { EventSettings } from '../../../domain/events/eventSettings'
import { eventTemplateSettings } from '../../../domain/events/eventTemplate'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { JoinCode } from '../../../domain/shared/joinCode'
import type { Result } from '../../../domain/shared/result'
import { Slug } from '../../../domain/shared/slug'
import { AT, anEvent } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeCreateEvent, type CreateEvent } from './createEvent'

const OWNER = asUserId('user-host')
const DEFAULT_QUOTA = 5_000_000_000
const STARTS_AT = new Date('2026-06-20T17:00:00.000Z')

/**
 * D-14: a self-hosted box stays exactly as it was before P4-09 — `EVENT_SLUG_SUFFIX`
 * off, `ALLOW_CUSTOM_SLUGS` on, `JOIN_CODE_LENGTH` six. Every test in this file that is
 * not specifically about one of the three configurable behaviours spreads this, so a
 * reader can tell the ordinary cases from the ones that turn a switch.
 */
const CORE_DEFAULTS = {
  slugSuffix: 'none',
  allowCustomSlugs: true,
  joinCodeLength: 6,
} as const

/**
 * `SequentialIdGenerator.bytes` walks `0, 1, 2, …`, and `JoinCode.fromBytes` maps each
 * byte onto its alphabet — so the first code a test sees is exactly this one, and the
 * second is {@link SECOND_CODE}. Asserting the printed code beats matching a pattern.
 */
const FIRST_CODE = '012345'
const SECOND_CODE = '6789AB'

const unwrap = (result: Result<Event, DomainError>): Event => {
  if (!result.ok) throw new Error(`unexpected domain error: ${result.error.code}`)
  return result.value
}

const slug = (value: string): Slug => {
  const parsed = Slug.create(value)
  if (!parsed.ok) throw new Error(`invalid test slug: ${value}`)
  return parsed.value
}

const joinCode = (value: string): JoinCode => {
  const parsed = JoinCode.create(value)
  if (!parsed.ok) throw new Error(`invalid test join code: ${value}`)
  return parsed.value
}

/** A box whose join-code space answers "taken" to everything — what the bound is for. */
class SaturatedEventRepository extends FakeEventRepository {
  override async joinCodeTaken(): Promise<boolean> {
    return true
  }
}

/** The same bound, for the random slug suffix's own retry loop. */
class SlugSaturatedEventRepository extends FakeEventRepository {
  override async slugTaken(): Promise<boolean> {
    return true
  }
}

/** A generator that under-delivers entropy: the port lying, which `JoinCode` refuses. */
class ShortEntropyIdGenerator extends SequentialIdGenerator {
  override bytes(count: number): Uint8Array {
    return super.bytes(count).slice(1)
  }
}

describe('createEvent', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let ids: SequentialIdGenerator
  let clock: FakeClock
  let createEvent: CreateEvent

  beforeEach(() => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    ids = new SequentialIdGenerator()
    clock = new FakeClock()
    createEvent = makeCreateEvent({
      events,
      memberships,
      ids,
      clock,
      defaultQuotaBytes: DEFAULT_QUOTA,
      maxQuotaBytes: null,
      ...CORE_DEFAULTS,
    })
  })

  it('creates the event as a draft, so the host opens the doors deliberately', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(unwrap(result).status).toBe('draft')
  })

  it('stamps creation with the injected clock', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(unwrap(result).createdAt).toEqual(AT)
  })

  it('saves the event under the slug a projector will resolve', async () => {
    await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    const stored = await events.findBySlug(slug('camille-sacha'))

    expect(stored?.id).toBe(asEventId('event-1'))
  })

  // ------------------------------------------------------------------- slug --

  it('derives the slug from the name when the host gave none', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha à Lyon' })

    expect(unwrap(result).slug.value).toBe('camille-sacha-a-lyon')
  })

  it('keeps the slug the host typed', async () => {
    const result = await createEvent({
      ownerId: OWNER,
      name: 'Camille & Sacha',
      slug: 'gala-2026',
    })

    expect(unwrap(result).slug.value).toBe('gala-2026')
  })

  it('refuses a slug the host typed that is not slug-shaped', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha', slug: 'Gala 2026' })

    expect(!result.ok && result.error.code).toBe('slug.malformed')
  })

  it('refuses a name that folds to a slug too short to put in a URL', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'é!' })

    expect(!result.ok && result.error.code).toBe('slug.tooShort')
  })

  it('refuses a name that folds onto an application route', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'Admin' })

    expect(!result.ok && result.error.code).toBe('slug.reserved')
  })

  it('refuses a slug another event already holds, derived or not', async () => {
    events.seed(anEvent({ id: 'evt-other', slug: 'camille-sacha', joinCode: 'H7K2QM' }))

    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(!result.ok && result.error.code).toBe('event.slugUnavailable')
  })

  it('reports a taken slug as a conflict, so the form can offer another', async () => {
    events.seed(anEvent({ id: 'evt-other', slug: 'camille-sacha', joinCode: 'H7K2QM' }))

    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(!result.ok && result.error.kind).toBe('conflict')
  })

  // The regression this replaces: `createEvent.ts:111` used to answer
  // `event.slugTaken` with the computed slug in its details, which proved a caller who
  // only ever typed a free-text name the literal, already-normalised address of another
  // tenant's event (docs/SECURITY.md, R-08 / A-16 / A-42 — "collision neutre", P4-09).
  it('answers a slug collision with no echo of the slug it computed', async () => {
    events.seed(anEvent({ id: 'evt-other', slug: 'camille-sacha', joinCode: 'H7K2QM' }))

    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(!result.ok && result.error.details).toEqual({})
  })

  it('answers a custom slug collision the same neutral way', async () => {
    events.seed(anEvent({ id: 'evt-other', slug: 'gala-2026', joinCode: 'H7K2QM' }))

    const result = await createEvent({
      ownerId: OWNER,
      name: 'Un autre évènement',
      slug: 'gala-2026',
    })

    expect(!result.ok && result.error.code).toBe('event.slugUnavailable')
    expect(!result.ok && result.error.details).toEqual({})
  })

  it('refuses a name the domain will not accept', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'A' })

    expect(!result.ok && result.error.code).toBe('eventName.tooShort')
  })

  // ---------------------------------------------------- ALLOW_CUSTOM_SLUGS=false --

  describe('with custom slugs disabled (the hosted instance)', () => {
    let createWithoutCustomSlugs: CreateEvent

    beforeEach(() => {
      createWithoutCustomSlugs = makeCreateEvent({
        events,
        memberships,
        ids,
        clock,
        defaultQuotaBytes: DEFAULT_QUOTA,
        maxQuotaBytes: null,
        ...CORE_DEFAULTS,
        allowCustomSlugs: false,
      })
    })

    it('refuses a host-supplied slug outright, rather than silently ignoring it', async () => {
      const result = await createWithoutCustomSlugs({
        ownerId: OWNER,
        name: 'Camille & Sacha',
        slug: 'gala-2026',
      })

      expect(!result.ok && result.error.code).toBe('event.customSlugNotAllowed')
    })

    it('saves nothing when a host-supplied slug is refused', async () => {
      await createWithoutCustomSlugs({
        ownerId: OWNER,
        name: 'Camille & Sacha',
        slug: 'gala-2026',
      })

      expect(await events.findBySlug(slug('gala-2026'))).toBeNull()
    })

    it('still derives a slug from the name when the host supplied none', async () => {
      const result = await createWithoutCustomSlugs({ ownerId: OWNER, name: 'Camille & Sacha' })

      expect(unwrap(result).slug.value).toBe('camille-sacha')
    })
  })

  // --------------------------------------------------- EVENT_SLUG_SUFFIX=random --

  describe('with a random slug suffix (the hosted instance)', () => {
    let createWithRandomSuffix: CreateEvent

    beforeEach(() => {
      createWithRandomSuffix = makeCreateEvent({
        events,
        memberships,
        ids,
        clock,
        defaultQuotaBytes: DEFAULT_QUOTA,
        maxQuotaBytes: null,
        ...CORE_DEFAULTS,
        slugSuffix: 'random',
      })
    })

    it('always appends a random suffix to a derived slug, not only on collision', async () => {
      const result = await createWithRandomSuffix({ ownerId: OWNER, name: 'Camille & Sacha' })

      // `SequentialIdGenerator.bytes` walks `0, 1, 2, …`, so the first six bytes this
      // call consumes map onto the suffix alphabet's own first six characters.
      expect(unwrap(result).slug.value).toBe('camille-sacha-012345')
    })

    it('never saves the bare derived slug a sequential fallback would have revealed existed', async () => {
      await createWithRandomSuffix({ ownerId: OWNER, name: 'Camille & Sacha' })

      expect(await events.findBySlug(slug('camille-sacha'))).toBeNull()
    })

    it('still honours a host-supplied slug: the suffix only applies to a derived one', async () => {
      const result = await createWithRandomSuffix({
        ownerId: OWNER,
        name: 'Camille & Sacha',
        slug: 'gala-2026',
      })

      expect(unwrap(result).slug.value).toBe('gala-2026')
    })

    it('retries with a fresh suffix past a collision, rather than refusing the host', async () => {
      // The first suffix this generator derives collides; a working generator must not
      // surface that as a conflict the host can do nothing about.
      events.seed(anEvent({ id: 'evt-other', slug: 'camille-sacha-012345', joinCode: 'Z3N9PT' }))

      const result = await createWithRandomSuffix({ ownerId: OWNER, name: 'Camille & Sacha' })

      expect(result.ok).toBe(true)
      expect(unwrap(result).slug.value).not.toBe('camille-sacha-012345')
    })

    it('gives up rather than looping when every suffix it tries is already taken', async () => {
      const saturatedSlugs = new SlugSaturatedEventRepository()
      const create = makeCreateEvent({
        events: saturatedSlugs,
        memberships,
        ids,
        clock,
        defaultQuotaBytes: DEFAULT_QUOTA,
        maxQuotaBytes: null,
        ...CORE_DEFAULTS,
        slugSuffix: 'random',
      })

      const result = await create({ ownerId: OWNER, name: 'Camille & Sacha' })

      expect(!result.ok && result.error.code).toBe('event.slugExhausted')
      expect(!result.ok && result.error.kind).toBe('unexpected')
    })
  })

  // -------------------------------------------------------- JOIN_CODE_LENGTH --

  describe('a configured join code length', () => {
    it('mints a code of the configured length instead of the default six', async () => {
      const create = makeCreateEvent({
        events,
        memberships,
        ids,
        clock,
        defaultQuotaBytes: DEFAULT_QUOTA,
        maxQuotaBytes: null,
        ...CORE_DEFAULTS,
        joinCodeLength: 8,
      })

      const result = await create({ ownerId: OWNER, name: 'Camille & Sacha' })

      expect(unwrap(result).joinCode.value).toHaveLength(8)
    })
  })

  // -------------------------------------------------------------- join code --

  it('derives the join code from injected entropy', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(unwrap(result).joinCode.value).toBe(FIRST_CODE)
  })

  it('retries past a join code another event on the box already holds', async () => {
    events.seed(anEvent({ id: 'evt-other', slug: 'gala-annuel', joinCode: FIRST_CODE }))

    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(unwrap(result).joinCode.value).toBe(SECOND_CODE)
  })

  it('gives up rather than looping when no join code is free', async () => {
    const saturated = new SaturatedEventRepository()
    const create = makeCreateEvent({
      events: saturated,
      memberships,
      ids,
      clock,
      defaultQuotaBytes: DEFAULT_QUOTA,
      maxQuotaBytes: null,
      ...CORE_DEFAULTS,
    })

    const result = await create({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(!result.ok && result.error.code).toBe('event.joinCodeExhausted')
  })

  it('saves nothing when it cannot allocate a join code', async () => {
    const saturated = new SaturatedEventRepository()
    const create = makeCreateEvent({
      events: saturated,
      memberships,
      ids,
      clock,
      defaultQuotaBytes: DEFAULT_QUOTA,
      maxQuotaBytes: null,
      ...CORE_DEFAULTS,
    })

    await create({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(await saturated.listForUser(OWNER)).toEqual([])
  })

  it('surfaces a generator that hands back too little entropy for a code', async () => {
    const create = makeCreateEvent({
      events,
      memberships,
      ids: new ShortEntropyIdGenerator(),
      clock,
      defaultQuotaBytes: DEFAULT_QUOTA,
      maxQuotaBytes: null,
      ...CORE_DEFAULTS,
    })

    const result = await create({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(!result.ok && result.error.code).toBe('joinCode.wrongEntropyLength')
  })

  it('saves the event under the join code a guest will type', async () => {
    await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    const stored = await events.findByJoinCode(joinCode(FIRST_CODE))

    expect(stored?.id).toBe(asEventId('event-1'))
  })

  // ------------------------------------------------------------------ quota --

  it('keeps the quota the host chose', async () => {
    const result = await createEvent({
      ownerId: OWNER,
      name: 'Camille & Sacha',
      quotaBytes: 12_345,
    })

    expect(unwrap(result).quotaBytes).toBe(12_345)
  })

  it('falls back to the configured quota, because the form asks only for a name', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(unwrap(result).quotaBytes).toBe(DEFAULT_QUOTA)
  })

  it('refuses a quota the domain will not accept', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha', quotaBytes: 0 })

    expect(!result.ok && result.error.code).toBe('event.quotaBytesInvalid')
  })

  // ------------------------------------------------------- box-wide ceiling --
  // G3-02: a box-wide MAX_EVENT_QUOTA_BYTES nobody's request may cross.

  describe('the box-wide ceiling', () => {
    const MAX_QUOTA = 10_000_000_000

    let ceilinged: CreateEvent

    beforeEach(() => {
      ceilinged = makeCreateEvent({
        events,
        memberships,
        ids,
        clock,
        defaultQuotaBytes: DEFAULT_QUOTA,
        maxQuotaBytes: MAX_QUOTA,
        ...CORE_DEFAULTS,
      })
    })

    it('accepts a quota exactly at the ceiling', async () => {
      const result = await ceilinged({
        ownerId: OWNER,
        name: 'Camille & Sacha',
        quotaBytes: MAX_QUOTA,
      })

      expect(unwrap(result).quotaBytes).toBe(MAX_QUOTA)
    })

    it('refuses a quota one byte over the ceiling, and does not silently reduce it to the ceiling', async () => {
      const result = await ceilinged({
        ownerId: OWNER,
        name: 'Camille & Sacha',
        quotaBytes: MAX_QUOTA + 1,
      })

      expect(!result.ok && result.error.code).toBe('event.quotaAboveCeiling')
      expect(!result.ok && result.error.details).toEqual({ maxBytes: MAX_QUOTA })
    })

    it('saves nothing when the requested quota is above the ceiling', async () => {
      await ceilinged({ ownerId: OWNER, name: 'Camille & Sacha', quotaBytes: MAX_QUOTA + 1 })

      expect(await events.listForUser(OWNER)).toEqual([])
    })

    it('never compares the configured default against the ceiling, because env.ts already guarantees it fits', async () => {
      // No `quotaBytes` in the request at all — the path that falls back to
      // `defaultQuotaBytes` — must never be refused for a ceiling reason, even one set
      // below the default: that combination cannot be configured (env.ts refuses it),
      // so this is what proves the comparison is skipped rather than coincidentally
      // passing.
      const create = makeCreateEvent({
        events,
        memberships,
        ids,
        clock,
        defaultQuotaBytes: DEFAULT_QUOTA,
        maxQuotaBytes: DEFAULT_QUOTA,
        ...CORE_DEFAULTS,
      })

      const result = await create({ ownerId: OWNER, name: 'Camille & Sacha' })

      expect(unwrap(result).quotaBytes).toBe(DEFAULT_QUOTA)
    })

    it('imposes no ceiling when none is configured', async () => {
      const result = await createEvent({
        ownerId: OWNER,
        name: 'Camille & Sacha',
        quotaBytes: 1_000_000_000_000_000,
      })

      expect(unwrap(result).quotaBytes).toBe(1_000_000_000_000_000)
    })
  })

  // ------------------------------------------------------------- start time --

  it('keeps the start time the host scheduled', async () => {
    const result = await createEvent({
      ownerId: OWNER,
      name: 'Camille & Sacha',
      startsAt: STARTS_AT,
    })

    expect(unwrap(result).startsAt).toEqual(STARTS_AT)
  })

  it('leaves the start time unset when the host has not scheduled one', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(unwrap(result).startsAt).toBeNull()
  })

  // --------------------------------------------------------------- templates --

  it('starts from the product defaults when the host picked no template', async () => {
    // The shape every event created before roadmap 3.5 has, and the one a host who does
    // not want an opinion still gets.
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(unwrap(result).settings.toProps()).toEqual(EventSettings.default().toProps())
  })

  it('starts from the template the host picked', async () => {
    const result = await createEvent({
      ownerId: OWNER,
      name: 'Camille & Sacha',
      template: 'wedding',
    })

    // The catalogue owns which values these are; this owns that they arrive at all.
    expect(unwrap(result).settings.toProps()).toEqual(eventTemplateSettings('wedding').toProps())
  })

  it('copies the template rather than attaching the event to it', async () => {
    // The whole design in one assertion. Nothing on the saved event names a template, so
    // there is nothing a later edit to the catalogue could reach — and nothing that could
    // re-assert a value on a host who has since changed it.
    await createEvent({ ownerId: OWNER, name: 'Camille & Sacha', template: 'conference' })

    const stored = await events.findBySlug(slug('camille-sacha'))
    expect(stored).not.toBeNull()
    expect(JSON.stringify(stored)).not.toContain('conference')
  })

  it('lets a host depart from the template immediately, and keeps the departure', async () => {
    // "I picked wedding and then changed moderation" is a first-class outcome: the
    // settings are the host's the instant the event exists, and `with` is the ordinary
    // path `updateEventSettings` takes.
    const created = unwrap(
      await createEvent({ ownerId: OWNER, name: 'Camille & Sacha', template: 'wedding' }),
    )

    const departed = created.settings.with({ moderation: 'auto' })

    expect(departed.ok && departed.value.moderation).toBe('auto')
    // And the other template values are still there: departing from one is not
    // abandoning the rest.
    expect(departed.ok && departed.value.retentionDays).toBe(365)
  })

  it('gives two events from one template settings that cannot affect each other', async () => {
    // The two events share one `EventSettings` instance — `eventTemplateSettings` resolves
    // each template once — so this is what says that sharing is safe.
    const asShipped = eventTemplateSettings('party').retentionDays
    const first = unwrap(await createEvent({ ownerId: OWNER, name: 'Fête un', template: 'party' }))
    const second = unwrap(
      await createEvent({ ownerId: OWNER, name: 'Fête deux', template: 'party' }),
    )

    // Deliberately not a number written out here. It was `30` against a template that
    // then became `30`, which changed nothing and left the assertion below passing for
    // no reason — the exact way a test stops being able to fail.
    const changed = second.settings.with({ retentionDays: 1 })

    expect(changed.ok && changed.value.retentionDays).toBe(1)
    expect(first.settings.retentionDays).toBe(asShipped)
    expect(eventTemplateSettings('party').retentionDays).toBe(asShipped)
  })

  // ------------------------------------------------------------ owner grant --

  it('grants the creator the owner role, without which they could not open their own event', async () => {
    await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(await memberships.listForUser(OWNER)).toEqual([
      { eventId: asEventId('event-1'), userId: OWNER, role: 'owner', grantedAt: AT },
    ])
  })

  it('grants nothing when the event itself was refused', async () => {
    await createEvent({ ownerId: OWNER, name: 'Camille & Sacha', quotaBytes: 0 })

    expect(await memberships.listForUser(OWNER)).toEqual([])
  })

  /**
   * The language the projector in the room will speak (roadmap 1.5). Creation is the only
   * moment anybody has a signal worth using: the host is looking at the form in a language
   * they chose.
   */
  describe('the wall language', () => {
    it('stores the language the creator was reading', async () => {
      const created = unwrap(
        await createEvent({ ownerId: OWNER, name: 'Camille & Sacha', wallLanguage: 'de' }),
      )

      expect(created.settings.wallLanguage).toBe('de')
    })

    it('is a snapshot and not a subscription', async () => {
      // A host who switches their own browser to English next month has not asked for a
      // projector in a room to change. Asserted as an absence, because that is the rule:
      // creating a second event in another language moves nothing about the first.
      const first = unwrap(
        await createEvent({ ownerId: OWNER, name: 'Camille & Sacha', wallLanguage: 'de' }),
      )
      await createEvent({ ownerId: OWNER, name: 'Une autre soirée', wallLanguage: 'es' })

      const stored = await events.findById(first.id)
      expect(stored?.settings.wallLanguage).toBe('de')
    })

    it('falls back to French for a caller with no opinion', async () => {
      const created = unwrap(await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' }))

      expect(created.settings.wallLanguage).toBe('fr')
    })

    it('overrides the template rather than being overridden by it', async () => {
      // A template describes the evening and this describes the room, so the creator's
      // choice has to survive one being picked.
      const created = unwrap(
        await createEvent({
          ownerId: OWNER,
          name: 'Conférence',
          template: 'conference',
          wallLanguage: 'en',
        }),
      )

      expect(created.settings.wallLanguage).toBe('en')
      // And the template still applied, so this is not a fight nobody was having.
      expect(created.settings.allowClips).toBe(eventTemplateSettings('conference').allowClips)
    })

    it('refuses a language nothing has a table for, rather than storing it', async () => {
      // Unreachable through the HTTP boundary, which parses the tag against the same
      // vocabulary — and that is the reason for the case: the next caller may be a seed
      // script or a CLI, and a use case whose guarantee belongs to its caller has none.
      const result = await createEvent({
        ownerId: OWNER,
        name: 'Camille & Sacha',
        wallLanguage: 'pt' as 'fr',
      })

      expect(result.ok).toBe(false)
      expect(!result.ok && result.error.code).toBe('eventSettings.wallLanguageInvalid')
      expect(await events.findBySlug(slug('camille-sacha'))).toBeNull()
    })
  })
})
