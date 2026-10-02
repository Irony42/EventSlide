import { beforeEach, describe, expect, it } from 'vitest'
import type { EventId } from '../../../domain/shared/ids'
import { asEventId } from '../../../domain/shared/ids'
import type { MediaMetadata, MediaStore, StoredObject } from '../../ports/mediaStore'
import { AT, aClient, anEvent, atPlus } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { makePurgeExpiredEvents, type PurgeExpiredEvents } from './purgeExpiredEvents'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const DAY = 86_400_000
/** A month and a day after both events closed: the 30-day deadline has gone by. */
const SWEEP_AT = atPlus(31 * DAY)

const notPartOfASweep = (method: string): never => {
  throw new Error(`MediaStore.${method} is not part of a retention sweep`)
}

/**
 * A media store that records the event purges asked of it and can be told which ones
 * fail. Everything else on the port throws, so a sweep that started reading bytes would
 * fail loudly rather than pass against a permissive stub.
 */
class RecordingMediaStore implements MediaStore {
  readonly purged: EventId[] = []

  constructor(private readonly failing: readonly EventId[] = []) {}

  async deleteEvent(eventId: EventId): Promise<void> {
    if (this.failing.includes(eventId)) throw new Error('media root is read-only')
    this.purged.push(eventId)
  }

  put = async (): Promise<void> => notPartOfASweep('put')
  exists = async (): Promise<boolean> => notPartOfASweep('exists')
  stat = async (): Promise<MediaMetadata | null> => notPartOfASweep('stat')
  openRead = async (): Promise<AsyncIterable<Uint8Array> | null> => notPartOfASweep('openRead')
  read = async (): Promise<Uint8Array | null> => notPartOfASweep('read')
  delete = async (): Promise<void> => notPartOfASweep('delete')
  usedBytes = async (): Promise<number> => notPartOfASweep('usedBytes')
  listEvents = async (): Promise<readonly EventId[]> => notPartOfASweep('listEvents')
  list = async (): Promise<readonly StoredObject[]> => notPartOfASweep('list')
}

describe('purgeExpiredEvents', () => {
  let events: FakeEventRepository
  let media: RecordingMediaStore
  let clock: FakeClock
  let purgeExpiredEvents: PurgeExpiredEvents

  beforeEach(() => {
    events = new FakeEventRepository()
    media = new RecordingMediaStore()
    clock = new FakeClock(SWEEP_AT)
    purgeExpiredEvents = makePurgeExpiredEvents({ events, media, clock, capNoticeDays: 30 })
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

    expect(media.purged).toEqual([WEDDING])
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

    expect(media.purged).toEqual([])
  })

  // ------------------------------------------------------- one bad disk, forty events --

  describe('when one event cannot be purged', () => {
    beforeEach(() => {
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
      media = new RecordingMediaStore([GALA])
      purgeExpiredEvents = makePurgeExpiredEvents({ events, media, clock, capNoticeDays: 30 })
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
      makePurgeExpiredEvents({ events, media, clock, capNoticeDays })

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
      expect(media.purged).toEqual([WEDDING])
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
