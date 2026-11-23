import { describe, expect, it } from 'vitest'
import { aHousehold } from '../../domain/guestRsvps/testing/householdFixtures'
import { asEventId } from '../../domain/shared/ids'
import { aRsvp } from '../../domain/guestRsvps/testing/rsvpFixtures'
import { asGuestRsvpId } from '../../domain/shared/ids'
import { FakeGuestRsvpRepository } from './fakeGuestRsvpRepository'
import { guestHouseholdRepositoryContract } from './contracts/guestHouseholdRepositoryContract'
import { FakeGuestHouseholdRepository } from './fakeGuestHouseholdRepository'

guestHouseholdRepositoryContract('fake', async () => {
  const rsvps = new FakeGuestRsvpRepository()
  const repo = new FakeGuestHouseholdRepository(rsvps)
  return {
    repo,
    seedReply: async (eventId, id, householdId) =>
      void rsvps.seed(aRsvp({ id, eventId, householdId })),
    replyHousehold: async (eventId, id) =>
      (await rsvps.findById(eventId, asGuestRsvpId(id)))?.householdId,
    setEventDates: async (eventId, dates) => void repo.setEventDates(eventId, dates),
  }
})

describe('FakeGuestHouseholdRepository seeding', () => {
  it('returns itself from seed and setEventDates so a test reads in one line', () => {
    const repo = new FakeGuestHouseholdRepository()

    expect(repo.seed(aHousehold())).toBe(repo)
    expect(repo.setEventDates(asEventId('event-1'), { closedAt: null, startsAt: null })).toBe(repo)
  })

  it('puts a row in with no ceiling applied', async () => {
    const repo = new FakeGuestHouseholdRepository().seed(aHousehold())

    expect(await repo.listByEvent(asEventId('event-1'))).toHaveLength(1)
  })
})
