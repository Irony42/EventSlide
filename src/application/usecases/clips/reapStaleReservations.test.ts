import { beforeEach, describe, expect, it } from 'vitest'
import { asClipJobId, asEventId } from '../../../domain/shared/ids'
import type { LogContext, Logger } from '../../ports/logger'
import { AT, aClipJob, atPlus } from '../../testing/builders'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { makeReapStaleReservations, type ReapStaleReservations } from './reapStaleReservations'

/**
 * The wreckage of a request that died between "this upload is admitted" and "its bytes
 * are on the disk".
 *
 * A `reserved` row left behind is not inert. It charges its event up to `MAX_CLIP_BYTES`
 * for bytes that do not exist — and because the quota spans `photos` too, the album's own
 * room shrinks with it. It holds one of `MAX_QUEUED_CLIPS` global slots, so twenty of them
 * answer every clip upload on the box with a `429`. And it holds that digest through the
 * partial unique index, so the guest's own retry is deduped onto a job that will never
 * move. All of that lasts until something reaps it.
 */

const EVENT = asEventId('event-1')

/** What the container gives it: generous against the single `writeFile` it protects. */
const TIMEOUT_MS = 5 * 60 * 1000

class CapturingLogger implements Logger {
  readonly lines: { level: string; message: string }[] = []

  debug(message: string): void {
    this.lines.push({ level: 'debug', message })
  }

  info(message: string): void {
    this.lines.push({ level: 'info', message })
  }

  warn(message: string): void {
    this.lines.push({ level: 'warn', message })
  }

  error(message: string): void {
    this.lines.push({ level: 'error', message })
  }

  child(_bindings: LogContext): Logger {
    return this
  }
}

describe('reapStaleReservations', () => {
  let clips: FakeClipJobRepository
  let media: InMemoryMediaStore
  let clock: FakeClock
  let logger: CapturingLogger
  let reap: ReapStaleReservations

  beforeEach(() => {
    clips = new FakeClipJobRepository()
    media = new InMemoryMediaStore()
    clock = new FakeClock(AT)
    logger = new CapturingLogger()
    reap = makeReapStaleReservations({
      clips,
      clock,
      logger,
      policy: { reservationTimeoutMs: TIMEOUT_MS },
    })
  })

  /** A reservation and the bytes that had begun to land under it. */
  const reserve = async (createdAt: Date): Promise<ReturnType<typeof aClipJob>> => {
    const job = aClipJob({ id: 'job-1', eventId: 'event-1', status: 'reserved', createdAt })
    await media.put(job.eventId, job.sourceHash, 'source', Uint8Array.of(1, 2, 3))
    clips.seed(job)
    return job
  }

  it('reaps a reservation that has outlived its window', async () => {
    const job = await reserve(AT)
    clock.set(atPlus(TIMEOUT_MS + 1))

    const report = await reap()

    expect(report.reaped).toBe(1)
    expect(await clips.findById(EVENT, asClipJobId('job-1'))).toBeNull()
    expect(job.status).toBe('reserved')
  })

  it('reaps one that is minutes old, not only one that is hours old', async () => {
    // **The untested middle, and the shape the defect lived in.** A reservation stranded
    // by an OOM kill is seconds old when the container comes back, and the only tests
    // this rule had aged by an hour and by half a second — so "reaped eventually" was
    // never distinguished from "reaped at the next restart".
    await reserve(AT)
    clock.set(atPlus(6 * 60 * 1000))

    expect((await reap()).reaped).toBe(1)
  })

  it('leaves one still inside its window alone', async () => {
    // The case the window exists for: a `--force-recreate` overlapping two containers,
    // where the old one is still writing the bytes this row is waiting for.
    await reserve(AT)
    clock.set(atPlus(TIMEOUT_MS - 1))

    expect((await reap()).reaped).toBe(0)
    expect(await clips.findById(EVENT, asClipJobId('job-1'))).not.toBeNull()
  })

  it('never touches a job that is not a reservation', async () => {
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'queued', createdAt: AT }))
    clock.set(atPlus(TIMEOUT_MS * 10))

    expect((await reap()).reaped).toBe(0)
    expect(await clips.findById(EVENT, asClipJobId('job-1'))).not.toBeNull()
  })

  it('is built with no media store at all, so it cannot unlink anything', async () => {
    // **This pins the signature, not a behaviour.** `ReapStaleReservationsDeps` has no
    // `MediaStore`, which is the whole guarantee: the row goes inside a transaction, so
    // any unlink would necessarily follow the commit — and by then the digest is free and
    // a re-upload may have reserved it, so the unlink would take *its* source. Not having
    // the port is a stronger statement than remembering not to call it, and TypeScript
    // enforces it at every call site.
    //
    // The assertion below is therefore a demonstration rather than a guard; the guard is
    // the type. `sweepOrphanedMedia` is what collects these bytes, and its own suite is
    // where that is tested.
    const job = await reserve(AT)
    clock.set(atPlus(TIMEOUT_MS + 1))

    await reap()

    expect(await media.exists(EVENT, job.sourceHash, 'source')).toBe(true)
  })

  it('says nothing when there is nothing to reap', async () => {
    // A healthy box reaps nothing for ever, and this runs on a short interval.
    expect((await reap()).reaped).toBe(0)
    expect(logger.lines).toEqual([])
  })

  it('records a reap, because one means a request died mid-upload', async () => {
    await reserve(AT)
    clock.set(atPlus(TIMEOUT_MS + 1))

    await reap()

    expect(logger.lines.map((line) => line.level)).toEqual(['info'])
  })
})
