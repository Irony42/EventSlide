import { beforeEach, describe, expect, it } from 'vitest'
import type { Event } from '../../../domain/events/event'
import { asEventId, type EventId } from '../../../domain/shared/ids'
import { anEvent, atPlus, type EventInput } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeApplyEventSchedules, type ApplyEventSchedules } from './applyEventSchedules'

/**
 * Ring 2: the sweep that opens and closes events on their own.
 *
 * Everything here is driven by moving `FakeClock`, which is the whole reason this is a
 * ring-2 test and not a ring-6 journey: "the server was down when 18:00 went past" is
 * one `clock.set(...)` here and an unwritable scenario against a real timer.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const HOUR = 3_600_000
/** The doors were supposed to open an hour after the fixture instant. */
const OPEN_AT = atPlus(HOUR)
/** And close eight hours after that. */
const CLOSE_AT = atPlus(9 * HOUR)
/** The sweep that should have run at the opening instant, seven minutes late. */
const SEVEN_MINUTES_LATE = atPlus(HOUR + 7 * 60_000)

/** A repository whose `save` fails for named events, as a locked database would. */
class FlakyEventRepository extends FakeEventRepository {
  constructor(private readonly failing: readonly EventId[] = []) {
    super()
  }

  override async save(event: Event): Promise<void> {
    if (this.failing.includes(event.id)) throw new Error('database is locked')
    await super.save(event)
  }
}

