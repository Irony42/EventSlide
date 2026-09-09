import { describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { eventRepositoryContract } from './contracts/eventRepositoryContract'
import { AT, aGuest, aPhoto, anEvent } from './builders'
import { FakeEventRepository } from './fakeEventRepository'
import { FakeGuestRepository } from './fakeGuestRepository'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { FakePhotoRepository } from './fakePhotoRepository'

eventRepositoryContract('fake', async () => ({ repo: new FakeEventRepository() }))

const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-host')
const MOD = asUserId('user-mod')

describe('FakeEventRepository seeding', () => {
  it('returns itself, so a test arranges its world in one expression', async () => {
    const repo = new FakeEventRepository()

    expect(repo.seed(anEvent({ id: 'evt-1' }))).toBe(repo)
  })

  it('refuses a fixture that duplicates a slug', async () => {
    expect(() =>
      new FakeEventRepository().seed(
        anEvent({ id: 'evt-1', joinCode: 'AAAAAA' }),
        anEvent({ id: 'evt-2', joinCode: 'BBBBBB' }),
      ),
    ).toThrow(/UNIQUE constraint failed: events.slug/)
  })

  it('refuses a fixture that duplicates a join code', async () => {
    expect(() =>
      new FakeEventRepository().seed(
        anEvent({ id: 'evt-1', slug: 'camille-et-sacha' }),
        anEvent({ id: 'evt-2', slug: 'gala-annuel' }),
      ),
    ).toThrow(/UNIQUE constraint failed: events.join_code/)
  })
})

/**
 * The dashboard row is a join in SQLite, so the fake takes the neighbouring
 * repositories instead of inventing counts. The shared contract cannot reach these
 * cases — it has only an `EventRepository` — so they are asserted here.
 */
describe('FakeEventRepository dashboard summary', () => {
  const world = () => {
    const photos = new FakePhotoRepository().seed(
      aPhoto({ id: 'p1', eventId: WEDDING, status: 'pending', byteSize: 1_000 }),
      aPhoto({ id: 'p2', eventId: WEDDING, status: 'pending', byteSize: 2_000 }),
      aPhoto({ id: 'p3', eventId: WEDDING, status: 'published', byteSize: 4_000 }),
    )
    const guests = new FakeGuestRepository().seed(
      aGuest({ id: 'guest-lea', eventId: WEDDING }),
      aGuest({ id: 'guest-nils', eventId: WEDDING }),
    )
    const memberships = new FakeMembershipRepository()
    const events = new FakeEventRepository({ photos, guests, memberships }).seed(
      anEvent({ id: WEDDING, ownerId: HOST }),
    )
    return { events, memberships }
  }

  it('counts every photo of the event', async () => {
    const summaries = await world().events.listForUser(HOST)

    expect(summaries.map((summary) => summary.photoCount)).toEqual([3])
  })

  it('counts only the photos still awaiting a decision', async () => {
    const summaries = await world().events.listForUser(HOST)

    expect(summaries.map((summary) => summary.pendingCount)).toEqual([2])
  })

  it('counts the guests who joined', async () => {
    const summaries = await world().events.listForUser(HOST)

    expect(summaries.map((summary) => summary.guestCount)).toEqual([2])
  })

  it('sums the bytes the event has spent', async () => {
    const summaries = await world().events.listForUser(HOST)

    expect(summaries.map((summary) => summary.usedBytes)).toEqual([7_000])
  })

  it('lists an event the user only moderates', async () => {
    const { events, memberships } = world()
    await memberships.grant({
      eventId: WEDDING,
      userId: MOD,
      role: 'moderator',
      grantedAt: AT,
    })

    const summaries = await events.listForUser(MOD)

    expect(summaries.map((summary) => summary.id)).toEqual([WEDDING])
  })

  it('reports zeros when nothing is linked, rather than inventing a count', async () => {
    const events = new FakeEventRepository().seed(anEvent({ id: WEDDING, ownerId: HOST }))

    const summaries = await events.listForUser(HOST)

    expect(summaries.map((summary) => summary.photoCount)).toEqual([0])
  })
})
