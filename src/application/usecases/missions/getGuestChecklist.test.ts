import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { aMission, aPhoto, anEvent } from '../../testing/builders'
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
  let getGuestChecklist: GetGuestChecklist

  const ask = (overrides: Partial<Parameters<GetGuestChecklist>[0]> = {}) =>
    getGuestChecklist({ eventId: WEDDING, guestId: LEA, ...overrides })

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    missions = new FakeMissionRepository(photos)
    getGuestChecklist = makeGetGuestChecklist({ events, missions })

    events.seed(
      anEvent({ id: WEDDING, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
      anEvent({ id: GALA, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    )
  })

  it('answers an empty list for an event whose host set no prompts', async () => {
    const result = await ask()

    expect(result.ok && result.value).toEqual([])
  })

  it('lists the prompts in the order the host wrote them', async () => {
    missions.seed(
      aMission({ id: 'm2', eventId: 'evt-wedding', createdAt: new Date(2_000) }),
      aMission({ id: 'm1', eventId: 'evt-wedding', createdAt: new Date(1_000) }),
    )

    const result = await ask()

    expect(result.ok && result.value.map((row) => row.mission.id)).toEqual(['m1', 'm2'])
  })

  it('leaves a per-guest prompt open until this guest has answered it themselves', async () => {
    // The whole point of the feature: a checklist that ticked itself because somebody
    // across the room had already sent a selfie would leave this guest nothing to do.
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'guest' }))
    photos.seed(published('p1', 'm1', 'guest-sam'))

    const result = await ask()

    expect(result.ok && result.value[0]?.done).toBe(false)
    expect(result.ok && result.value[0]?.progress.completedByGuests).toBe(1)
  })

  it('ticks a per-guest prompt for the guest who answered it', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'guest' }))
    photos.seed(published('p1', 'm1', 'guest-lea'))

    const result = await ask()

    expect(result.ok && result.value[0]?.done).toBe(true)
  })

  it('ticks a once-for-the-evening prompt for everyone once anybody answers it', async () => {
    // "La première danse" happens once. Leaving a hundred and ninety-nine checklists
    // open for it is asking the room to photograph a moment that is over.
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'event' }))
    photos.seed(published('p1', 'm1', 'guest-sam'))

    const result = await ask()

    expect(result.ok && result.value[0]?.done).toBe(true)
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

    expect(result.ok && result.value[0]?.done).toBe(false)
    expect(result.ok && result.value[0]?.progress.publishedPhotos).toBe(0)
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

    expect(result.ok && result.value[0]?.done).toBe(false)
  })

  it('answers each guest about themselves', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', scope: 'guest' }))
    photos.seed(published('p1', 'm1', 'guest-lea'))

    const forLea = await ask({ guestId: LEA })
    const forSam = await ask({ guestId: SAM })

    expect(forLea.ok && forLea.value[0]?.done).toBe(true)
    expect(forSam.ok && forSam.value[0]?.done).toBe(false)
  })

  it('never shows another event"s prompts', async () => {
    missions.seed(aMission({ id: 'm-gala', eventId: 'evt-gala' }))

    const result = await ask()

    expect(result.ok && result.value).toEqual([])
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await ask({ eventId: asEventId('evt-ghost') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
