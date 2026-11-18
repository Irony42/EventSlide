import { describe, expect, it } from 'vitest'
import { asEventId, asGuestbookEntryId } from '../../domain/shared/ids'
import { aGuestbookEntry, aVoiceEntry } from './builders'
import { FakeGuestbookRepository } from './fakeGuestbookRepository'
import { guestbookRepositoryContract } from './contracts/guestbookRepositoryContract'

guestbookRepositoryContract('fake', async () => {
  const repo = new FakeGuestbookRepository()
  return {
    repo,
    takeDown: (eventId, entryId, at) =>
      repo.takeDown(asEventId(eventId), asGuestbookEntryId(entryId), at),
  }
})

describe('FakeGuestbookRepository seeding', () => {
  it('seeds a list and returns itself, so a fixture reads as one expression', () => {
    const seeded = new FakeGuestbookRepository().seed(aGuestbookEntry({ id: 'e1' }))

    expect(seeded).toBeInstanceOf(FakeGuestbookRepository)
    expect(seeded.all(asEventId('event-1')).map((row) => row.id)).toEqual(['e1'])
  })

  it('ignores a takedown of a message that is not there', () => {
    const repo = new FakeGuestbookRepository()

    repo.takeDown(asEventId('event-1'), asGuestbookEntryId('nope'), new Date())

    expect(repo.all(asEventId('event-1'))).toEqual([])
  })
})

describe('FakeGuestbookRepository and voice messages', () => {
  const EVENT = asEventId('event-1')

  it('refuses to admit a voice message: it has its own door, which reserves its bytes too', async () => {
    const repo = new FakeGuestbookRepository()

    await expect(repo.admit(aVoiceEntry({ id: 'v1', state: 'reserved' }))).rejects.toThrow(
      'admit takes a written message',
    )
  })

  it('writes and removes a row synchronously, which is how the voice fake keeps its decision atomic', () => {
    const repo = new FakeGuestbookRepository()
    const voice = aVoiceEntry({ id: 'v1', state: 'reserved' })

    repo.put(voice)
    expect(repo.all(EVENT).map((row) => row.id)).toEqual(['v1'])
    repo.remove(EVENT, voice.id)
    expect(repo.all(EVENT)).toEqual([])
  })

  it('lists every row of every event for the worker-wide reads, taken-down ones included', () => {
    const repo = new FakeGuestbookRepository().seed(
      aGuestbookEntry({ id: 'e1' }),
      aVoiceEntry({ id: 'v1', state: 'queued', eventId: 'event-2' }),
    )
    repo.takeDown(EVENT, asGuestbookEntryId('e1'), new Date())

    expect(
      repo
        .everything()
        .map((row) => row.id)
        .sort(),
    ).toEqual(['e1', 'v1'])
  })
})
