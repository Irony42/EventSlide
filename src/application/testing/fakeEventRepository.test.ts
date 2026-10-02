import { describe, expect, it, vi } from 'vitest'
import { ClientCeilings } from '../../domain/clients/clientCeilings'
import { asClientId, asEventId, asUserId } from '../../domain/shared/ids'
import { eventRepositoryContract } from './contracts/eventRepositoryContract'
import { AT, aClient, aGuest, aPhoto, anEvent } from './builders'
import { FakeClientRepository } from './fakeClientRepository'
import { FakeEventRepository } from './fakeEventRepository'
import { FakeGuestRepository } from './fakeGuestRepository'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { FakePhotoRepository } from './fakePhotoRepository'

eventRepositoryContract('fake', async () => {
  const memberships = new FakeMembershipRepository()
  const clients = new FakeClientRepository()
  return { repo: new FakeEventRepository({ memberships, clients }), memberships, clients }
})

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

  it('counts the clips still waiting to be transcoded, because admission does', async () => {
    // The SQLite adapter's dashboard row and its upload paths read one expression
    // (`eventBytesSum.test.ts`); here the fake asks the photo fake for the same total, and
    // that total is charged for the queue once a clip source is wired in.
    const photos = new FakePhotoRepository()
      .seed(aPhoto({ id: 'p1', eventId: WEDDING, byteSize: 1_000 }))
      .chargeStagedBytesFrom({
        stagedBytes: async () => 40_000,
        stagedBytesOf: async () => 0,
      })
    const events = new FakeEventRepository({ photos }).seed(anEvent({ id: WEDDING, ownerId: HOST }))

    const summaries = await events.listForUser(HOST)

    expect(summaries.map((summary) => summary.usedBytes)).toEqual([41_000])
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

/**
 * What the fake refuses to do on its own, so a test cannot pass by quietly skipping a
 * ceiling or an owner — the same silence the contract suite exists to keep out.
 */
describe('FakeEventRepository createWithOwner and its links', () => {
  const owner = { userId: HOST, grantedAt: AT }
  const unlimited = ClientCeilings.unlimited()

  it('refuses to create an event when no memberships fake is linked, rather than create one nobody can open', async () => {
    const events = new FakeEventRepository()

    await expect(
      events.createWithOwner(anEvent({ id: WEDDING }), owner, unlimited),
    ).rejects.toThrow(/needs the memberships fake/)
    expect(await events.findById(WEDDING)).toBeNull()
  })

  it('refuses to store an event that has a client when no clients fake is linked, rather than skip its ceilings', async () => {
    const memberships = new FakeMembershipRepository()
    const events = new FakeEventRepository({ memberships })

    await expect(
      events.createWithOwner(anEvent({ id: WEDDING, clientId: 'client-1' }), owner, unlimited),
    ).rejects.toThrow(/needs the clients fake linked/)
    expect(() => events.seed(anEvent({ id: WEDDING, clientId: 'client-1' }))).toThrow(
      /needs the clients fake linked/,
    )
  })

  it('leaves no event and no count behind when writing the owner fails', async () => {
    const clients = new FakeClientRepository().seed(aClient({ id: 'client-1' }))
    const memberships = new FakeMembershipRepository()
    vi.spyOn(memberships, 'grant').mockRejectedValue(new Error('the membership write failed'))
    const events = new FakeEventRepository({ memberships, clients })

    await expect(
      events.createWithOwner(anEvent({ id: WEDDING, clientId: 'client-1' }), owner, unlimited),
    ).rejects.toThrow(/the membership write failed/)

    expect(await events.findById(WEDDING)).toBeNull()
    expect((await clients.findById(asClientId('client-1')))?.eventsCreatedInPeriod).toBe(0)
  })

  it('drops the client link when the event is deleted, so an emptied client can be deleted', async () => {
    const clients = new FakeClientRepository().seed(aClient({ id: 'client-1' }))
    const events = new FakeEventRepository({ memberships: new FakeMembershipRepository(), clients })
    await events.createWithOwner(anEvent({ id: WEDDING, clientId: 'client-1' }), owner, unlimited)
    expect(await clients.deleteIfEmpty(asClientId('client-1'))).toBe(false)

    await events.delete(WEDDING)

    expect(await clients.deleteIfEmpty(asClientId('client-1'))).toBe(true)
  })

  it('links a seeded event to its client, so the client’s context can be read back', async () => {
    const clients = new FakeClientRepository().seed(aClient({ id: 'client-1' }))
    new FakeEventRepository({ clients }).seed(anEvent({ id: WEDDING, clientId: 'client-1' }))

    expect((await clients.contextForEvent(WEDDING))?.clientId).toBe('client-1')
  })
})
