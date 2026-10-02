import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Event } from '../../../domain/events/event'
import { EventSettings } from '../../../domain/events/eventSettings'
import { eventTemplateSettings } from '../../../domain/events/eventTemplate'
import type { DomainError } from '../../../domain/shared/errors'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { JoinCode } from '../../../domain/shared/joinCode'
import type { Result } from '../../../domain/shared/result'
import { Slug } from '../../../domain/shared/slug'
import { AT, aClient, aClientCeilings, aUser, anEvent } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeCreateEvent, type CreateEvent, type EventCreationPolicy } from './createEvent'

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
  let clients: FakeClientRepository
  let users: FakeUserRepository
  let ids: SequentialIdGenerator
  let clock: FakeClock
  let createEvent: CreateEvent

  beforeEach(() => {
    memberships = new FakeMembershipRepository()
    clients = new FakeClientRepository()
    users = new FakeUserRepository()
    events = new FakeEventRepository({ memberships, clients })
    ids = new SequentialIdGenerator()
    clock = new FakeClock()
    createEvent = makeCreateEvent({
      events,
      clients,
      users,
      eventCreation: 'anyAccount',
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
        clients,
        users,
        eventCreation: 'anyAccount',
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
        clients,
        users,
        eventCreation: 'anyAccount',
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
        clients,
        users,
        eventCreation: 'anyAccount',
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

    it('refuses a name that folds away to nothing even with a suffix to append', async () => {
      // `EventName` accepts this — 東京 has alphanumeric characters by its own rule,
      // `\p{L}` — but `slugify` keeps only `[a-z0-9]`, so it folds to '' exactly as pure
      // punctuation does. `Slug.fromNameWithRandomSuffix` then builds a bare `-xxxxxx`,
      // which `Slug.create` refuses for the leading dash. That refusal must stop the
      // attempt loop outright, rather than being swallowed as "try the next suffix".
      const result = await createWithRandomSuffix({ ownerId: OWNER, name: '東京' })

      expect(!result.ok && result.error.code).toBe('slug.malformed')
    })
  })

  // -------------------------------------------------------- JOIN_CODE_LENGTH --

  describe('a configured join code length', () => {
    it('mints a code of the configured length instead of the default six', async () => {
      const create = makeCreateEvent({
        events,
        clients,
        users,
        eventCreation: 'anyAccount',
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
      clients,
      users,
      eventCreation: 'anyAccount',
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
      clients,
      users,
      eventCreation: 'anyAccount',
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
      clients,
      users,
      eventCreation: 'anyAccount',
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
        clients,
        users,
        eventCreation: 'anyAccount',
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
        clients,
        users,
        eventCreation: 'anyAccount',
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

  // ============================================================ the client ==

  /**
   * Which client an event belongs to, and who may create one at all (P3-05 / G2-04).
   *
   * The accounts: `OWNER` has no client; `MEMBER` belongs to one; `TWO_CLIENTS` belongs to
   * two; `OPERATOR` runs the box. The clients: `client-1` and `client-2`, each unlimited
   * until a case narrows it.
   */
  describe('the client an event belongs to', () => {
    const MEMBER = asUserId('user-member')
    const TWO_CLIENTS = asUserId('user-two-clients')
    const OPERATOR = asUserId('user-operator')
    const CLIENT_1 = asClientId('client-1')
    const CLIENT_2 = asClientId('client-2')

    const policyCreateEvent = (eventCreation: EventCreationPolicy): CreateEvent =>
      makeCreateEvent({
        events,
        clients,
        users,
        eventCreation,
        ids,
        clock,
        defaultQuotaBytes: DEFAULT_QUOTA,
        maxQuotaBytes: null,
        ...CORE_DEFAULTS,
      })

    const grant = (clientId: typeof CLIENT_1, userId: typeof MEMBER) =>
      clients.grantMember({ clientId, userId, role: 'member', grantedAt: AT })

    beforeEach(async () => {
      users.seed(
        aUser({ id: OWNER, email: 'invitee@example.test' }),
        aUser({ id: MEMBER, email: 'member@example.test' }),
        aUser({ id: TWO_CLIENTS, email: 'two-clients@example.test' }),
        aUser({ id: OPERATOR, email: 'operator@example.test', siteRole: 'operator' }),
      )
      clients.seed(
        aClient({ id: CLIENT_1, name: 'Atelier Camille' }),
        aClient({ id: CLIENT_2, name: 'Studio Sacha' }),
      )
      await grant(CLIENT_1, MEMBER)
      await grant(CLIENT_1, TWO_CLIENTS)
      await grant(CLIENT_2, TWO_CLIENTS)
    })

    describe.each<EventCreationPolicy>(['anyAccount', 'clientMembers'])(
      'under EVENT_CREATION=%s',
      (policy) => {
        let create: CreateEvent
        beforeEach(() => {
          create = policyCreateEvent(policy)
        })

        it('attaches the event of a member of one client to that client, without being told', async () => {
          const created = unwrap(await create({ ownerId: MEMBER, name: 'Camille & Sacha' }))

          expect(created.clientId).toBe(CLIENT_1)
        })

        it('persists the client on the stored event, not only on the returned one', async () => {
          await create({ ownerId: MEMBER, name: 'Camille & Sacha' })

          expect((await events.findBySlug(slug('camille-sacha')))?.clientId).toBe(CLIENT_1)
        })

        it('attaches the event of the operator to no client, however it is asked', async () => {
          const created = unwrap(await create({ ownerId: OPERATOR, name: 'Camille & Sacha' }))

          expect(created.clientId).toBeNull()
        })

        it('does not hold the operator to any client’s ceilings', async () => {
          clients.seed(aClient({ id: CLIENT_1, ceilings: { maxEvents: 1, maxEventsPerPeriod: 1 } }))

          const first = await create({ ownerId: OPERATOR, name: 'Un premier soir' })
          const second = await create({ ownerId: OPERATOR, name: 'Un second soir' })

          expect(first.ok && second.ok).toBe(true)
        })

        it('attaches the operator’s event to a client of theirs only when they name it', async () => {
          await grant(CLIENT_2, OPERATOR)

          const created = unwrap(
            await create({ ownerId: OPERATOR, clientId: CLIENT_2, name: 'Camille & Sacha' }),
          )

          expect(created.clientId).toBe(CLIENT_2)
        })

        it('refuses a client the operator does not belong to, because the box they run is not that client', async () => {
          // The exemption from ceilings is not a licence to attach to somebody else's: an
          // event named for a client eats that client's slots and counts against its period.
          const result = await create({
            ownerId: OPERATOR,
            clientId: CLIENT_1,
            name: 'Camille & Sacha',
          })

          expect(!result.ok && result.error.code).toBe('client.notFound')
          expect((await clients.findById(CLIENT_1))?.eventsCreatedInPeriod).toBe(0)
        })

        it('attaches the operator’s own event to no client even when they also belong to one, unless they name it', async () => {
          await grant(CLIENT_1, OPERATOR)

          const unnamed = unwrap(
            await create({ ownerId: OPERATOR, name: 'Le soir de l’opérateur' }),
          )
          const named = unwrap(
            await create({ ownerId: OPERATOR, clientId: CLIENT_1, name: 'Le soir de la cliente' }),
          )

          expect(unnamed.clientId).toBeNull()
          expect(named.clientId).toBe(CLIENT_1)
        })

        it('holds a member of several clients to the ceilings of the one they name, not of another', async () => {
          clients.seed(aClient({ id: CLIENT_1, ceilings: { maxEvents: 1 } }))
          await create({ ownerId: TWO_CLIENTS, clientId: CLIENT_1, name: 'Un premier soir' })

          const overTheLimit = await create({
            ownerId: TWO_CLIENTS,
            clientId: CLIENT_1,
            name: 'Un second soir',
          })
          const otherClient = await create({
            ownerId: TWO_CLIENTS,
            clientId: CLIENT_2,
            name: 'Un soir ailleurs',
          })

          expect(!overTheLimit.ok && overTheLimit.error.code).toBe('client.ceilingReached')
          expect(otherClient.ok).toBe(true)
        })

        it('lets a member of several clients name the one the event is for', async () => {
          const created = unwrap(
            await create({ ownerId: TWO_CLIENTS, clientId: CLIENT_2, name: 'Camille & Sacha' }),
          )

          expect(created.clientId).toBe(CLIENT_2)
        })

        it('refuses a member of several clients who does not say which, as client not found', async () => {
          const result = await create({ ownerId: TWO_CLIENTS, name: 'Camille & Sacha' })

          expect(!result.ok && result.error.code).toBe('client.notFound')
          expect(!result.ok && result.error.kind).toBe('notFound')
        })

        it('refuses a client the account does not belong to, even though it exists', async () => {
          const result = await create({
            ownerId: MEMBER,
            clientId: CLIENT_2,
            name: 'Camille & Sacha',
          })

          expect(!result.ok && result.error.code).toBe('client.notFound')
        })

        it('answers a client that does not exist exactly as one the account does not belong to', async () => {
          const unknown = await create({
            ownerId: MEMBER,
            clientId: asClientId('client-that-never-was'),
            name: 'Camille & Sacha',
          })
          const foreign = await create({
            ownerId: MEMBER,
            clientId: CLIENT_2,
            name: 'Camille & Sacha',
          })

          expect(unknown).toEqual(foreign)
        })

        it('refuses a client named by an account that belongs to none, whatever the policy', async () => {
          const result = await create({
            ownerId: OWNER,
            clientId: CLIENT_1,
            name: 'Camille & Sacha',
          })

          expect(!result.ok && result.error.code).toBe('client.notFound')
        })

        it('creates nothing when the client is refused', async () => {
          await create({ ownerId: TWO_CLIENTS, name: 'Camille & Sacha' })

          expect(await events.findBySlug(slug('camille-sacha'))).toBeNull()
          expect(await memberships.listForUser(TWO_CLIENTS)).toEqual([])
          expect((await clients.findById(CLIENT_1))?.eventsCreatedInPeriod).toBe(0)
        })

        it('refuses to attach an event to a client that went away under the account', async () => {
          // A membership cannot outlive its client in the database, so this is the race
          // between reading the roster and reading the client; the fake is told the lie.
          class StaleRoster extends FakeClientRepository {
            override async findById(): Promise<null> {
              return null
            }
          }
          const stale = new StaleRoster()
          stale.seed(aClient({ id: CLIENT_1 }))
          await stale.grantMember({
            clientId: CLIENT_1,
            userId: MEMBER,
            role: 'member',
            grantedAt: AT,
          })

          const result = await makeCreateEvent({
            events: new FakeEventRepository({ memberships, clients: stale }),
            clients: stale,
            users,
            eventCreation: policy,
            ids,
            clock,
            defaultQuotaBytes: DEFAULT_QUOTA,
            maxQuotaBytes: null,
            ...CORE_DEFAULTS,
          })({ ownerId: MEMBER, name: 'Camille & Sacha' })

          expect(!result.ok && result.error.code).toBe('client.notFound')
        })

        it('counts the creation against the client’s period', async () => {
          await create({ ownerId: MEMBER, name: 'Un premier soir' })
          await create({ ownerId: MEMBER, name: 'Un second soir' })

          expect((await clients.findById(CLIENT_1))?.eventsCreatedInPeriod).toBe(2)
        })

        it('counts nothing for an event that has no client', async () => {
          await create({ ownerId: OPERATOR, name: 'Camille & Sacha' })

          expect((await clients.findById(CLIENT_1))?.eventsCreatedInPeriod).toBe(0)
          expect((await clients.findById(CLIENT_2))?.eventsCreatedInPeriod).toBe(0)
        })
      },
    )

    describe('under EVENT_CREATION=anyAccount', () => {
      let create: CreateEvent
      beforeEach(() => {
        create = policyCreateEvent('anyAccount')
      })

      it('lets an account that belongs to no client create an event, with no client, as it always could', async () => {
        const created = unwrap(await create({ ownerId: OWNER, name: 'Camille & Sacha' }))

        expect(created.clientId).toBeNull()
      })

      it('lets a moderator somebody invited create an event, which is the behaviour a solo box keeps', async () => {
        await memberships.grant({
          eventId: asEventId('someone-elses-event'),
          userId: OWNER,
          role: 'moderator',
          grantedAt: AT,
        })

        const result = await create({ ownerId: OWNER, name: 'Camille & Sacha' })

        expect(result.ok).toBe(true)
      })
    })

    describe('under EVENT_CREATION=clientMembers', () => {
      let create: CreateEvent
      beforeEach(() => {
        create = policyCreateEvent('clientMembers')
      })

      it('refuses an account that belongs to no client, as creation not allowed', async () => {
        const result = await create({ ownerId: OWNER, name: 'Camille & Sacha' })

        expect(!result.ok && result.error.code).toBe('event.creationNotAllowed')
        expect(!result.ok && result.error.kind).toBe('forbidden')
      })

      it('refuses a moderator somebody invited to an event, because that is not a client', async () => {
        // The case the policy exists for: an invited moderator is an account on the box
        // with a part in somebody's evening, and no standing to start their own.
        await memberships.grant({
          eventId: asEventId('someone-elses-event'),
          userId: OWNER,
          role: 'moderator',
          grantedAt: AT,
        })

        const result = await create({ ownerId: OWNER, name: 'Camille & Sacha' })

        expect(!result.ok && result.error.code).toBe('event.creationNotAllowed')
      })

      it('creates nothing for the account it refuses', async () => {
        await create({ ownerId: OWNER, name: 'Camille & Sacha' })

        expect(await events.findBySlug(slug('camille-sacha'))).toBeNull()
        expect(await memberships.listForUser(OWNER)).toEqual([])
      })

      it('refuses before it looks at the name, so a stranger learns nothing from a 400', async () => {
        const result = await create({ ownerId: OWNER, name: '' })

        expect(!result.ok && result.error.code).toBe('event.creationNotAllowed')
      })

      it('refuses before it looks at the slug, so a stranger cannot probe which addresses are taken', async () => {
        await create({ ownerId: MEMBER, name: 'Camille & Sacha' })

        const result = await create({ ownerId: OWNER, name: 'Camille & Sacha' })

        expect(!result.ok && result.error.code).toBe('event.creationNotAllowed')
      })

      it('allows the operator, with no client', async () => {
        const created = unwrap(await create({ ownerId: OPERATOR, name: 'Camille & Sacha' }))

        expect(created.clientId).toBeNull()
      })

      it('allows a member, and the event carries the client', async () => {
        const created = unwrap(await create({ ownerId: MEMBER, name: 'Camille & Sacha' }))

        expect(created.clientId).toBe(CLIENT_1)
      })

      it('does not treat a disabled operator as one', async () => {
        users.seed(
          aUser({
            id: OPERATOR,
            email: 'operator@example.test',
            siteRole: 'operator',
            disabledAt: AT,
          }),
        )

        const result = await create({ ownerId: OPERATOR, name: 'Camille & Sacha' })

        expect(!result.ok && result.error.code).toBe('event.creationNotAllowed')
      })
    })

    // -------------------------------------------------- the creation ceilings --

    /**
     * The two ceilings that live in `createWithOwner`'s transaction. The rest of §10.5
     * — the quota clamp, retention, clips, suspension, going live — is G2-05's.
     */
    describe('the ceilings of the client', () => {
      let create: CreateEvent
      beforeEach(() => {
        create = policyCreateEvent('clientMembers')
      })

      it('refuses the event after the one that reaches the client’s total ceiling', async () => {
        clients.seed(aClient({ id: CLIENT_1, ceilings: { maxEvents: 1 } }))

        const first = await create({ ownerId: MEMBER, name: 'Un premier soir' })
        const second = await create({ ownerId: MEMBER, name: 'Un second soir' })

        expect(first.ok).toBe(true)
        expect(!second.ok && second.error.code).toBe('client.ceilingReached')
        expect(!second.ok && second.error.kind).toBe('conflict')
        expect(!second.ok && second.error.details).toEqual({ ceiling: 'events', used: 1, max: 1 })
      })

      it('creates nothing, and grants nothing, for the event a ceiling refuses', async () => {
        clients.seed(aClient({ id: CLIENT_1, ceilings: { maxEvents: 1 } }))
        await create({ ownerId: MEMBER, name: 'Un premier soir' })

        await create({ ownerId: MEMBER, name: 'Un second soir' })

        expect(await events.findBySlug(slug('un-second-soir'))).toBeNull()
        expect(await memberships.listForUser(MEMBER)).toHaveLength(1)
        expect((await clients.findById(CLIENT_1))?.eventsCreatedInPeriod).toBe(1)
      })

      it('refuses create, delete, recreate under max_events_per_period=1', async () => {
        clients.seed(
          aClient({ id: CLIENT_1, ceilings: aClientCeilings({ maxEventsPerPeriod: 1 }) }),
        )

        const first = unwrap(await create({ ownerId: MEMBER, name: 'Un premier soir' }))
        await events.delete(first.id)
        const again = await create({ ownerId: MEMBER, name: 'Un second soir' })

        expect(!again.ok && again.error.code).toBe('client.ceilingReached')
        expect(!again.ok && again.error.details).toMatchObject({ ceiling: 'eventsPerPeriod' })
      })

      it('holds each client to its own ceiling, not to a neighbour’s', async () => {
        clients.seed(aClient({ id: CLIENT_1, ceilings: { maxEvents: 1 } }))
        await create({ ownerId: MEMBER, name: 'Un premier soir' })

        const other = await create({
          ownerId: TWO_CLIENTS,
          clientId: CLIENT_2,
          name: 'Un autre soir',
        })

        expect(other.ok).toBe(true)
      })
    })
  })

  // ===================================================== one atomic creation ==

  it('leaves no event behind when the owner cannot be granted, instead of an event nobody can open', async () => {
    // What `createEvent` used to do: `save`, then `grant`. A failure between the two left
    // a row with no owner membership, which no one could open and no one could delete.
    vi.spyOn(memberships, 'grant').mockRejectedValue(new Error('the membership write failed'))

    await expect(createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })).rejects.toThrow(
      /membership write failed/,
    )

    expect(await events.findBySlug(slug('camille-sacha'))).toBeNull()
  })
})
