import { beforeEach, describe, expect, it } from 'vitest'
import type { Event } from '../../../domain/events/event'
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

  it('refuses a slug another event already holds', async () => {
    events.seed(anEvent({ id: 'evt-other', slug: 'camille-sacha', joinCode: 'H7K2QM' }))

    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(!result.ok && result.error.code).toBe('event.slugTaken')
  })

  it('reports a taken slug as a conflict, so the form can offer another', async () => {
    events.seed(anEvent({ id: 'evt-other', slug: 'camille-sacha', joinCode: 'H7K2QM' }))

    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha' })

    expect(!result.ok && result.error.kind).toBe('conflict')
  })

  it('refuses a name the domain will not accept', async () => {
    const result = await createEvent({ ownerId: OWNER, name: 'A' })

    expect(!result.ok && result.error.code).toBe('eventName.tooShort')
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
    const result = await createEvent({ ownerId: OWNER, name: 'Camille & Sacha', quotaBytes: 12_345 })

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
})
