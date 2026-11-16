import { describe, expect, it } from 'vitest'
import { announcementRepositoryContract } from './contracts/announcementRepositoryContract'
import { FakeAnnouncementRepository } from './fakeAnnouncementRepository'

announcementRepositoryContract('fake', async () => ({ repo: new FakeAnnouncementRepository() }))

describe('FakeAnnouncementRepository seeding', () => {
  it('returns itself from seed so a test reads in one line', () => {
    const repo = new FakeAnnouncementRepository()

    expect(repo.seed()).toBe(repo)
  })
})
