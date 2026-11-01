import { describe, expect, it } from 'vitest'
import { asEventId, asGuestbookEntryId } from '../../domain/shared/ids'
import { aGuestbookEntry } from './builders'
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
