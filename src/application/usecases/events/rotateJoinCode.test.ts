import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { JoinCode } from '../../../domain/shared/joinCode'
import { AT, anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeRotateJoinCode, type RotateJoinCode } from './rotateJoinCode'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

/** What the printed cards on the tables say before the host reaches for the lever. */
const PRINTED_CODE = 'H7K2QM'
/** `SequentialIdGenerator` walks `0, 1, 2, …`; `JoinCode.fromBytes` spells these. */
const FIRST_CODE = '012345'
const SECOND_CODE = '6789AB'

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

describe('rotateJoinCode', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let ids: SequentialIdGenerator
  let bus: RecordingEventBus
  let rotateJoinCode: RotateJoinCode

  const seedRoles = async (repo: FakeMembershipRepository): Promise<void> => {
    await repo.grant({ eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT })
    await repo.grant({ eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT })
    await repo.grant({ eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT })
  }

  beforeEach(async () => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    ids = new SequentialIdGenerator()
    bus = new RecordingEventBus()
    rotateJoinCode = makeRotateJoinCode({ events, memberships, ids, bus })

    events.seed(
      anEvent({
        id: WEDDING,
        ownerId: OWNER,
        slug: 'camille-et-sacha',
        joinCode: PRINTED_CODE,
      }),
      anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    )
    await seedRoles(memberships)
  })

  it('replaces the code with one derived from injected entropy', async () => {
    const result = await rotateJoinCode({ eventId: WEDDING, actorId: OWNER })

    expect(result.ok && result.value.joinCode.value).toBe(FIRST_CODE)
  })

  /**
   * The whole point of the lever: whoever photographed the card and posted it stops
   * getting in the moment the host presses it. There is no grace period.
   */
  it('stops resolving the code that leaked', async () => {
    await rotateJoinCode({ eventId: WEDDING, actorId: OWNER })

    expect(await events.findByJoinCode(joinCode(PRINTED_CODE))).toBeNull()
  })

  it('resolves the new code to the same event', async () => {
    await rotateJoinCode({ eventId: WEDDING, actorId: OWNER })

    const found = await events.findByJoinCode(joinCode(FIRST_CODE))

    expect(found?.id).toBe(WEDDING)
  })

  it('announces the change, so the console reprints the QR code it is showing', async () => {
    await rotateJoinCode({ eventId: WEDDING, actorId: OWNER })

    expect(bus.published).toEqual([{ type: 'event.settingsChanged', eventId: WEDDING }])
  })

  it('retries past a code another event on the box already holds', async () => {
    events.seed(anEvent({ id: 'evt-third', slug: 'anniversaire', joinCode: FIRST_CODE }))

    const result = await rotateJoinCode({ eventId: WEDDING, actorId: OWNER })

    expect(result.ok && result.value.joinCode.value).toBe(SECOND_CODE)
  })

  describe('when no join code is free', () => {
    let saturated: SaturatedEventRepository
    let rotate: RotateJoinCode

    beforeEach(async () => {
      saturated = new SaturatedEventRepository()
      saturated.seed(
        anEvent({
          id: WEDDING,
          ownerId: OWNER,
          slug: 'camille-et-sacha',
          joinCode: PRINTED_CODE,
        }),
      )
      rotate = makeRotateJoinCode({ events: saturated, memberships, ids, bus })
      await seedRoles(memberships)
    })

    it('gives up rather than looping', async () => {
      const result = await rotate({ eventId: WEDDING, actorId: OWNER })

      expect(!result.ok && result.error.code).toBe('event.joinCodeExhausted')
    })

    it('leaves the printed code working, which is better than no code at all', async () => {
      await rotate({ eventId: WEDDING, actorId: OWNER })

      const stored = await saturated.findById(WEDDING)

      expect(stored?.joinCode.value).toBe(PRINTED_CODE)
    })

    it('announces nothing', async () => {
      await rotate({ eventId: WEDDING, actorId: OWNER })

      expect(bus.published).toEqual([])
    })
  })

  // ------------------------------------------------------------------ refusals --

  it('refuses an archived event, whose cards lead nowhere anyway', async () => {
    events.seed(anEvent({ id: WEDDING, ownerId: OWNER, status: 'archived' }))

    const result = await rotateJoinCode({ eventId: WEDDING, actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('event.immutable')
  })

  it('announces nothing when the event is archived', async () => {
    events.seed(anEvent({ id: WEDDING, ownerId: OWNER, status: 'archived' }))

    await rotateJoinCode({ eventId: WEDDING, actorId: OWNER })

    expect(bus.published).toEqual([])
  })

  /**
   * A moderator who could rotate would invalidate the cards on every table
   * mid-reception. Lending out the console must not include that.
   */
  it('refuses a moderator of the event', async () => {
    const result = await rotateJoinCode({ eventId: WEDDING, actorId: MODERATOR })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('leaves the code alone when a moderator tries', async () => {
    await rotateJoinCode({ eventId: WEDDING, actorId: MODERATOR })

    const stored = await events.findById(WEDDING)

    expect(stored?.joinCode.value).toBe(PRINTED_CODE)
  })

  it('answers notFound to a caller with no membership in the event', async () => {
    const result = await rotateJoinCode({ eventId: WEDDING, actorId: asUserId('user-nobody') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('cannot rotate another event with the role the caller holds on their own', async () => {
    const result = await rotateJoinCode({ eventId: GALA, actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('leaves the code of the other event intact', async () => {
    await rotateJoinCode({ eventId: GALA, actorId: OWNER })

    const stored = await events.findById(GALA)

    expect(stored?.joinCode.value).toBe('Z3N9PT')
  })

  it('answers notFound for an event id that does not exist', async () => {
    const result = await rotateJoinCode({ eventId: asEventId('evt-nothing'), actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
