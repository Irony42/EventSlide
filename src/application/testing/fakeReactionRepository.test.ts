import { describe, expect, it } from 'vitest'
import { asEventId, asGuestId, asPhotoId } from '../../domain/shared/ids'
import { reactionRepositoryContract } from './contracts/reactionRepositoryContract'
import { aReaction } from './builders'
import { FakeReactionRepository } from './fakeReactionRepository'

reactionRepositoryContract('fake', async () => ({ repo: new FakeReactionRepository() }))

const WEDDING = asEventId('evt-wedding')
const P1 = asPhotoId('p1')
const LEA = asGuestId('guest-lea')

describe('FakeReactionRepository seeding', () => {
  it('returns itself, so a test arranges its world in one expression', async () => {
    const repo = new FakeReactionRepository()

    expect(repo.seed(aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA }))).toBe(
      repo,
    )
  })

  it('seeds rows the repository can then read', async () => {
    const repo = new FakeReactionRepository().seed(
      aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
    )

    expect((await repo.findOne(WEDDING, P1, LEA, 'love'))?.id).toBe('r1')
  })

  it('refuses a fixture that duplicates a guest reaction on a photo', async () => {
    expect(() =>
      new FakeReactionRepository().seed(
        aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
        aReaction({ id: 'r2', eventId: WEDDING, photoId: P1, guestId: LEA, kind: 'love' }),
      ),
    ).toThrow(/UNIQUE constraint failed/)
  })

  it('hands out a fresh map, so a caller cannot edit the stored tally', async () => {
    const repo = new FakeReactionRepository().seed(
      aReaction({ id: 'r1', eventId: WEDDING, photoId: P1, guestId: LEA }),
    )

    expect(await repo.countsForEvent(WEDDING)).not.toBe(await repo.countsForEvent(WEDDING))
  })
})
