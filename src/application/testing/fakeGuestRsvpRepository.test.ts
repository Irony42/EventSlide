import { describe, expect, it } from 'vitest'
import { aRsvp } from '../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId } from '../../domain/shared/ids'
import { guestRsvpRepositoryContract } from './contracts/guestRsvpRepositoryContract'
import { FakeMailPreferenceRepository } from './fakeMailPreferenceRepository'
import { FakeGuestRsvpRepository } from './fakeGuestRsvpRepository'

guestRsvpRepositoryContract('fake', async () => {
  const preferences = new FakeMailPreferenceRepository()
  const repo = new FakeGuestRsvpRepository({ mailPreferences: preferences })
  return {
    repo,
    setDigest: async (eventId, userId, state) => {
      preferences.withMembers({ eventId, userId })
      await preferences.setDigest(eventId, userId, state.on)
      if (state.at !== null) await preferences.claimDigest(eventId, userId, null, state.at)
    },
    addMember: async (eventId, userId) => void repo.addMember(eventId, userId),
    setEventDates: async (eventId, dates) => void repo.setEventDates(eventId, dates),
  }
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
