import { beforeEach, describe, expect, it } from 'vitest'
import type { EventId } from '../../../domain/shared/ids'
import { asEventId } from '../../../domain/shared/ids'
import { AT, aClient, aPhoto, anEvent, atPlus } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { CallLog } from '../../testing/callLog'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { makePurgeExpiredEvents, type PurgeExpiredEvents } from './purgeExpiredEvents'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const DAY = 86_400_000
/** A month and a day after both events closed: the 30-day deadline has gone by. */
const SWEEP_AT = atPlus(31 * DAY)
const HASH = aPhoto().contentHash

/** A store holding bytes for both events, so what a sweep purged is what is no longer there. */
const storeHoldingBoth = async (failing: readonly EventId[] = []): Promise<InMemoryMediaStore> => {
  const media = new InMemoryMediaStore().failEventPurges(...failing)
  await media.put(WEDDING, HASH, 'original', Uint8Array.of(1))
  await media.put(GALA, HASH, 'original', Uint8Array.of(1))
  return media
}

describe('purgeExpiredEvents', () => {
  let events: FakeEventRepository
  let media: InMemoryMediaStore
  let clock: FakeClock
  let calls: CallLog
  let purgeExpiredEvents: PurgeExpiredEvents

  /** The store as the sweep sees it: every call it makes is written down. */
  const watched = (store: InMemoryMediaStore): InMemoryMediaStore => {
    calls = new CallLog()
    return calls.watch('media', store)
  }

  /** What is left on the disk for the wedding and for the gala, in bytes. */
  const bytesLeft = async (): Promise<number[]> => [
    await media.usedBytes(WEDDING),
    await media.usedBytes(GALA),
  ]

  beforeEach(async () => {
    events = new FakeEventRepository()
    media = await storeHoldingBoth()
    clock = new FakeClock(SWEEP_AT)
    purgeExpiredEvents = makePurgeExpiredEvents({
      events,
      media: watched(media),
      clock,
      capNoticeDays: 30,
    })
  })

  const seedExpiredWedding = (): void => {
    events.seed(
      anEvent({
        id: WEDDING,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        status: 'closed',
        settings: { retentionDays: 30 },
      }),
    )
  }

  it('purges the media of an event past its retention deadline', async () => {
    seedExpiredWedding()

    await purgeExpiredEvents()

    expect(await bytesLeft()).toEqual([0, 1])
    expect(calls.names).toEqual(['media.deleteEvent'])
  })

  it('purges the row of an event past its retention deadline', async () => {
    seedExpiredWedding()

    await purgeExpiredEvents()

    expect(await events.findById(WEDDING)).toBeNull()
  })

  it('reports what it purged, which is what an operator reads in the job log', async () => {
    seedExpiredWedding()

    const report = await purgeExpiredEvents()

    expect(report).toEqual({ purged: [WEDDING], failed: [] })
  })

  // -------------------------------------------------------- what it must not eat --

  it('leaves an event whose retention deadline has not arrived', async () => {
    events.seed(
      anEvent({
        id: WEDDING,
        status: 'closed',
        settings: { retentionDays: 60 },
      }),
    )

    const report = await purgeExpiredEvents()

    expect(report).toEqual({ purged: [], failed: [] })
  })

  /** No `retentionDays` means keep the album forever, and that is the default. */
  it('never purges an album the host asked to keep', async () => {
    events.seed(anEvent({ id: WEDDING, status: 'closed' }))

    const report = await purgeExpiredEvents()

    expect(report).toEqual({ purged: [], failed: [] })
  })

  it('never purges an event that is still running', async () => {
    events.seed(anEvent({ id: WEDDING, status: 'live', settings: { retentionDays: 30 } }))

    const report = await purgeExpiredEvents()

    expect(report).toEqual({ purged: [], failed: [] })
  })

  it('asks the media store for nothing when nothing is due', async () => {
    await purgeExpiredEvents()

    expect(await bytesLeft()).toEqual([1, 1])
    expect(calls.names).toEqual([])
  })

  // ------------------------------------------------------- one bad disk, forty events --

  describe('when one event cannot be purged', () => {
    beforeEach(async () => {
      seedExpiredWedding()
      events.seed(
        anEvent({
          id: GALA,
          slug: 'gala-annuel',
          joinCode: 'Z3N9PT',
          status: 'closed',
          settings: { retentionDays: 30 },
        }),
      )
      media = await storeHoldingBoth([GALA])
      purgeExpiredEvents = makePurgeExpiredEvents({
        events,
        media: watched(media),
        clock,
        capNoticeDays: 30,
      })
    })

    it('carries on to the events behind it', async () => {
      const report = await purgeExpiredEvents()

      expect(report.purged).toEqual([WEDDING])
    })

    it('reports the one it could not finish', async () => {
      const report = await purgeExpiredEvents()

      expect(report.failed).toEqual([GALA])
    })

    it('leaves the failed row in place, so the next sweep tries again', async () => {
      await purgeExpiredEvents()

      expect(await events.findById(GALA)).not.toBeNull()
    })
  })

  // ------------------------------------------------ an event that belongs to a client --

  describe('an event that belongs to a client', () => {
    let clients: FakeClientRepository

    beforeEach(() => {
      clients = new FakeClientRepository()
      events = new FakeEventRepository({ clients })
    })

    const purgeWith = (capNoticeDays: number): PurgeExpiredEvents =>
      makePurgeExpiredEvents({ events, media: watched(media), clock, capNoticeDays })

    const seedKeptForEver = (closedAt: Date): void => {
      events.seed(
        anEvent({
          id: WEDDING,
          status: 'closed',
          closedAt,
          clientId: 'client-1',
          settings: { retentionDays: null },
        }),
      )
    }

    it('purges an album kept for ever once the client’s retention ceiling has passed', async () => {
      clients.seed(aClient({ id: 'client-1', ceilings: { maxRetentionDays: 30 } }))
      seedKeptForEver(AT)

      const report = await purgeWith(30)()

      expect(report).toEqual({ purged: [WEDDING], failed: [] })
      expect(await bytesLeft()).toEqual([0, 1])
    })

    it('leaves it until then', async () => {
      clients.seed(aClient({ id: 'client-1', ceilings: { maxRetentionDays: 90 } }))
      seedKeptForEver(AT)

      const report = await purgeWith(30)()

      expect(report).toEqual({ purged: [], failed: [] })
    })

    it('waits out the notice a lowered ceiling is owed, in the days it is configured with', async () => {
      // Closed long ago, ceiling lowered to 14 days at the instant of the sweep.
      clients.seed(
        aClient({
          id: 'client-1',
          ceilings: { maxRetentionDays: 14 },
          retentionCapSince: SWEEP_AT,
        }),
      )
      seedKeptForEver(AT)

      expect(await purgeWith(10)()).toEqual({ purged: [], failed: [] })

      clock.advance(10 * DAY)
      expect(await purgeWith(10)()).toEqual({ purged: [WEDDING], failed: [] })
    })

    it('does not let the notice hold back an album the host themselves asked to be purged by now', async () => {
      clients.seed(
        aClient({
          id: 'client-1',
          ceilings: { maxRetentionDays: 14 },
          retentionCapSince: SWEEP_AT,
        }),
      )
      events.seed(
        anEvent({
          id: WEDDING,
          status: 'closed',
          closedAt: AT,
          clientId: 'client-1',
          settings: { retentionDays: 30 },
        }),
      )

      const report = await purgeWith(30)()

      expect(report.purged).toEqual([WEDDING])
    })

    it('still never purges an event with no client that is kept for ever, whatever the notice', async () => {
      events.seed(anEvent({ id: GALA, slug: 'gala', joinCode: 'Z3N9PT', status: 'closed' }))

      const report = await purgeWith(1)()

      expect(report).toEqual({ purged: [], failed: [] })
    })
  })
})
