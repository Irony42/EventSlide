import { beforeEach, describe, expect, it } from 'vitest'
import { STAGED_SOURCE } from '../../../domain/photos/mediaVariant'
import { asEventId, asGuestbookEntryId } from '../../../domain/shared/ids'
import { AT, aVoiceEntry } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClock } from '../../testing/fakeClock'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from '../../testing/fakeGuestbookVoiceRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { makeRecoverVoiceJobs, type RecoverVoiceJobs } from './recoverVoiceJobs'

/**
 * Crash recovery for the voice queue. A voice left `running` by a process that died is invisible
 * to everything until something puts it back, and the guest watches "En traitement" all evening.
 */

const EVENT = asEventId('event-1')

describe('recoverVoiceJobs', () => {
  let guestbook: FakeGuestbookRepository
  let voices: FakeGuestbookVoiceRepository
  let clock: FakeClock
  let logger: CapturingLogger
  let recover: RecoverVoiceJobs

  beforeEach(() => {
    guestbook = new FakeGuestbookRepository()
    voices = new FakeGuestbookVoiceRepository(guestbook)
    clock = new FakeClock(AT)
    logger = new CapturingLogger()
    recover = makeRecoverVoiceJobs({ voices, clock, logger })
  })

  const stateOf = async (id: string) =>
    (await voices.findByEntry(EVENT, asGuestbookEntryId(id)))?.voice?.state

  it('puts a voice a dead process was running back on the queue, claimable at once', async () => {
    guestbook.put(aVoiceEntry({ id: 'v1', eventId: 'event-1', state: 'running', attempts: 1 }))

    const report = await recover()

    expect(report).toEqual({ requeued: 1, abandoned: 0 })
    expect(await stateOf('v1')).toBe('queued')
    // No backoff: the guest has waited once already.
    expect((await voices.claimNext(clock.now()))?.id).toBe('v1')
  })

  it('gives up on a voice that has spent its attempts rather than hand it to the next boot', async () => {
    guestbook.put(aVoiceEntry({ id: 'v1', eventId: 'event-1', state: 'running', attempts: 3 }))

    const report = await recover()

    expect(report).toEqual({ requeued: 0, abandoned: 1 })
    const voice = (await voices.findByEntry(EVENT, asGuestbookEntryId('v1')))?.voice
    expect(voice?.state).toBe('failed')
    expect(voice?.failure).toBe('transcodeFailed')
  })

  it('leaves the abandoned voice’s source on the disk: only the sweep, which asks the database, may take it', async () => {
    const entry = aVoiceEntry({ id: 'v1', eventId: 'event-1', state: 'running', attempts: 3 })
    const media = new InMemoryMediaStore()
    const sourceHash = entry.voice?.sourceHash
    if (sourceHash === undefined) throw new Error('fixture')
    await media.put(EVENT, sourceHash, STAGED_SOURCE, new Uint8Array([1, 2, 3]))
    guestbook.put(entry)

    await recover()

    expect(await media.exists(EVENT, sourceHash, STAGED_SOURCE)).toBe(true)
  })

  it('touches nothing that is not running: queued, ready and failed voices are left as they were', async () => {
    guestbook.put(aVoiceEntry({ id: 'v1', eventId: 'event-1', state: 'queued' }))
    guestbook.put(aVoiceEntry({ id: 'v2', eventId: 'event-1', state: 'ready', guestId: 'g2' }))
    guestbook.put(aVoiceEntry({ id: 'v3', eventId: 'event-1', state: 'failed', guestId: 'g3' }))

    const report = await recover()

    expect(report).toEqual({ requeued: 0, abandoned: 0 })
    expect([await stateOf('v1'), await stateOf('v2'), await stateOf('v3')]).toEqual([
      'queued',
      'ready',
      'failed',
    ])
  })

  it('recovers across every event on the box: there is one worker and one queue', async () => {
    guestbook.put(aVoiceEntry({ id: 'v1', eventId: 'event-1', state: 'running', attempts: 1 }))
    guestbook.put(aVoiceEntry({ id: 'v2', eventId: 'event-2', state: 'running', attempts: 2 }))

    expect(await recover()).toEqual({ requeued: 2, abandoned: 0 })
  })

  it('says so in the log only when it found something, and how many of each', async () => {
    await recover()
    expect(logger.lines).toEqual([])

    guestbook.put(aVoiceEntry({ id: 'v1', eventId: 'event-1', state: 'running', attempts: 1 }))
    guestbook.put(
      aVoiceEntry({ id: 'v2', eventId: 'event-1', state: 'running', attempts: 3, guestId: 'g2' }),
    )
    await recover()

    expect(logger.lines).toHaveLength(1)
    expect(logger.lines[0]).toMatchObject({ level: 'info', context: { requeued: 1, abandoned: 1 } })
  })
})
