import { describe, expect, it } from 'vitest'
import { asEventId } from '../../../domain/shared/ids'
import { AT } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventStatsRepository } from '../../testing/fakeEventStatsRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { makeRecordEngagement } from './recordEngagement'

const EVENT = asEventId('event-1')

const aStatsFake = (): FakeEventStatsRepository => {
  const photos = new FakePhotoRepository()
  return new FakeEventStatsRepository(
    photos,
    new FakeGuestRepository(photos),
    new FakeReactionRepository(),
  )
}

describe('recordEngagement', () => {
  it('adds to the counter of the UTC day the clock says', async () => {
    const stats = aStatsFake()
    const record = makeRecordEngagement({
      stats,
      clock: new FakeClock(AT),
      logger: new CapturingLogger(),
    })

    await record({ eventId: EVENT, metric: 'galleryViews', delta: 1 })
    await record({ eventId: EVENT, metric: 'galleryViews', delta: 1 })

    expect(await stats.readCounters(EVENT)).toEqual([
      { metric: 'galleryViews', day: '2026-06-20', value: 2 },
    ])
  })

  it('swallows an error of the repository and says so in the log, with nothing about a person', async () => {
    const logger = new CapturingLogger()
    const record = makeRecordEngagement({
      stats: {
        bump: async () => {
          throw new Error('database is locked')
        },
      },
      clock: new FakeClock(AT),
      logger,
    })

    await expect(
      record({ eventId: EVENT, metric: 'galleryViews', delta: 1 }),
    ).resolves.toBeUndefined()

    expect(JSON.stringify(logger.lines)).toContain('database is locked')
  })

  it('does not blame a thrown value that is not an error', async () => {
    const record = makeRecordEngagement({
      stats: {
        bump: async () => {
          throw 'nope'
        },
      },
      clock: new FakeClock(AT),
      logger: new CapturingLogger(),
    })

    await expect(
      record({ eventId: EVENT, metric: 'galleryViews', delta: 1 }),
    ).resolves.toBeUndefined()
  })
})