describe('applyEventSchedules', () => {
  let events: FakeEventRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let applyEventSchedules: ApplyEventSchedules

  const wire = (repository: FakeEventRepository): void => {
    events = repository
    applyEventSchedules = makeApplyEventSchedules({ events, bus, clock })
  }

  beforeEach(() => {
    bus = new RecordingEventBus()
    clock = new FakeClock(OPEN_AT)
    wire(new FakeEventRepository())
  })

  const seedWedding = (overrides: EventInput = {}): void => {
    events.seed(
      anEvent({
        id: WEDDING,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        status: 'draft',
        scheduledOpenAt: OPEN_AT,
        scheduledCloseAt: CLOSE_AT,
        ...overrides,
      }),
    )
  }

  const stored = async (id: EventId): Promise<Event> => {
    const event = await events.findById(id)
    if (event === null) throw new Error(`${id} is not in the repository`)
    return event
  }

  // ---------------------------------------------------------------- opening --

  it('opens an event whose opening instant has arrived', async () => {
    seedWedding()

    const report = await applyEventSchedules()

    expect(report.opened).toEqual([WEDDING])
    expect((await stored(WEDDING)).status).toBe('live')
  })

  it('opens an event whose opening was missed while the server was down', async () => {
    // The failure this feature exists to remove: nobody was listening at 18:00. The
    // next sweep must open the party, not wait for an instant that has gone.
    seedWedding()
    clock.set(SEVEN_MINUTES_LATE)

    const report = await applyEventSchedules()

    expect(report.opened).toEqual([WEDDING])
    expect((await stored(WEDDING)).status).toBe('live')
  })

  it('tells the room an event has opened, so an unattended projector notices', async () => {
    seedWedding()

    await applyEventSchedules()

    expect(bus.published).toEqual([
      { type: 'event.statusChanged', eventId: WEDDING, status: 'live' },
    ])
  })

  it('leaves an event alone while its opening instant is still ahead', async () => {
    seedWedding()
    clock.set(atPlus(0))

    const report = await applyEventSchedules()

    expect(report).toEqual({ opened: [], closed: [], refused: [], failed: [] })
    expect((await stored(WEDDING)).status).toBe('draft')
    expect(bus.published).toEqual([])
  })

  // ---------------------------------------------------------------- closing --

  it('closes an event whose closing instant has arrived', async () => {
    seedWedding({ status: 'live', scheduledOpenAt: null })
    clock.set(CLOSE_AT)

    const report = await applyEventSchedules()

    expect(report.closed).toEqual([WEDDING])
    expect((await stored(WEDDING)).status).toBe('closed')
  })

  it('closes without touching the album, so retention is the only thing that deletes', async () => {
    // Closing is not deleting. The photos stay, the wall keeps playing, and the
    // retention clock — which this sweep does start — is what eventually removes them.
    seedWedding({ status: 'live', scheduledOpenAt: null, settings: { retentionDays: 30 } })
    clock.set(CLOSE_AT)

    await applyEventSchedules()

    const event = await stored(WEDDING)
    expect(event.closedAt).toEqual(CLOSE_AT)
    expect(event.servesWall()).toBe(true)
  })

  it('catches up on a whole evening in one pass and leaves the event closed', async () => {
    seedWedding()
    clock.set(atPlus(12 * HOUR))

    const report = await applyEventSchedules()

    expect(report.opened).toEqual([WEDDING])
    expect(report.closed).toEqual([WEDDING])
    expect((await stored(WEDDING)).status).toBe('closed')
    expect(bus.published).toEqual([
      { type: 'event.statusChanged', eventId: WEDDING, status: 'live' },
      { type: 'event.statusChanged', eventId: WEDDING, status: 'closed' },
    ])
  })

  // ----------------------------------------------------------- the lifecycle --

  it('does not reopen an archived event because a timestamp passed', async () => {
    seedWedding({ status: 'archived', scheduledCloseAt: null })

    const report = await applyEventSchedules()

    expect(report.opened).toEqual([])
    expect(report.refused).toEqual([WEDDING])
    expect((await stored(WEDDING)).status).toBe('archived')
    expect(bus.published).toEqual([])
  })

  it('discards a schedule the lifecycle refused instead of retrying it every few minutes', async () => {
    seedWedding({ status: 'archived', scheduledCloseAt: null })

    await applyEventSchedules()

    expect((await stored(WEDDING)).scheduledOpenAt).toBeNull()
    expect(await events.listDueForSchedule(clock.now())).toEqual([])
  })

  it('leaves the host a record that their schedule was thrown away', async () => {
    // The sweep runs while nobody is watching. Without this the settings page reads
    // back "no schedule" and the host has no way to know theirs was ever there.
    seedWedding({ status: 'archived', scheduledCloseAt: null })

    await applyEventSchedules()

    expect((await stored(WEDDING)).scheduleDiscardedAt).toEqual(OPEN_AT)
  })

  it('leaves no such record when every due instant was honoured', async () => {
    seedWedding()

    await applyEventSchedules()

    expect((await stored(WEDDING)).scheduleDiscardedAt).toBeNull()
  })

  // -------------------------------------------------------------- idempotence --

  it('changes nothing the second time it runs', async () => {
    seedWedding()
    await applyEventSchedules()
    const afterFirst = (await stored(WEDDING)).toProps()
    const publishedAfterFirst = [...bus.published]

    const report = await applyEventSchedules()

    expect(report).toEqual({ opened: [], closed: [], refused: [], failed: [] })
    expect((await stored(WEDDING)).toProps()).toEqual(afterFirst)
    expect(bus.published).toEqual(publishedAfterFirst)
  })

  // ------------------------------------------------------------------ failure --

  it('reports an event it could not write and leaves its schedule to the next run', async () => {
    wire(new FlakyEventRepository([WEDDING]))
    seedWedding()

    const report = await applyEventSchedules()

    expect(report.failed).toEqual([WEDDING])
    expect(report.opened).toEqual([])
    // Nothing announced for a transition that was not stored: a projector told the
    // event is live would refetch and find it shut.
    expect(bus.published).toEqual([])
    expect((await stored(WEDDING)).scheduledOpenAt).toEqual(OPEN_AT)
  })

  it('keeps sweeping the other events after one fails', async () => {
    wire(new FlakyEventRepository([WEDDING]))
    seedWedding()
    events.seed(
      anEvent({
        id: GALA,
        slug: 'gala-annuel',
        joinCode: 'Z3N9PT',
        status: 'draft',
        scheduledOpenAt: OPEN_AT,
      }),
    )

    const report = await applyEventSchedules()

    expect(report.failed).toEqual([WEDDING])
    expect(report.opened).toEqual([GALA])
  })

  it('does nothing at all when no event has a schedule', async () => {
    events.seed(anEvent({ id: WEDDING, status: 'live' }))

    const report = await applyEventSchedules()

    expect(report).toEqual({ opened: [], closed: [], refused: [], failed: [] })
  })
})
