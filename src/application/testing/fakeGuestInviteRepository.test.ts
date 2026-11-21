import { describe, expect, it } from 'vitest'
import { guestInviteRepositoryContract } from './contracts/guestInviteRepositoryContract'
import { FakeGuestInviteRepository } from './fakeGuestInviteRepository'

guestInviteRepositoryContract('fake', async () => ({ repo: new FakeGuestInviteRepository() }))

describe('FakeGuestInviteRepository seeding', () => {
  it('returns itself from seed so a test reads in one line', () => {
    const repo = new FakeGuestInviteRepository()

    expect(repo.seed()).toBe(repo)
  })
})
