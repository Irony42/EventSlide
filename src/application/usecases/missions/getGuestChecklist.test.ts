import { beforeEach, describe, expect, it } from 'vitest'
import { Challenge } from '../../../domain/challenges/challenge'
import { MissionPrompt } from '../../../domain/missions/missionPrompt'
import {
  asChallengeId,
  asEventId,
  asGuestId,
  asMissionId,
  asUserId,
} from '../../../domain/shared/ids'
import { AT, aMission, aPhoto, anEvent } from '../../testing/builders'
import { FakeChallengeRepository } from '../../testing/fakeChallengeRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeGetGuestChecklist, type GetGuestChecklist } from './getGuestChecklist'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const LEA = asGuestId('guest-lea')
const SAM = asGuestId('guest-sam')

const published = (id: string, missionId: string, guestId: string) =>
  aPhoto({
    id,
    eventId: 'evt-wedding',
    status: 'published',
    missionId,
    author: { kind: 'guest', id: guestId },
  })

describe('getGuestChecklist', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let missions: FakeMissionRepository
  let challenges: FakeChallengeRepository
  let clock: FakeClock
  let getGuestChecklist: GetGuestChecklist

  const ask = (overrides: Partial<Parameters<GetGuestChecklist>[0]> = {}) =>
    getGuestChecklist({ eventId: WEDDING, guestId: LEA, ...overrides })

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    missions = new FakeMissionRepository(photos)
    challenges = new FakeChallengeRepository(photos)
    clock = new FakeClock(AT)
    getGuestChecklist = makeGetGuestChecklist({ events, missions, challenges, clock })

    events.seed(
      anEvent({ id: WEDDING, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
      anEvent({ id: GALA, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    )
  })

  it('answers an empty list for an event whose host set no prompts', async () => {
    const result = await ask()

    expect(result.ok && result.value.items).toEqual([])
  })

  const launch = async (missionId = 'm1', seconds = 120): Promise<Challenge> => {
    const prompt = MissionPrompt.create('un selfie avec votre voisin')
    if (!prompt.ok) throw new Error('fixture')
    const started = Challenge.start(
      {
        eventId: WEDDING,
        missionId: asMissionId(missionId),
        prompt: prompt.value,
        durationSeconds: seconds,
        createdBy: asUserId('user-host'),
      },
      asChallengeId('c1'),
      clock.now(),
    )
    if (!started.ok) throw new Error('fixture')
    await challenges.tryStart(started.value, clock.now())
    return started.value
  }

  it('carries the server clock, and no challenge, when none was launched', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))

    const result = await ask()

    expect(result.ok && result.value.serverNowMs).toBe(AT.getTime())
    expect(result.ok && result.value.challenge).toBeNull()
  })

  it('carries the running challenge', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))
    await launch()
    clock.advance(30_000)

    const result = await ask()

    expect(result.ok && result.value.serverNowMs).toBe(AT.getTime() + 30_000)
    expect(result.ok && result.value.challenge?.state).toBe('running')
    expect(result.ok && result.value.challenge?.challenge.missionId).toBe('m1')
  })

  it('reads no challenge once it ended more than twenty seconds ago', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))
    await launch('m1', 60)
    clock.advance(60_000 + 20_000)

    const result = await ask()

    expect(result.ok && result.value.challenge).toBeNull()
  })

  it('does not read another event challenge', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))
    const other = Challenge.restore({
      ...(await launch()).toProps(),
      id: asChallengeId('c-gala'),
      eventId: GALA,
    })
    const fresh = new FakeChallengeRepository(photos).seed(other)
    getGuestChecklist = makeGetGuestChecklist({ events, missions, challenges: fresh, clock })

    const result = await ask()

    expect(result.ok && result.value.challenge).toBeNull()
  })

  it('lists the prompts in the order the host wrote them', async () => {
    missions.seed(
      aMission({ id: 'm2', eventId: 'evt-wedding', createdAt: new Date(2_000) }),
      aMission({ id: 'm1', eventId: 'evt-wedding', createdAt: new Date(1_000) }),
    )

    const result = await ask()

    expect(result.ok && result.value.items.map((row) => row.mission.id)).toEqual(['m1', 'm2'])
  })

  it('leaves a per-guest prompt open until this guest has answered it themselves', async () => {
    // The whole point of the feature: a checklist that ticked itself because somebody
    // across the room had already sent a selfie would leave this guest nothing to do.
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'guest' }))
    photos.seed(published('p1', 'm1', 'guest-sam'))

    const result = await ask()

    expect(result.ok && result.value.items[0]?.done).toBe(false)
    expect(result.ok && result.value.items[0]?.progress.completedByGuests).toBe(1)
  })

  it('ticks a per-guest prompt for the guest who answered it', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'guest' }))
    photos.seed(published('p1', 'm1', 'guest-lea'))

    const result = await ask()

    expect(result.ok && result.value.items[0]?.done).toBe(true)
  })

  it('ticks a once-for-the-evening prompt for everyone once anybody answers it', async () => {
    // "La première danse" happens once. Leaving a hundred and ninety-nine checklists
    // open for it is asking the room to photograph a moment that is over.
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'event' }))
    photos.seed(published('p1', 'm1', 'guest-sam'))

    const result = await ask()

    expect(result.ok && result.value.items[0]?.done).toBe(true)
  })

  it('leaves a prompt open when this guest"s own photograph was refused', async () => {
    // The hardest rule in §2.1. A tag is the guest's claim; publishing it is the host's
    // verdict, and nothing here reads the claim.
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'guest' }))
    photos.seed(
      aPhoto({
        id: 'p1',
        eventId: 'evt-wedding',
        status: 'rejected',
        missionId: 'm1',
        author: { kind: 'guest', id: 'guest-lea' },
      }),
    )

    const result = await ask()

    expect(result.ok && result.value.items[0]?.done).toBe(false)
    expect(result.ok && result.value.items[0]?.progress.publishedPhotos).toBe(0)
  })

  it('reopens a prompt whose only photograph the host has since hidden', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'event' }))
    photos.seed(
      aPhoto({
        id: 'p1',
        eventId: 'evt-wedding',
        status: 'hidden',
        missionId: 'm1',
        author: { kind: 'guest', id: 'guest-lea' },
      }),
    )

    const result = await ask()

    expect(result.ok && result.value.items[0]?.done).toBe(false)
  })

  it('answers each guest about themselves', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'guest' }))
    photos.seed(published('p1', 'm1', 'guest-lea'))

    const forLea = await ask({ guestId: LEA })
    const forSam = await ask({ guestId: SAM })

    expect(forLea.ok && forLea.value.items[0]?.done).toBe(true)
    expect(forSam.ok && forSam.value.items[0]?.done).toBe(false)
  })

  it('never shows another event"s prompts', async () => {
    missions.seed(aMission({ id: 'm-gala', eventId: 'evt-gala' }))

    const result = await ask()

    expect(result.ok && result.value.items).toEqual([])
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await ask({ eventId: asEventId('evt-ghost') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
