import { beforeEach, describe, expect, it } from 'vitest'
import type { ClientCeilingsProps } from '../../../domain/clients/clientCeilings'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, anEvent, atPlus } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeChangeEventStatus, type ChangeEventStatus } from './changeEventStatus'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

/** The speeches ran late: the host closes the party two hours after it was created. */
const CLOSED_AT = atPlus(2 * 60 * 60 * 1_000)

/** Counts the reads, so "an event with no client never asks" is a number. */
class CountingClientRepository extends FakeClientRepository {
  contextReads = 0

  override async contextForEvent(
    ...args: Parameters<FakeClientRepository['contextForEvent']>
  ): ReturnType<FakeClientRepository['contextForEvent']> {
    this.contextReads += 1
    return super.contextForEvent(...args)
  }
}

describe('changeEventStatus', () => {
  let events: FakeEventRepository
  let clients: CountingClientRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let changeEventStatus: ChangeEventStatus

  const seedWedding = (status: EventStatus): void => {
    events.seed(
      anEvent({
        id: WEDDING,
        ownerId: OWNER,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        status,
      }),
    )
  }

  beforeEach(async () => {
    clients = new CountingClientRepository()
    events = new FakeEventRepository({ clients })
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock(CLOSED_AT)
    changeEventStatus = makeChangeEventStatus({ events, clients, memberships, bus, clock })

    seedWedding('draft')
    events.seed(anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }))
    await memberships.grant({ eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT })
    await memberships.grant({
      eventId: WEDDING,
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })
    await memberships.grant({ eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT })
  })

  it('opens the doors on a draft event', async () => {
    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(result.ok && result.value.status).toBe('live')
  })

  it('persists the new status, so an upload arriving next is judged by it', async () => {
    await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    const stored = await events.findById(WEDDING)

    expect(stored?.status).toBe('live')
  })

  /**
   * A projector left running unattended has to notice on its own that the event it is
   * playing was closed or archived, which is why the status travels with the fact.
   */
  it('announces the status the event now has', async () => {
    await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(bus.published).toEqual([
      { type: 'event.statusChanged', eventId: WEDDING, status: 'live' },
    ])
  })

  /** `closedAt` starts the retention clock, and it comes from the injected clock. */
  it('stamps the end of the party from the injected clock', async () => {
    seedWedding('live')

    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'closed' })

    expect(result.ok && result.value.closedAt).toEqual(CLOSED_AT)
  })

  it('succeeds on a status the event already has, so a double-clicked button is not an error', async () => {
    seedWedding('live')

    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(result.ok).toBe(true)
  })

  // ------------------------------------------------------- illegal transitions --

  it('refuses a transition the lifecycle does not allow', async () => {
    seedWedding('archived')

    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(!result.ok && result.error.code).toBe('event.illegalTransition')
  })

  it('reports an illegal transition as a conflict', async () => {
    seedWedding('archived')

    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(!result.ok && result.error.kind).toBe('conflict')
  })

  it('announces nothing when the transition is refused', async () => {
    seedWedding('archived')

    await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(bus.published).toEqual([])
  })

  it('leaves the event archived when the transition is refused', async () => {
    seedWedding('archived')

    await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    const stored = await events.findById(WEDDING)

    expect(stored?.status).toBe('archived')
  })

  // ------------------------------------------------------------ authorization --

  /**
   * `closed` stops every guest upload and `archived` is terminal. A moderator was
   * handed a laptop to approve photos, not to end the party.
   */
  it('refuses a moderator of the event', async () => {
    const result = await changeEventStatus({ eventId: WEDDING, actorId: MODERATOR, status: 'live' })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('announces nothing when a moderator tries', async () => {
    await changeEventStatus({ eventId: WEDDING, actorId: MODERATOR, status: 'live' })

    expect(bus.published).toEqual([])
  })

  /**
   * `notFound`, not `forbidden`: confirming that an event exists to someone with no
   * part in it turns this into an enumeration oracle for other people's events.
   */
  it('answers notFound to a caller with no membership in the event', async () => {
    const result = await changeEventStatus({
      eventId: WEDDING,
      actorId: asUserId('user-nobody'),
      status: 'live',
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('cannot close another event with the role the caller holds on their own', async () => {
    const result = await changeEventStatus({ eventId: GALA, actorId: OWNER, status: 'closed' })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('leaves the other event running', async () => {
    await changeEventStatus({ eventId: GALA, actorId: OWNER, status: 'closed' })

    const stored = await events.findById(GALA)

    expect(stored?.status).toBe('live')
  })

  it('answers notFound for an event id that does not exist', async () => {
    const result = await changeEventStatus({
      eventId: asEventId('evt-nothing'),
      actorId: OWNER,
      status: 'live',
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  // ------------------------------------------------- opened_at and a client’s window --

  /**
   * The live window (roadmap §10.5 / G2-05). `closed → live` is a legal transition and
   * reopening clears `closedAt`, so a host pressing one button a month would otherwise keep
   * a public wall and the photographs behind it for ever; for an event of a client the
   * window — `opened_at + max_live_days` — is what stops that.
   */
  describe('the live window of a client’s event', () => {
    const DAY = 86_400_000
    const OPENED_AT = atPlus(0)
    const MAX_THREE_DAYS = 3 * DAY

    /** The client's own event: the wedding above has none, and an event keeps the client it was made with. */
    const CLIENT_EVENT = asEventId('evt-client')

    const seedClientEvent = async (
      status: EventStatus,
      ceilings: Partial<ClientCeilingsProps>,
      openedAt = OPENED_AT,
    ): Promise<void> => {
      clients.seed(aClient({ id: 'client-1', ceilings }))
      events.seed(
        anEvent({
          id: CLIENT_EVENT,
          ownerId: OWNER,
          slug: 'soiree-cliente',
          joinCode: 'K8M3NP',
          status,
          clientId: 'client-1',
          openedAt: status === 'draft' ? null : openedAt,
          closedAt: status === 'closed' ? atPlus(DAY) : null,
        }),
      )
      await memberships.grant({
        eventId: CLIENT_EVENT,
        userId: OWNER,
        role: 'owner',
        grantedAt: AT,
      })
    }

    const setStatus = (status: EventStatus) =>
      changeEventStatus({ eventId: CLIENT_EVENT, actorId: OWNER, status })

    describe('opened_at', () => {
      it('is recorded when a draft first goes live, with no client at all', async () => {
        const result = await changeEventStatus({
          eventId: WEDDING,
          actorId: OWNER,
          status: 'live',
        })

        expect(result.ok && result.value.openedAt).toEqual(CLOSED_AT)
        expect((await events.findById(WEDDING))?.openedAt).toEqual(CLOSED_AT)
      })

      it('is recorded for a client’s event too, and survives a close and a reopening unchanged', async () => {
        await seedClientEvent('draft', { maxLiveDays: 3 })
        await setStatus('live')
        const openedAt = (await events.findById(CLIENT_EVENT))?.openedAt
        clock.advance(DAY)
        await setStatus('closed')
        clock.advance(DAY)

        const reopened = await setStatus('live')

        expect(openedAt).toEqual(CLOSED_AT)
        expect(reopened.ok && reopened.value.openedAt).toEqual(openedAt)
      })
    })

    describe('draft → live under live_allowed = 0', () => {
      beforeEach(async () => seedClientEvent('draft', { liveAllowed: false }))

      it('is refused 403 client.liveNotAllowed', async () => {
        const result = await setStatus('live')

        expect(!result.ok && result.error.code).toBe('client.liveNotAllowed')
        expect(!result.ok && result.error.kind).toBe('forbidden')
      })

      it('stores nothing and announces nothing', async () => {
        await setStatus('live')

        const stored = await events.findById(CLIENT_EVENT)
        expect(stored?.status).toBe('draft')
        expect(stored?.openedAt).toBeNull()
        expect(bus.published).toEqual([])
      })

      it('still lets the draft be archived', async () => {
        const result = await setStatus('archived')

        expect(result.ok).toBe(true)
      })
    })

    describe('closed → live', () => {
      beforeEach(async () => seedClientEvent('closed', { maxLiveDays: 3 }))

      it('is allowed one millisecond before opened_at + max_live_days', async () => {
        clock.set(new Date(OPENED_AT.getTime() + MAX_THREE_DAYS - 1))

        const result = await setStatus('live')

        expect(result.ok && result.value.status).toBe('live')
      })

      it('is refused 403 client.liveWindowOver at exactly opened_at + max_live_days: a reopening after the window', async () => {
        clock.set(new Date(OPENED_AT.getTime() + MAX_THREE_DAYS))

        const result = await setStatus('live')

        expect(!result.ok && result.error.code).toBe('client.liveWindowOver')
        expect(!result.ok && result.error.kind).toBe('forbidden')
      })

      it('is refused a month on, which is what a button pressed once a month would have kept for ever', async () => {
        clock.set(new Date(OPENED_AT.getTime() + 30 * DAY))

        const result = await setStatus('live')

        expect(!result.ok && result.error.code).toBe('client.liveWindowOver')
      })

      it('leaves the event closed, with its closing instant, so the retention clock keeps running', async () => {
        clock.set(new Date(OPENED_AT.getTime() + 30 * DAY))

        await setStatus('live')

        const stored = await events.findById(CLIENT_EVENT)
        expect(stored?.status).toBe('closed')
        expect(stored?.closedAt).toEqual(atPlus(DAY))
        expect(bus.published).toEqual([])
      })

      it('does not stop the host archiving it, after the window or before', async () => {
        clock.set(new Date(OPENED_AT.getTime() + 30 * DAY))

        const result = await setStatus('archived')

        expect(result.ok && result.value.status).toBe('archived')
      })
    })

    it('says an archived event cannot go live with the lifecycle’s conflict, whatever the window', async () => {
      await seedClientEvent('archived', { maxLiveDays: 3 })

      const result = await setStatus('live')

      expect(!result.ok && result.error.code).toBe('event.illegalTransition')
    })

    it('does not refuse closing a live event past its window', async () => {
      await seedClientEvent('live', { maxLiveDays: 3 })
      clock.set(new Date(OPENED_AT.getTime() + 30 * DAY))

      const result = await setStatus('closed')

      expect(result.ok && result.value.status).toBe('closed')
    })
  })

  describe('an event with no client', () => {
    it('reopens a month after it first opened, exactly as before, and never reads the clients', async () => {
      events.seed(
        anEvent({
          id: WEDDING,
          ownerId: OWNER,
          slug: 'camille-et-sacha',
          joinCode: 'H7K2QM',
          status: 'closed',
          openedAt: AT,
          closedAt: atPlus(60_000),
        }),
      )
      clock.set(new Date(AT.getTime() + 30 * 86_400_000))

      const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

      expect(result.ok && result.value.status).toBe('live')
      expect(clients.contextReads).toBe(0)
    })
  })
})
