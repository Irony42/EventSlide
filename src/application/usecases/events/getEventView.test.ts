import { describe, expect, it } from 'vitest'
import { asClientId, asEventId } from '../../../domain/shared/ids'
import { AT, aClient, aGuest, aPhoto, anEvent, atPlus } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeGetEventLimits } from './getEventLimits'
import { makeGetEventView } from './getEventView'

/**
 * What a host's answer about one event carries besides the event (HTTP-M-06): its counts, and the
 * limits it is under. The cases that matter are the ones about **which** event: the counts are
 * the one event's, never a neighbour's, and never the host's whole dashboard.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const aWorld = () => {
  const photos = new FakePhotoRepository().seed(
    aPhoto({ id: 'w1', eventId: WEDDING, status: 'pending', byteSize: 1_000 }),
    aPhoto({ id: 'w2', eventId: WEDDING, status: 'published', byteSize: 2_000 }),
    aPhoto({ id: 'g1', eventId: GALA, status: 'published', byteSize: 40_000 }),
    aPhoto({ id: 'g2', eventId: GALA, status: 'published', byteSize: 50_000 }),
    aPhoto({ id: 'g3', eventId: GALA, status: 'pending', byteSize: 60_000 }),
  )
  const guests = new FakeGuestRepository().seed(
    aGuest({ id: 'guest-lea', eventId: WEDDING }),
    aGuest({ id: 'guest-nils', eventId: GALA }),
    aGuest({ id: 'guest-ines', eventId: GALA }),
  )
  const clients = new FakeClientRepository()
  const wedding = anEvent({ id: WEDDING, slug: 'mariage', quotaBytes: 5_000 })
  const gala = anEvent({ id: GALA, slug: 'gala', joinCode: 'ZZZZZZ' })
  const events = new FakeEventRepository({ photos, guests, clients }).seed(wedding, gala)
  const getEventView = makeGetEventView({
    events,
    getEventLimits: makeGetEventLimits({ clients }),
  })
  return { getEventView, clients, wedding, gala }
}

describe('getEventView', () => {
  it('hands back the event it was given', async () => {
    const { getEventView, wedding } = aWorld()

    const view = await getEventView({ event: wedding })

    expect(view.event).toBe(wedding)
  })

  it('counts what that event holds: its photos, those awaiting a decision, its guests and its bytes', async () => {
    const { getEventView, wedding } = aWorld()

    const view = await getEventView({ event: wedding })

    expect(view.counts).toEqual({
      photoCount: 2,
      pendingCount: 1,
      guestCount: 1,
      usedBytes: 3_000,
    })
  })

  it('counts a neighbour’s event for the neighbour, and none of it for this one', async () => {
    const { getEventView, gala } = aWorld()

    const view = await getEventView({ event: gala })

    expect(view.counts).toEqual({
      photoCount: 3,
      pendingCount: 1,
      guestCount: 2,
      usedBytes: 150_000,
    })
  })

  it('gives an event with no client the quota it was created with, and no live window', async () => {
    const { getEventView, wedding } = aWorld()

    const view = await getEventView({ event: wedding })

    expect(view.limits).toEqual({ quotaBytes: 5_000, liveWindowEnd: null })
  })

  it('says when the live window closes, which the client’s ceiling on live days decides', async () => {
    const { getEventView, clients } = aWorld()
    clients.seed(aClient({ id: 'client-w', ceilings: { maxLiveDays: 3 } }))
    const event = anEvent({ id: WEDDING, clientId: 'client-w', status: 'live', openedAt: AT })
    clients.linkEvent(event.id, asClientId('client-w'))

    const view = await getEventView({ event })

    expect(view.limits.liveWindowEnd).toEqual(atPlus(3 * 24 * 60 * 60 * 1000))
  })

  it('lowers the quota to the client’s ceiling, as the upload path will', async () => {
    const { getEventView, clients } = aWorld()
    clients.seed(aClient({ id: 'client-q', ceilings: { maxEventQuotaBytes: 2_000 } }))
    const event = anEvent({ id: WEDDING, quotaBytes: 5_000, clientId: 'client-q' })
    clients.linkEvent(event.id, asClientId('client-q'))

    const view = await getEventView({ event })

    expect(view.limits.quotaBytes).toBe(2_000)
  })
})
