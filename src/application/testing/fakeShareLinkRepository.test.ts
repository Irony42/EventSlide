import { describe, expect, it } from 'vitest'
import { AT, aShareLink } from './builders'
import { shareLinkRepositoryContract } from './contracts/shareLinkRepositoryContract'
import { FakeShareLinkRepository } from './fakeShareLinkRepository'

shareLinkRepositoryContract('fake', async () => ({ repo: new FakeShareLinkRepository() }))

/**
 * What the fake does that the contract cannot ask of SQLite: the seeding helpers, and the
 * uniqueness a fixture must not be able to walk past.
 */
describe('FakeShareLinkRepository seeding', () => {
  it('seeds and returns itself, so a fixture reads as one expression', () => {
    const repo = new FakeShareLinkRepository()

    expect(repo.seed(aShareLink())).toBeInstanceOf(FakeShareLinkRepository)
    expect(repo.all()).toHaveLength(1)
  })

  it('refuses a fixture that would give an event two current links', () => {
    // A fixture the real database would reject makes the test after it prove nothing.
    const repo = new FakeShareLinkRepository().seed(aShareLink({ id: 'a', eventId: 'e1' }))

    expect(() => repo.seed(aShareLink({ id: 'b', eventId: 'e1' }))).toThrow(/UNIQUE/)
  })

  it('accepts a revoked link beside the current one, which is what history looks like', () => {
    const repo = new FakeShareLinkRepository().seed(
      aShareLink({ id: 'a', eventId: 'e1', revokedAt: AT }),
      aShareLink({ id: 'b', eventId: 'e1' }),
    )

    expect(repo.all()).toHaveLength(2)
  })
})
