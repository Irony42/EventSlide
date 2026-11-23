import { describe, expect, it } from 'vitest'
import { aRsvp } from '../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId } from '../../domain/shared/ids'
import { guestRsvpRepositoryContract } from './contracts/guestRsvpRepositoryContract'
import { FakeGuestRsvpRepository } from './fakeGuestRsvpRepository'

guestRsvpRepositoryContract('fake', async () => {
  const repo = new FakeGuestRsvpRepository()
  return { repo, setEventDates: async (eventId, dates) => void repo.setEventDates(eventId, dates) }
})

describe('FakeGuestRsvpRepository seeding', () => {
  it('returns itself from seed and setEventDates so a test reads in one line', () => {
    const repo = new FakeGuestRsvpRepository()

    expect(repo.seed(aRsvp())).toBe(repo)
    expect(repo.setEventDates(asEventId('event-1'), { closedAt: null, startsAt: null })).toBe(repo)
  })

  it('puts a row in with no ceiling applied, so a test can hold a state the rules would refuse', async () => {
    const repo = new FakeGuestRsvpRepository().seed(aRsvp({ answer: 'yes', adults: 50 }))

    expect(await repo.listByEvent(asEventId('event-1'))).toHaveLength(1)
  })
})
