import { describe, expect, it } from 'vitest'
import { asEventId } from '../../../domain/shared/ids'
import { AT, aClient, anEvent } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePurgeNoticeLedger } from '../../testing/fakePurgeNoticeLedger'
import { makeGetEventLimits } from './getEventLimits'
import { makeGetEventView } from './getEventView'

/**
 * Spec 22: what a host sees of the album's deletion. The date is the one the sweep acts on, and
 * the view says nothing of the operator's hold on the purge.
 */

const WEDDING = asEventId('evt-wedding')
const DAY = 86_400_000

const aWorld = () => {
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ clients })
  const notices = new FakePurgeNoticeLedger().withEvents(WEDDING)
  const getEventView = makeGetEventView({
    events,
    clients,
    notices,
    capNoticeDays: 30,
    getEventLimits: makeGetEventLimits({ clients }),
  })
  return { getEventView, clients, events, notices }
}

const closedWedding = (extra: Parameters<typeof anEvent>[0] = {}) =>
  anEvent({
    id: WEDDING,
    slug: 'mariage',
    status: 'closed',
    closedAt: AT,
    settings: { retentionDays: 30 },
    ...extra,
  })

describe('getEventView: the date the album will be deleted', () => {
  it('is the day the sweep acts on: the close plus the host retention', async () => {
    const { getEventView, events } = aWorld()
    const wedding = closedWedding()
    events.seed(wedding)

    const { purge } = await getEventView({ event: wedding })

    expect(purge.at).toEqual(new Date(AT.getTime() + 30 * DAY))
  })

  it('is no date for an album kept until a person deletes it', async () => {
    const { getEventView, events } = aWorld()
    const wedding = closedWedding({ settings: { retentionDays: null } })
    events.seed(wedding)

    const { purge } = await getEventView({ event: wedding })

    expect(purge).toEqual({ at: null, notice: null, offboarding: false })
  })

  it('is no date while the event is live: the clock starts when it closes', async () => {
    const { getEventView, events } = aWorld()
    const wedding = anEvent({ id: WEDDING, status: 'live', settings: { retentionDays: 30 } })
    events.seed(wedding)

    const { purge } = await getEventView({ event: wedding })

    expect(purge.at).toBeNull()
  })

  it('is brought forward by the ceiling of the event client, as the sweep would', async () => {
    const { getEventView, events, clients } = aWorld()
    clients.seed(aClient({ id: 'client-1', ceilings: { maxRetentionDays: 7 } }))
    const wedding = closedWedding({ clientId: 'client-1' })
    events.seed(wedding)

    const { purge } = await getEventView({ event: wedding })

    expect(purge.at).toEqual(new Date(AT.getTime() + 7 * DAY))
  })

  it('is the date of an offboarding, which is the grace period the client was told', async () => {
    const { getEventView, events, clients } = aWorld()
    const goes = new Date(AT.getTime() + 3 * DAY)
    clients.seed(aClient({ id: 'client-1', suspendedAt: AT, purgeAfter: goes }))
    const wedding = closedWedding({ clientId: 'client-1' })
    events.seed(wedding)

    const { purge } = await getEventView({ event: wedding })

    expect(purge.at).toEqual(goes)
    expect(purge.offboarding).toBe(true)
  })

  it('is not an offboarding for a suspended client that has no purge date, nor for no client', async () => {
    const { getEventView, events, clients } = aWorld()
    clients.seed(aClient({ id: 'client-1', suspendedAt: AT, purgeAfter: null }))
    const abused = closedWedding({ clientId: 'client-1' })
    events.seed(abused)

    expect((await getEventView({ event: abused })).purge.offboarding).toBe(false)
  })

  it('shows the date of an album the operator holds, and gives no sign that it is held', async () => {
    const { getEventView, events } = aWorld()
    const wedding = closedWedding()
    events.seed(wedding)
    await events.setPurgeHeld(WEDDING, AT)

    const held = await getEventView({ event: (await events.findById(WEDDING)) ?? wedding })

    expect(held.purge).toEqual({
      at: new Date(AT.getTime() + 30 * DAY),
      notice: null,
      offboarding: false,
    })
    expect(Object.keys(held.purge).sort()).toEqual(['at', 'notice', 'offboarding'])
  })
})

describe('getEventView: the last warning sent', () => {
  it('is none until an e-mail has been sent', async () => {
    const { getEventView, events } = aWorld()
    const wedding = closedWedding()
    events.seed(wedding)

    expect((await getEventView({ event: wedding })).purge.notice).toBeNull()
  })

  it('is the threshold of the last e-mail', async () => {
    const { getEventView, events, notices } = aWorld()
    const wedding = closedWedding()
    events.seed(wedding)
    await notices.note(WEDDING, 14, AT)
    await notices.note(WEDDING, 3, AT)

    expect((await getEventView({ event: wedding })).purge.notice).toBe(3)
  })

  it('is none for an album with no date, even if a warning was once noted', async () => {
    const { getEventView, events, notices } = aWorld()
    const wedding = closedWedding({ settings: { retentionDays: null } })
    events.seed(wedding)
    await notices.note(WEDDING, 14, AT)

    expect((await getEventView({ event: wedding })).purge).toEqual({
      at: null,
      notice: null,
      offboarding: false,
    })
  })
})
