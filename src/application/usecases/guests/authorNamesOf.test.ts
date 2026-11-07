import { describe, expect, it, vi } from 'vitest'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { aGuest, aPhoto } from '../../testing/builders'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { authorNamesOf } from './authorNamesOf'

const EVENT = asEventId('event-1')

describe('authorNamesOf', () => {
  it('names each guest who sent a photo, and only them', async () => {
    const guests = new FakeGuestRepository().seed(
      aGuest({ id: 'guest-1', displayName: 'Léa' }),
      aGuest({ id: 'guest-2', displayName: 'Marc' }),
      aGuest({ id: 'guest-3', displayName: 'Zoé' }),
    )

    const names = await authorNamesOf(guests, EVENT, [
      aPhoto({ id: 'p1', author: { kind: 'guest', id: 'guest-1' } }),
      aPhoto({ id: 'p2', author: { kind: 'guest', id: 'guest-2' } }),
    ])

    expect([...names]).toEqual([
      [asGuestId('guest-1'), 'Léa'],
      [asGuestId('guest-2'), 'Marc'],
    ])
  })

  it('asks once, for each guest once, however many photos they sent', async () => {
    const guests = new FakeGuestRepository().seed(aGuest({ id: 'guest-1', displayName: 'Léa' }))
    const lookup = vi.spyOn(guests, 'findNamesByIds')

    await authorNamesOf(guests, EVENT, [
      aPhoto({ id: 'p1', author: { kind: 'guest', id: 'guest-1' } }),
      aPhoto({ id: 'p2', author: { kind: 'guest', id: 'guest-1' } }),
      aPhoto({ id: 'p3', author: { kind: 'guest', id: 'guest-1' } }),
    ])

    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith(EVENT, [asGuestId('guest-1')])
  })

  it('leaves a host upload out of the lookup: there is no guest behind it', async () => {
    const guests = new FakeGuestRepository().seed(aGuest({ id: 'host-1', displayName: 'Hôte' }))
    const lookup = vi.spyOn(guests, 'findNamesByIds')

    const names = await authorNamesOf(guests, EVENT, [
      aPhoto({ id: 'p1', author: { kind: 'host', id: 'host-1' } }),
    ])

    expect(lookup).toHaveBeenCalledWith(EVENT, [])
    expect(names.size).toBe(0)
  })

  it('does not invent a name for a guest who stayed anonymous or is gone', async () => {
    const guests = new FakeGuestRepository().seed(aGuest({ id: 'guest-1', displayName: null }))

    const names = await authorNamesOf(guests, EVENT, [
      aPhoto({ id: 'p1', author: { kind: 'guest', id: 'guest-1' } }),
      aPhoto({ id: 'p2', author: { kind: 'guest', id: 'ghost' } }),
    ])

    expect(names.size).toBe(0)
  })
})
