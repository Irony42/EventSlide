import { describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../../domain/shared/ids'
import { guestRepositoryContract } from './contracts/guestRepositoryContract'
import { aGuest } from './builders'
import { FakeGuestRepository } from './fakeGuestRepository'

guestRepositoryContract('fake', async () => ({ repo: new FakeGuestRepository() }))

const WEDDING = asEventId('evt-wedding')

describe('FakeGuestRepository seeding', () => {
  it('returns itself, so a test arranges its world in one expression', async () => {
    const repo = new FakeGuestRepository()

    expect(repo.seed(aGuest({ id: 'guest-lea', eventId: WEDDING }))).toBe(repo)
  })

  it('seeds rows the repository can then read', async () => {
    const repo = new FakeGuestRepository().seed(aGuest({ id: 'guest-lea', eventId: WEDDING }))

    expect((await repo.findById(WEDDING, asGuestId('guest-lea')))?.id).toBe('guest-lea')
  })

  it('hands out a fresh array, so a caller cannot edit the stored guest list', async () => {
    const repo = new FakeGuestRepository().seed(aGuest({ id: 'guest-lea', eventId: WEDDING }))

    expect(await repo.list(WEDDING)).not.toBe(await repo.list(WEDDING))
  })
})
