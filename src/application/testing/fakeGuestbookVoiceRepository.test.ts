import { describe, expect, it } from 'vitest'
import { asClientId, asEventId, asGuestId, asGuestbookEntryId } from '../../domain/shared/ids'
import { aVoiceEntry } from './builders'
import { guestbookVoiceRepositoryContract } from './contracts/guestbookVoiceRepositoryContract'
import { FakeGuestbookRepository } from './fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from './fakeGuestbookVoiceRepository'

guestbookVoiceRepositoryContract('fake', async () => {
  const guestbook = new FakeGuestbookRepository()
  const voices = new FakeGuestbookVoiceRepository(guestbook)
  const photoBytes = new Map<string, number>()
  voices.chargePhotoBytesFrom({ photoBytes: async (eventId) => photoBytes.get(eventId) ?? 0 })
  return {
    voices,
    guestbook,
    takeDown: (eventId, entryId, at) =>
      guestbook.takeDown(asEventId(eventId), asGuestbookEntryId(entryId), at),
    chargePhotoBytes: async (eventId, bytes) => {
      photoBytes.set(eventId, bytes)
    },
  }
})

const limits = { quotaBytes: 1_000_000, maxQueuedVoices: 10, maxQueuedVoicesPerEvent: 10 }
const EVENT = asEventId('event-1')

describe('FakeGuestbookVoiceRepository', () => {
  it('is a view over the guestbook rows: a voice it admits is in the book', async () => {
    const guestbook = new FakeGuestbookRepository()
    const voices = new FakeGuestbookVoiceRepository(guestbook)

    await voices.admitVoice(aVoiceEntry({ id: 'v1', state: 'reserved' }), limits)

    expect(guestbook.all(EVENT).map((row) => row.id)).toEqual(['v1'])
  })

  it('says so when a client ceiling is asked of it and it has no way to see the client events', async () => {
    const voices = new FakeGuestbookVoiceRepository(new FakeGuestbookRepository())

    await expect(
      voices.admitVoice(aVoiceEntry({ id: 'v1', state: 'reserved' }), {
        ...limits,
        clientBytes: { clientId: asClientId('client-1'), maxBytes: 10 },
      }),
    ).rejects.toThrow('chargeClientEventsFrom')
  })

  it('refuses on the client ceiling once it is wired, counting every event the client has', async () => {
    const voices = new FakeGuestbookVoiceRepository(new FakeGuestbookRepository())
      .chargeClientEventsFrom({ eventsOf: () => [EVENT, asEventId('event-2')] })
      .chargePhotoBytesFrom({ photoBytes: async (eventId) => (eventId === 'event-2' ? 900 : 0) })

    const refused = await voices.admitVoice(
      aVoiceEntry({ id: 'v1', state: 'reserved', sourceByteSize: 200 }),
      { ...limits, clientBytes: { clientId: asClientId('client-1'), maxBytes: 1_000 } },
    )

    expect(refused).toEqual({
      kind: 'refused',
      refusal: { reason: 'clientStorageFull', remaining: 100 },
    })
  })

  it('answers false for a voice that is not there, and ignores the removal of one that is not', async () => {
    const voices = new FakeGuestbookVoiceRepository(new FakeGuestbookRepository())
    const voice = aVoiceEntry({ id: 'v1', state: 'reserved' }).voice
    if (voice === null) throw new Error('fixture')

    expect(await voices.saveVoice(EVENT, asGuestbookEntryId('v1'), voice.queue(new Date()))).toBe(
      false,
    )
    await voices.deleteByEntry(EVENT, asGuestbookEntryId('nope'))
    expect(await voices.listByGuest(EVENT, asGuestId('guest-1'))).toEqual([])
  })
})
