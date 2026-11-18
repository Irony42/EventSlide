import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { AT, aGuestbookEntry, aVoiceEntry, atPlus } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClock } from '../../testing/fakeClock'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from '../../testing/fakeGuestbookVoiceRepository'
import {
  makeReapStaleVoiceReservations,
  type ReapStaleVoiceReservations,
} from './reapStaleVoiceReservations'

/**
 * The reaper of the voices that will never be heard (spec 25, rule 2). A reservation is the row a
 * request writes before its bytes, so one that outlives its window belonged to a request that died
 * between `admitVoice` and `media.put`: it holds a quota charge, one of the guest's three places
 * and the unique index. A failed voice is kept a day, only to tell its guest.
 */

const EVENT = asEventId('event-1')
const LEA = asGuestId('guest-1')
const FIVE_MINUTES = 5 * 60_000
const DAY = 24 * 3_600_000

describe('reapStaleVoiceReservations', () => {
  let guestbook: FakeGuestbookRepository
  let voices: FakeGuestbookVoiceRepository
  let clock: FakeClock
  let logger: CapturingLogger
  let reap: ReapStaleVoiceReservations

  beforeEach(() => {
    guestbook = new FakeGuestbookRepository()
    voices = new FakeGuestbookVoiceRepository(guestbook)
    clock = new FakeClock(AT)
    logger = new CapturingLogger()
    reap = makeReapStaleVoiceReservations({
      voices,
      clock,
      logger,
      policy: { reservationTimeoutMs: FIVE_MINUTES, failedRetentionMs: DAY },
    })
  })

  const ids = (): string[] => guestbook.all(EVENT).map((row) => row.id)

  describe('a reservation whose request died before its bytes were written', () => {
    it('deletes the entry and its voice, and frees the guest’s place', async () => {
      guestbook.seed(aVoiceEntry({ id: 'v1', state: 'reserved' }))
      clock.set(atPlus(FIVE_MINUTES))

      const report = await reap()

      expect(report).toEqual({ reserved: 1, failed: 0 })
      expect(ids()).toEqual([])
      expect(await guestbook.countByGuest(EVENT, LEA)).toBe(0)
    })

    it('frees the digest the reservation held, so the guest’s own retry is not turned away', async () => {
      const dead = aVoiceEntry({ id: 'v1', state: 'reserved', sourceHash: 'a'.repeat(64) })
      guestbook.seed(dead)
      clock.set(atPlus(FIVE_MINUTES))
      const hash = dead.voice?.sourceHash
      if (hash === undefined) throw new Error('fixture')
      expect((await voices.findBySourceHash(EVENT, hash))?.id).toBe('v1')

      await reap()

      expect(await voices.findBySourceHash(EVENT, hash)).toBeNull()
    })

    it('frees the quota the reservation was charged', async () => {
      guestbook.seed(aVoiceEntry({ id: 'v1', state: 'reserved', sourceByteSize: 900 }))
      expect(await voices.voiceBytes(EVENT)).toBe(900)
      clock.set(atPlus(FIVE_MINUTES))

      await reap()

      expect(await voices.voiceBytes(EVENT)).toBe(0)
    })

    it('spares a reservation inside its window: its request may still be writing', async () => {
      guestbook.seed(aVoiceEntry({ id: 'v1', state: 'reserved' }))
      clock.set(atPlus(FIVE_MINUTES - 1))

      expect(await reap()).toEqual({ reserved: 0, failed: 0 })
      expect(ids()).toEqual(['v1'])
    })

    it('takes a reservation exactly at the end of its window', async () => {
      guestbook.seed(aVoiceEntry({ id: 'v1', state: 'reserved' }))
      clock.set(atPlus(FIVE_MINUTES))

      expect((await reap()).reserved).toBe(1)
    })

    it('says so in the log, once, with the entries that went', async () => {
      guestbook.seed(aVoiceEntry({ id: 'v1', state: 'reserved' }))
      guestbook.seed(aVoiceEntry({ id: 'v2', state: 'reserved', sourceHash: 'b'.repeat(64) }))
      clock.set(atPlus(FIVE_MINUTES))

      await reap()

      expect(logger.lines).toHaveLength(1)
      expect(logger.lines[0]?.context).toMatchObject({ reaped: 2, entryIds: 'v1 v2' })
    })

    it('says nothing on a healthy box, where there is nothing to reap', async () => {
      await reap()

      expect(logger.lines).toEqual([])
    })
  })

  describe('what is not a stale reservation', () => {
    it('never touches a voice that is queued, running or ready, however old', async () => {
      for (const state of ['queued', 'running', 'ready'] as const) {
        guestbook.seed(
          aVoiceEntry({
            id: state,
            state,
            sourceHash: state.charCodeAt(0).toString(16).padStart(64, '0'),
          }),
        )
      }
      clock.set(atPlus(10 * DAY))

      const report = await reap()

      expect(report.reserved).toBe(0)
      expect(ids().sort()).toEqual(['queued', 'ready', 'running'])
    })

    it('never touches a written message', async () => {
      guestbook.seed(aGuestbookEntry({ id: 'w1', eventId: 'event-1', guestId: 'guest-1' }))
      clock.set(atPlus(10 * DAY))

      await reap()

      expect(ids()).toEqual(['w1'])
    })
  })

  describe('a failed voice', () => {
    it('is deleted once it is a day old, its guest having had the day to be told', async () => {
      guestbook.seed(aVoiceEntry({ id: 'v1', state: 'failed', finishedAt: AT }))
      clock.set(atPlus(DAY))

      const report = await reap()

      expect(report).toEqual({ reserved: 0, failed: 1 })
      expect(ids()).toEqual([])
    })

    it('is kept until then, because it is the only way the guest learns it did not save', async () => {
      guestbook.seed(aVoiceEntry({ id: 'v1', state: 'failed', finishedAt: AT }))
      clock.set(atPlus(DAY - 1))

      expect((await reap()).failed).toBe(0)
      expect(ids()).toEqual(['v1'])
    })

    it('counts the day from the failure, not from the arrival', async () => {
      guestbook.seed(
        aVoiceEntry({ id: 'v1', state: 'failed', createdAt: AT, finishedAt: atPlus(2 * DAY) }),
      )
      clock.set(atPlus(2 * DAY + DAY - 1))

      expect((await reap()).failed).toBe(0)
    })
  })
})
