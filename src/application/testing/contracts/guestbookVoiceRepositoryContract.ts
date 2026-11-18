import { beforeEach, describe, expect, it } from 'vitest'
import { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import { GuestbookVoice } from '../../../domain/guestbook/guestbookVoice'
import { MAX_VOICE_PER_EVENT } from '../../../domain/guestbook/guestbookVoiceLimits'
import { ContentHash } from '../../../domain/photos/contentHash'
import { asEventId, asGuestId, asGuestbookEntryId } from '../../../domain/shared/ids'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type {
  GuestbookVoiceRepository,
  VoiceAdmissionLimits,
} from '../../ports/guestbookVoiceRepository'
import { aGuestbookEntry, aVoiceEntry } from '../builders'
import { crowdGuestId } from './guestbookRepositoryContract'

/**
 * The behaviour every `GuestbookVoiceRepository` must have, run against the fake **and** SQLite
 * (spec 25).
 *
 * The two decide the same things in different code: an array filter with no `await` between the
 * counts and the write, and one `.immediate()` transaction over a dozen statements. A fake that
 * counted a failed voice toward the guest's three, or forgot that a reservation holds the unique
 * index, would make every ring-2 test about voices prove the opposite of what production does.
 *
 * The subject carries **the guestbook's own port too**, because a voice message is an entry of
 * that book: the rows are shared, and half of what must hold is how the book's reads and counts
 * treat a recording (a failed one is out of every count and every list but its author's).
 */

export interface GuestbookVoiceSubject {
  readonly voices: GuestbookVoiceRepository
  /** The sibling port over the same rows. */
  readonly guestbook: GuestbookRepository
  /** What the operator's route will do through the port later: set `taken_down_at`. */
  readonly takeDown: (eventId: string, entryId: string, at: Date) => void
  /** Make the event hold this many bytes of photographs, which the quota counts. */
  readonly chargePhotoBytes: (eventId: string, bytes: number) => Promise<void>
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const LEA = asGuestId('guest-lea')
const SAM = asGuestId('guest-sam')
const entryId = (raw: string) => asGuestbookEntryId(raw)

const at = (seconds: number): Date => new Date(Date.UTC(2026, 5, 20, 21, 0, seconds))

/** Roomy on every ceiling, so a case names the one it is about. */
const ROOMY: VoiceAdmissionLimits = {
  quotaBytes: 1_000_000_000,
  maxQueuedVoices: 1_000,
  maxQueuedVoicesPerEvent: 1_000,
}

const reservation = (input: Parameters<typeof aVoiceEntry>[0] = {}): GuestbookEntry =>
  aVoiceEntry({ state: 'reserved', eventId: 'evt-wedding', guestId: 'guest-lea', ...input })

/** A sha-256 digest from one hex character, so a case reads `digest('a')` and means a recording. */
const digest = (seed: string): string => seed.repeat(64).slice(0, 64)

export const guestbookVoiceRepositoryContract = (
  name: string,
  makeSubject: () => Promise<GuestbookVoiceSubject>,
): void => {
  describe(`GuestbookVoiceRepository contract: ${name}`, () => {
    let subject: GuestbookVoiceSubject
    let voices: GuestbookVoiceRepository
    let book: GuestbookRepository

    beforeEach(async () => {
      if (subject?.dispose !== undefined) await subject.dispose()
      subject = await makeSubject()
      voices = subject.voices
      book = subject.guestbook
    })

    const admit = (entry: GuestbookEntry, limits: VoiceAdmissionLimits = ROOMY) =>
      voices.admitVoice(entry, limits)

    /** A voice that went all the way: reserved, queued, claimed, then `ready` or failed for good. */
    const finish = async (
      entry: GuestbookEntry,
      outcome: 'ready' | { readonly fail: string },
      clock = 10,
    ): Promise<void> => {
      const voice = entry.voice
      if (voice === null) throw new Error('fixture')
      const queued = voice.queue(at(clock))
      await voices.saveVoice(entry.eventId, entry.id, queued)
      const claimed = await voices.claimNext(at(clock + 1))
      if (claimed === null || claimed.voice === null || claimed.id !== entry.id) {
        throw new Error('the voice that was just queued was not the one claimed')
      }
      const settled =
        outcome === 'ready'
          ? claimed.voice.finish(
              {
                hash: must(ContentHash.create(digest('d'))),
                byteSize: 1_000,
                durationMs: 5_000,
              },
              at(clock + 2),
            )
          : claimed.voice.fail(outcome.fail, at(clock + 2))
      if (!settled.ok) throw new Error(settled.error.code)
      await voices.saveVoice(entry.eventId, entry.id, settled.value)
    }

    // ------------------------------------------------------------- admission --

    it('stores a voice message as a reservation: an entry with a recording and no text', async () => {
      const admission = await admit(reservation({ id: 'v1', caption: 'Pour Camille' }))

      expect(admission.kind).toBe('added')
      const found = await voices.findByEntry(WEDDING, entryId('v1'))
      expect(found?.text).toBeNull()
      expect(found?.voice?.state).toBe('reserved')
      expect(found?.voice?.caption?.value).toBe('Pour Camille')
      expect(found?.voice?.sourceByteSize).toBe(300_000)
      expect(found?.status).toBe('pending')
    })

    it('reads a voice with no caption back as no caption, not as an empty one', async () => {
      await admit(reservation({ id: 'v1' }))

      expect((await voices.findByEntry(WEDDING, entryId('v1')))?.voice?.caption).toBeNull()
    })

    it('is the same row the guestbook reads: one entry, found through both ports', async () => {
      await admit(reservation({ id: 'v1', caption: 'Bravo' }))

      const viaBook = await book.findById(WEDDING, entryId('v1'))

      expect(viaBook?.text).toBeNull()
      expect(viaBook?.voice?.caption?.value).toBe('Bravo')
    })

    it('keeps the moderation of the event: published on arrival in auto, pending otherwise', async () => {
      await admit(reservation({ id: 'v1', moderation: 'auto' }))
      await admit(reservation({ id: 'v2', moderation: 'manual' }))

      expect((await voices.findByEntry(WEDDING, entryId('v1')))?.status).toBe('published')
      expect((await voices.findByEntry(WEDDING, entryId('v2')))?.review).toBeNull()
    })

    it('refuses to be handed a written message', async () => {
      await expect(
        admit(aGuestbookEntry({ id: 'w1', eventId: 'evt-wedding', guestId: 'guest-lea' })),
      ).rejects.toThrow()
    })

    // -------------------------------------------------------- tenant isolation --

    it('finds a voice by entry and event, and not through another event', async () => {
      await admit(reservation({ id: 'v1' }))

      expect((await voices.findByEntry(WEDDING, entryId('v1')))?.id).toBe('v1')
      expect(await voices.findByEntry(GALA, entryId('v1'))).toBeNull()
    })

    it('does not find a written message as a voice', async () => {
      await book.admit(aGuestbookEntry({ id: 'w1', eventId: 'evt-wedding', guestId: 'guest-lea' }))

      expect(await voices.findByEntry(WEDDING, entryId('w1'))).toBeNull()
    })

    it('does not list, count or name another event’s voices', async () => {
      await admit(reservation({ id: 'v1' }))

      expect(await voices.listByGuest(GALA, LEA)).toEqual([])
      expect(await voices.countOpenByEvent(GALA)).toBe(0)
      expect(await voices.voiceBytes(GALA)).toBe(0)
      expect([...(await voices.listReferencedDigests(GALA))]).toEqual([])
    })

    it('does not delete another event’s voice by entry id', async () => {
      await admit(reservation({ id: 'v1' }))

      await voices.deleteByEntry(GALA, entryId('v1'))

      expect(await voices.findByEntry(WEDDING, entryId('v1'))).not.toBeNull()
    })

    it('finds the voice already held for these bytes in this event only', async () => {
      const first = reservation({ id: 'v1', sourceHash: digest('a') })
      await admit(first)
      const hash = first.voice?.sourceHash
      if (hash === undefined) throw new Error('fixture')

      expect((await voices.findBySourceHash(WEDDING, hash))?.id).toBe('v1')
      expect(await voices.findBySourceHash(GALA, hash)).toBeNull()
    })

    // ------------------------------------------------------------- idempotency --

    it('answers the same bytes again with the first message and stores nothing new', async () => {
      await admit(reservation({ id: 'v1', sourceHash: digest('a') }))

      const again = await admit(reservation({ id: 'v2', sourceHash: digest('a') }))

      expect(again.kind).toBe('duplicate')
      expect(again.kind === 'duplicate' && again.entry.id).toBe('v1')
      expect(await voices.findByEntry(WEDDING, entryId('v2'))).toBeNull()
      expect(await book.countByGuest(WEDDING, LEA)).toBe(1)
    })

    it('answers a duplicate before the ceilings: a guest at their limit who retries is told “sent”', async () => {
      await admit(reservation({ id: 'v1', sourceHash: digest('a') }))
      await admit(reservation({ id: 'v2', sourceHash: digest('b') }))
      await admit(reservation({ id: 'v3', sourceHash: digest('c') }))

      const retry = await admit(reservation({ id: 'v4', sourceHash: digest('a') }))

      expect(retry.kind).toBe('duplicate')
    })

    it('lets two events each hold the same recording', async () => {
      await admit(reservation({ id: 'v1', sourceHash: digest('a') }))

      const other = await admit(
        reservation({
          id: 'v2',
          eventId: 'evt-gala',
          guestId: 'guest-lea',
          sourceHash: digest('a'),
        }),
      )

      expect(other.kind).toBe('added')
    })

    it('lets a guest send again the recording a failed attempt could not save', async () => {
      const first = reservation({ id: 'v1', sourceHash: digest('a') })
      await admit(first)
      await finish(first, { fail: 'voice.corrupt' })

      const again = await admit(reservation({ id: 'v2', sourceHash: digest('a') }))

      expect(again.kind).toBe('added')
    })

    it('does not take a text with the same words as a voice caption for the same message', async () => {
      await admit(reservation({ id: 'v1', caption: 'Bravo' }))

      const text = await book.admit(
        aGuestbookEntry({
          id: 'w1',
          eventId: 'evt-wedding',
          guestId: 'guest-lea',
          text: 'Bravo',
          createdAt: at(1),
        }),
      )

      expect(text.kind).toBe('added')
    })

    // ----------------------------------------------------------------- ceilings --

    it('refuses the fourth message of a guest, texts and voices together', async () => {
      await book.admit(aGuestbookEntry({ id: 'w1', eventId: 'evt-wedding', guestId: 'guest-lea' }))
      await admit(reservation({ id: 'v1' }))
      await admit(reservation({ id: 'v2' }))

      const refused = await admit(reservation({ id: 'v3' }))

      expect(refused).toEqual({
        kind: 'refused',
        refusal: { reason: 'limit', limit: 'guestLimit' },
      })
    })

    it('does not count a voice that failed: three failures do not close the door on the guest', async () => {
      for (const id of ['v1', 'v2', 'v3']) {
        const entry = reservation({ id, sourceHash: digest(id.slice(1)) })
        await admit(entry)
        await finish(entry, { fail: 'voice.notAudio' }, Number(id.slice(1)) * 10)
      }

      expect(await book.countByGuest(WEDDING, LEA)).toBe(0)
      const fourth = await admit(reservation({ id: 'v4', sourceHash: digest('4') }))
      expect(fourth.kind).toBe('added')
    })

    it('accepts the 200th voice of an event and refuses the 201st', async () => {
      const crowd = Array.from({ length: MAX_VOICE_PER_EVENT }, (_, n) => n)
      for (const n of crowd) {
        const added = await admit(
          reservation({
            id: `v-${n}`,
            guestId: crowdGuestId(Math.floor(n / 3)),
            sourceHash: n.toString(16).padStart(64, '0'),
          }),
        )
        expect(added.kind).toBe('added')
      }

      const refused = await admit(
        reservation({
          id: 'v-over',
          guestId: crowdGuestId(80),
          sourceHash: 'f'.repeat(64),
        }),
      )

      expect(refused).toEqual({ kind: 'refused', refusal: { reason: 'limit', limit: 'voiceFull' } })
    })

    it('does not count the event’s voices against another event', async () => {
      await admit(reservation({ id: 'v1' }))

      expect(await voices.countOpenByEvent(WEDDING)).toBe(1)
      expect(await voices.countOpenByEvent(GALA)).toBe(0)
    })

    it('counts the voices the host can still act on: not refused, not failed, not taken down', async () => {
      const live = reservation({ id: 'v1', sourceHash: digest('1') })
      const refused = reservation({ id: 'v2', sourceHash: digest('2'), guestId: 'guest-sam' })
      const failed = reservation({ id: 'v3', sourceHash: digest('3'), guestId: 'guest-sam' })
      const takenDown = reservation({ id: 'v4', sourceHash: digest('4'), guestId: 'guest-sam' })
      for (const entry of [live, refused, failed, takenDown]) await admit(entry)
      // A refusal of a recording still being processed is not a move the entity makes (nobody can
      // decide on what cannot be heard yet), so the fixture writes the status the count reads.
      await book.save(
        GuestbookEntry.restore({
          ...refused.toProps(),
          status: 'rejected',
          review: { kind: 'automatic', at: at(2) },
        }),
      )
      await finish(failed, { fail: 'voice.corrupt' })
      subject.takeDown('evt-wedding', 'v4', at(3))

      expect(await voices.countOpenByEvent(WEDDING)).toBe(1)
    })

    // ----------------------------------------------------------- backpressure --

    it('refuses with the queue’s depth once this event’s own slots are taken, naming that cap', async () => {
      const limits = { ...ROOMY, maxQueuedVoicesPerEvent: 2 }
      await admit(reservation({ id: 'v1', guestId: 'guest-lea' }), limits)
      await admit(reservation({ id: 'v2', guestId: 'guest-sam' }), limits)

      const refused = await admit(reservation({ id: 'v3', guestId: 'guest-lea' }), limits)

      expect(refused).toEqual({
        kind: 'refused',
        refusal: { reason: 'queueFull', depth: 2, maxDepth: 2 },
      })
    })

    it('refuses on the box-wide depth across events, and reports that depth', async () => {
      const limits = { ...ROOMY, maxQueuedVoices: 2 }
      await admit(reservation({ id: 'v1', eventId: 'evt-gala', guestId: 'guest-lea' }), limits)
      await admit(reservation({ id: 'v2', eventId: 'evt-gala', guestId: 'guest-lea' }), limits)

      const refused = await admit(reservation({ id: 'v3' }), limits)

      expect(refused).toEqual({
        kind: 'refused',
        refusal: { reason: 'queueFull', depth: 2, maxDepth: 2 },
      })
      expect(await voices.queuedCount()).toBe(2)
    })

    it('reports the box-wide depth when an event is at its own cap, because that is the wait', async () => {
      const limits = { ...ROOMY, maxQueuedVoicesPerEvent: 1 }
      await admit(reservation({ id: 'v1', eventId: 'evt-gala', guestId: 'guest-lea' }), limits)
      await admit(reservation({ id: 'v2', eventId: 'evt-gala', guestId: 'guest-lea' }), {
        ...ROOMY,
        maxQueuedVoicesPerEvent: 5,
      })

      const refused = await admit(
        reservation({ id: 'v3', eventId: 'evt-gala', guestId: 'guest-lea' }),
        limits,
      )

      expect(refused).toEqual({
        kind: 'refused',
        refusal: { reason: 'queueFull', depth: 2, maxDepth: 1 },
      })
    })

    it('does not count a ready voice in the queue: it has left it', async () => {
      const limits = { ...ROOMY, maxQueuedVoicesPerEvent: 1 }
      const first = reservation({ id: 'v1' })
      await admit(first, limits)
      await finish(first, 'ready')

      const next = await admit(reservation({ id: 'v2' }), limits)

      expect(next.kind).toBe('added')
      expect(await voices.queuedCount()).toBe(1)
    })

    // ------------------------------------------------------------------ quota --

    it('refuses a recording that does not fit the event’s quota, with what is left', async () => {
      await subject.chargePhotoBytes('evt-wedding', 700)

      const refused = await admit(reservation({ id: 'v1', sourceByteSize: 400 }), {
        ...ROOMY,
        quotaBytes: 1_000,
      })

      expect(refused).toEqual({
        kind: 'refused',
        refusal: { reason: 'quotaExceeded', remaining: 300 },
      })
      expect(await voices.findByEntry(WEDDING, entryId('v1'))).toBeNull()
    })

    it('counts the other voices of the event in the quota: sources while processed, the output once ready', async () => {
      const first = reservation({ id: 'v1', sourceByteSize: 600 })
      await admit(first, { ...ROOMY, quotaBytes: 1_000 })
      expect(await voices.voiceBytes(WEDDING)).toBe(600)

      const refused = await admit(reservation({ id: 'v2', sourceByteSize: 600 }), {
        ...ROOMY,
        quotaBytes: 1_000,
      })
      expect(refused.kind === 'refused' && refused.refusal.reason).toBe('quotaExceeded')

      // Once ready, the 600-byte source is gone and the 1 000-byte output is what is held.
      await finish(first, 'ready')
      expect(await voices.voiceBytes(WEDDING)).toBe(1_000)
    })

    it('charges nothing for a failed voice: its bytes are gone', async () => {
      const first = reservation({ id: 'v1', sourceByteSize: 600 })
      await admit(first)
      await finish(first, { fail: 'voice.corrupt' })

      expect(await voices.voiceBytes(WEDDING)).toBe(0)
    })

    it('judges the quota at the moment of admission against committed state, not a count read before', async () => {
      const limits = { ...ROOMY, quotaBytes: 1_000 }

      const both = await Promise.all([
        admit(reservation({ id: 'v1', sourceByteSize: 600, guestId: 'guest-lea' }), limits),
        admit(reservation({ id: 'v2', sourceByteSize: 600, guestId: 'guest-sam' }), limits),
      ])

      expect(both.map((admission) => admission.kind).sort()).toEqual(['added', 'refused'])
    })

    it('holds the ceilings when two requests overlap: the guest’s fourth message is refused', async () => {
      await admit(reservation({ id: 'v1' }))
      await admit(reservation({ id: 'v2' }))

      const both = await Promise.all([
        admit(reservation({ id: 'v3', sourceHash: digest('3') })),
        admit(reservation({ id: 'v4', sourceHash: digest('4') })),
      ])

      expect(both.map((admission) => admission.kind).sort()).toEqual(['added', 'refused'])
    })

    it('adds the photographs to the event’s holdings', async () => {
      await subject.chargePhotoBytes('evt-wedding', 900)

      const refused = await admit(reservation({ id: 'v1', sourceByteSize: 200 }), {
        ...ROOMY,
        quotaBytes: 1_000,
      })

      expect(refused.kind === 'refused' && refused.refusal.reason).toBe('quotaExceeded')
    })

    // ------------------------------------------------------------ transitions --

    it('saves the state of a voice that exists, and says so', async () => {
      const entry = reservation({ id: 'v1' })
      await admit(entry)
      const queued = entry.voice?.queue(at(5))
      if (queued === undefined) throw new Error('fixture')

      const saved = await voices.saveVoice(WEDDING, entryId('v1'), queued)

      expect(saved).toBe(true)
      expect((await voices.findByEntry(WEDDING, entryId('v1')))?.voice?.state).toBe('queued')
    })

    it('does not resurrect a voice that is gone: saving it answers false and writes nothing', async () => {
      const entry = reservation({ id: 'v1' })
      await admit(entry)
      await voices.deleteByEntry(WEDDING, entryId('v1'))
      const queued = entry.voice?.queue(at(5))
      if (queued === undefined) throw new Error('fixture')

      expect(await voices.saveVoice(WEDDING, entryId('v1'), queued)).toBe(false)
      expect(await voices.findByEntry(WEDDING, entryId('v1'))).toBeNull()
      expect(await book.findById(WEDDING, entryId('v1'))).toBeNull()
    })

    it('does not write another event’s voice by entry id', async () => {
      const entry = reservation({ id: 'v1' })
      await admit(entry)
      const queued = entry.voice?.queue(at(5))
      if (queued === undefined) throw new Error('fixture')

      expect(await voices.saveVoice(GALA, entryId('v1'), queued)).toBe(false)
    })

    it('round-trips every fact of a ready voice: the output, its size and its measured duration', async () => {
      const entry = reservation({ id: 'v1' })
      await admit(entry)
      await finish(entry, 'ready')

      const ready = (await voices.findByEntry(WEDDING, entryId('v1')))?.voice

      expect(ready?.state).toBe('ready')
      expect(ready?.audioHash?.value).toBe(digest('d'))
      expect(ready?.audioByteSize).toBe(1_000)
      expect(ready?.durationMs).toBe(5_000)
      expect(ready?.attempts).toBe(1)
      expect(ready?.finishedAt).toEqual(at(12))
    })

    it('round-trips the reason a voice failed', async () => {
      const entry = reservation({ id: 'v1' })
      await admit(entry)
      await finish(entry, { fail: 'voice.notAudio' })

      const failed = (await voices.findByEntry(WEDDING, entryId('v1')))?.voice

      expect(failed?.state).toBe('failed')
      expect(failed?.failure).toBe('notAudio')
      expect(failed?.audioHash).toBeNull()
    })

    // ------------------------------------------------------------- the result --

    /** A voice claimed by the worker and the `ready` form of it, as `transcodeNextVoice` builds it. */
    const claimedAndFinished = async (
      entry: GuestbookEntry,
      outputBytes: number,
    ): Promise<GuestbookVoice> => {
      const voice = entry.voice
      if (voice === null) throw new Error('fixture')
      await voices.saveVoice(entry.eventId, entry.id, voice.queue(at(10)))
      const claimed = (await voices.claimNext(at(11)))?.voice
      if (claimed === undefined || claimed === null) throw new Error('nothing was claimed')
      const ready = claimed.finish(
        { hash: must(ContentHash.create(digest('e'))), byteSize: outputBytes, durationMs: 4_000 },
        at(12),
      )
      if (!ready.ok) throw new Error(ready.error.code)
      return ready.value
    }

    it('writes the result of a voice that exists: ready, with its output, and says so', async () => {
      const entry = reservation({ id: 'v1', sourceByteSize: 600 })
      await admit(entry)
      const ready = await claimedAndFinished(entry, 400)

      const finished = await voices.markReady(WEDDING, entryId('v1'), ready, {
        quotaBytes: 1_000,
      })

      expect(finished).toEqual({ kind: 'saved' })
      const stored = (await voices.findByEntry(WEDDING, entryId('v1')))?.voice
      expect(stored?.state).toBe('ready')
      expect(stored?.audioByteSize).toBe(400)
      expect(await voices.voiceBytes(WEDDING)).toBe(400)
    })

    it('does not resurrect a voice that is gone, or write another event’s: the answer is gone', async () => {
      const entry = reservation({ id: 'v1' })
      await admit(entry)
      const ready = await claimedAndFinished(entry, 400)

      expect(await voices.markReady(GALA, entryId('v1'), ready, { quotaBytes: 1_000 })).toEqual({
        kind: 'gone',
      })
      await voices.deleteByEntry(WEDDING, entryId('v1'))
      expect(await voices.markReady(WEDDING, entryId('v1'), ready, { quotaBytes: 1_000 })).toEqual({
        kind: 'gone',
      })
      expect(await book.findById(WEDDING, entryId('v1'))).toBeNull()
    })

    it('credits the source the output replaces: a recording that fits is not refused for its own source', async () => {
      // 600 held as a source, quota 1 000: an output of 900 fits (900 held after), though 600 + 900
      // does not. Without the credit an event near its quota would refuse the very file it is
      // finishing, and a permanent refusal at that.
      const entry = reservation({ id: 'v1', sourceByteSize: 600 })
      await admit(entry, { ...ROOMY, quotaBytes: 1_000 })
      const ready = await claimedAndFinished(entry, 900)

      expect(await voices.markReady(WEDDING, entryId('v1'), ready, { quotaBytes: 1_000 })).toEqual({
        kind: 'saved',
      })
    })

    it('refuses an output that does not fit what the rest of the event holds, and writes nothing', async () => {
      await subject.chargePhotoBytes('evt-wedding', 700)
      const entry = reservation({ id: 'v1', sourceByteSize: 200 })
      await admit(entry, { ...ROOMY, quotaBytes: 1_000 })
      const ready = await claimedAndFinished(entry, 400)

      const finished = await voices.markReady(WEDDING, entryId('v1'), ready, {
        quotaBytes: 1_000,
      })

      expect(finished).toEqual({
        kind: 'refused',
        refusal: { reason: 'quotaExceeded', remaining: 300 },
      })
      // Still the running voice it was, still charged for its source.
      const stored = (await voices.findByEntry(WEDDING, entryId('v1')))?.voice
      expect(stored?.state).toBe('running')
      expect(await voices.voiceBytes(WEDDING)).toBe(200)
    })

    it('counts the event’s other voices when it judges an output', async () => {
      const first = reservation({ id: 'v1', sourceByteSize: 300 })
      const second = reservation({ id: 'v2', guestId: 'guest-sam', sourceByteSize: 300 })
      await admit(first)
      await admit(second)
      await finish(first, 'ready')
      expect(await voices.voiceBytes(WEDDING)).toBe(1_300)

      await voices.saveVoice(WEDDING, entryId('v2'), second.voice!.queue(at(20)))
      const claimed = (await voices.claimNext(at(21)))?.voice
      if (claimed === undefined || claimed === null) throw new Error('nothing was claimed')
      const ready = claimed.finish(
        { hash: must(ContentHash.create(digest('f'))), byteSize: 800, durationMs: 4_000 },
        at(22),
      )
      if (!ready.ok) throw new Error(ready.error.code)

      // 1 000 for the first voice's output, 800 for this one: 1 800 against a quota of 1 500.
      expect(
        await voices.markReady(WEDDING, entryId('v2'), ready.value, { quotaBytes: 1_500 }),
      ).toEqual({ kind: 'refused', refusal: { reason: 'quotaExceeded', remaining: 500 } })
    })

    // ------------------------------------------------------------------ queue --

    it('claims the oldest due voice, across events, and marks it running with one attempt', async () => {
      const older = reservation({ id: 'v1', eventId: 'evt-gala', queuedAt: at(1) })
      const newer = reservation({ id: 'v2', queuedAt: at(2) })
      await admit(older)
      await admit(newer)
      for (const entry of [older, newer]) {
        const queued = entry.voice?.queue(entry.voice.queuedAt)
        if (queued === undefined) throw new Error('fixture')
        await voices.saveVoice(entry.eventId, entry.id, queued)
      }

      const claimed = await voices.claimNext(at(10))

      expect(claimed?.id).toBe('v1')
      expect(claimed?.eventId).toBe(GALA)
      expect(claimed?.voice?.state).toBe('running')
      expect(claimed?.voice?.attempts).toBe(1)
      expect((await voices.claimNext(at(10)))?.id).toBe('v2')
      expect(await voices.claimNext(at(10))).toBeNull()
    })

    it('does not claim a reservation, a voice still backing off, or one already running', async () => {
      const entry = reservation({ id: 'v1' })
      await admit(entry)
      expect(await voices.claimNext(at(100))).toBeNull()

      const queued = entry.voice?.queue(at(50))
      if (queued === undefined) throw new Error('fixture')
      await voices.saveVoice(WEDDING, entry.id, queued)
      expect(await voices.claimNext(at(49))).toBeNull()
      expect((await voices.claimNext(at(50)))?.id).toBe('v1')
      expect(await voices.claimNext(at(100))).toBeNull()
    })

    it('puts back what a dead process was running, and gives up on what has spent its attempts', async () => {
      const fresh = reservation({ id: 'v1' })
      const spent = reservation({ id: 'v2', guestId: 'guest-sam', sourceHash: digest('2') })
      await admit(fresh)
      await admit(spent)
      for (const entry of [fresh, spent]) {
        const queued = entry.voice?.queue(at(1))
        if (queued === undefined) throw new Error('fixture')
        await voices.saveVoice(WEDDING, entry.id, queued)
      }
      await voices.claimNext(at(2))
      await voices.claimNext(at(2))
      // The second one has been tried twice already.
      const twice = await voices.findByEntry(WEDDING, entryId('v2'))
      const worn = twice?.voice
      if (worn === null || worn === undefined) throw new Error('fixture')
      const exhausted = GuestbookVoice.restore({ ...worn.toProps(), attempts: 3 })
      await voices.saveVoice(WEDDING, entryId('v2'), exhausted)

      const touched = await voices.requeueRunning(at(20))

      expect(touched.map((entry) => entry.voice?.state).sort()).toEqual(['failed', 'queued'])
      expect((await voices.findByEntry(WEDDING, entryId('v1')))?.voice?.state).toBe('queued')
      expect((await voices.findByEntry(WEDDING, entryId('v2')))?.voice?.failure).toBe(
        'transcodeFailed',
      )
    })

    // ---------------------------------------------------------- the guest's own --

    it('lists a guest’s own voices, oldest first, failed ones included, and nobody else’s', async () => {
      const mine = reservation({ id: 'v1', createdAt: at(1), sourceHash: digest('1') })
      const failed = reservation({ id: 'v2', createdAt: at(2), sourceHash: digest('2') })
      const theirs = reservation({ id: 'v3', guestId: 'guest-sam', sourceHash: digest('3') })
      for (const entry of [mine, failed, theirs]) await admit(entry)
      await finish(failed, { fail: 'voice.corrupt' })

      expect((await voices.listByGuest(WEDDING, LEA)).map((entry) => entry.id)).toEqual([
        'v1',
        'v2',
      ])
      expect((await voices.listByGuest(WEDDING, SAM)).map((entry) => entry.id)).toEqual(['v3'])
    })

    it('leaves out what the operator took down, which a request never reads', async () => {
      const entry = reservation({ id: 'v1' })
      const hash = entry.voice?.sourceHash
      if (hash === undefined) throw new Error('fixture')
      await admit(entry)
      subject.takeDown('evt-wedding', 'v1', at(5))

      expect(await voices.findByEntry(WEDDING, entryId('v1'))).toBeNull()
      expect(await voices.listByGuest(WEDDING, LEA)).toEqual([])
      expect(await voices.findBySourceHash(WEDDING, hash)).toBeNull()
    })

    it('still names the bytes of what the operator took down: they stay', async () => {
      const entry = reservation({ id: 'v1' })
      await admit(entry)
      subject.takeDown('evt-wedding', 'v1', at(5))

      expect([...(await voices.listReferencedDigests(WEDDING))]).toEqual([
        entry.voice?.sourceHash.value,
      ])
    })

    it('does not let a taken-down message be admitted again: the same bytes answer with it', async () => {
      await admit(reservation({ id: 'v1', sourceHash: digest('a') }))
      subject.takeDown('evt-wedding', 'v1', at(5))

      const again = await admit(reservation({ id: 'v2', sourceHash: digest('a') }))

      expect(again.kind).toBe('duplicate')
    })

    // -------------------------------------------------------------- removing --

    it('removes the entry and its voice together, and is idempotent', async () => {
      await admit(reservation({ id: 'v1' }))

      await voices.deleteByEntry(WEDDING, entryId('v1'))
      await voices.deleteByEntry(WEDDING, entryId('v1'))

      expect(await voices.findByEntry(WEDDING, entryId('v1'))).toBeNull()
      expect(await book.findById(WEDDING, entryId('v1'))).toBeNull()
      expect(await book.countByGuest(WEDDING, LEA)).toBe(0)
    })

    it('never removes a written message: that port’s business is the guestbook’s', async () => {
      await book.admit(aGuestbookEntry({ id: 'w1', eventId: 'evt-wedding', guestId: 'guest-lea' }))

      await voices.deleteByEntry(WEDDING, entryId('w1'))

      expect(await book.findById(WEDDING, entryId('w1'))).not.toBeNull()
    })

    it('frees the guest’s place and the unique index when a reservation is removed', async () => {
      await admit(reservation({ id: 'v1', sourceHash: digest('a') }))
      await voices.deleteByEntry(WEDDING, entryId('v1'))

      const again = await admit(reservation({ id: 'v2', sourceHash: digest('a') }))

      expect(again.kind).toBe('added')
    })

    // ----------------------------------------------------------------- reaping --

    it('reaps the reservations older than the cutoff, entry and voice, and nothing else', async () => {
      const stale = reservation({ id: 'v1', queuedAt: at(1), sourceHash: digest('1') })
      const fresh = reservation({ id: 'v2', queuedAt: at(100), sourceHash: digest('2') })
      const queued = reservation({ id: 'v3', queuedAt: at(1), sourceHash: digest('3') })
      for (const entry of [stale, fresh, queued]) await admit(entry)
      const moved = queued.voice?.queue(at(1))
      if (moved === undefined) throw new Error('fixture')
      await voices.saveVoice(WEDDING, entryId('v3'), moved)

      const reaped = await voices.reapReserved(at(50))

      expect(reaped.map((entry) => entry.id)).toEqual(['v1'])
      expect(await voices.findByEntry(WEDDING, entryId('v1'))).toBeNull()
      expect(await book.findById(WEDDING, entryId('v1'))).toBeNull()
      expect(await voices.findByEntry(WEDDING, entryId('v2'))).not.toBeNull()
      expect(await voices.findByEntry(WEDDING, entryId('v3'))).not.toBeNull()
    })

    it('frees what a reaped reservation held: the guest’s place, the digest and the quota', async () => {
      await admit(
        reservation({ id: 'v1', queuedAt: at(1), sourceHash: digest('a'), sourceByteSize: 900 }),
      )
      await admit(reservation({ id: 'v2', queuedAt: at(1), sourceHash: digest('b') }))
      await admit(reservation({ id: 'v3', queuedAt: at(1), sourceHash: digest('c') }))
      expect(await book.countByGuest(WEDDING, LEA)).toBe(3)

      await voices.reapReserved(at(50))

      expect(await book.countByGuest(WEDDING, LEA)).toBe(0)
      expect(await voices.voiceBytes(WEDDING)).toBe(0)
      const again = await admit(reservation({ id: 'v4', sourceHash: digest('a') }))
      expect(again.kind).toBe('added')
    })

    it('reaps a failed voice once its day is over, and keeps a recent one', async () => {
      const old = reservation({ id: 'v1', sourceHash: digest('1') })
      const recent = reservation({ id: 'v2', sourceHash: digest('2') })
      for (const entry of [old, recent]) await admit(entry)
      await finish(old, { fail: 'voice.corrupt' }, 10)
      await finish(recent, { fail: 'voice.corrupt' }, 1_000)

      const reaped = await voices.reapFailed(at(500))

      expect(reaped.map((entry) => entry.id)).toEqual(['v1'])
      expect(await voices.findByEntry(WEDDING, entryId('v1'))).toBeNull()
      expect(await voices.findByEntry(WEDDING, entryId('v2'))).not.toBeNull()
    })

    it('does not reap a ready voice, however old', async () => {
      const entry = reservation({ id: 'v1' })
      await admit(entry)
      await finish(entry, 'ready')

      expect(await voices.reapFailed(at(100_000))).toEqual([])
      expect(await voices.reapReserved(at(100_000))).toEqual([])
    })

    // ------------------------------------------------------ orphans and sizes --

    it('names the source of a voice still processed and the output of a ready one, never a failed', async () => {
      const processing = reservation({ id: 'v1', sourceHash: digest('1') })
      const ready = reservation({ id: 'v2', sourceHash: digest('2') })
      const failed = reservation({ id: 'v3', sourceHash: digest('3') })
      for (const entry of [processing, ready, failed]) await admit(entry)
      await finish(ready, 'ready', 10)
      await finish(failed, { fail: 'voice.corrupt' }, 20)

      const named = await voices.listReferencedDigests(WEDDING)

      expect([...named].sort()).toEqual([digest('1'), digest('d')].sort())
    })

    it('adds up the outputs of the ready voices, and counts them, for the archive’s estimate', async () => {
      const one = reservation({ id: 'v1', sourceHash: digest('1') })
      const two = reservation({ id: 'v2', sourceHash: digest('2') })
      const pending = reservation({ id: 'v3', sourceHash: digest('3') })
      for (const entry of [one, two, pending]) await admit(entry)
      await finish(one, 'ready', 10)
      await finish(two, 'ready', 20)

      expect(await voices.countReady(WEDDING)).toBe(2)
      expect(await voices.totalBytes(WEDDING)).toBe(2_000)
      expect(await voices.countReady(GALA)).toBe(0)
      expect(await voices.totalBytes(GALA)).toBe(0)
    })

    // ------------------------------------- how the book reads a recording --

    it('lists a voice in the book’s reads, oldest first, and never a failed one', async () => {
      const first = reservation({ id: 'v1', createdAt: at(1), sourceHash: digest('1') })
      const second = reservation({ id: 'v2', createdAt: at(2), sourceHash: digest('2') })
      const failed = reservation({ id: 'v3', createdAt: at(3), sourceHash: digest('3') })
      for (const entry of [first, second, failed]) await admit(entry)
      await finish(failed, { fail: 'voice.corrupt' })

      const listed = await book.listByStatuses(WEDDING, ['pending'], 10)

      expect(listed.map((entry) => entry.id)).toEqual(['v1', 'v2'])
      expect(listed.every((entry) => entry.text === null && entry.voice !== null)).toBe(true)
    })

    it('leaves a voice out of what only reads words, in the query so the limit counts words', async () => {
      await admit(reservation({ id: 'v1', createdAt: at(1) }))
      await book.admit(
        aGuestbookEntry({
          id: 'w1',
          eventId: 'evt-wedding',
          guestId: 'guest-sam',
          createdAt: at(2),
        }),
      )
      await book.admit(
        aGuestbookEntry({
          id: 'w2',
          eventId: 'evt-wedding',
          guestId: 'guest-sam',
          text: 'w2',
          createdAt: at(3),
        }),
      )

      const written = await book.listWrittenByStatuses(WEDDING, ['pending'], 1)

      expect(written.map((entry) => entry.id)).toEqual(['w1'])
      expect(written.every((entry) => entry.text.value.length > 0)).toBe(true)
    })

    it('keeps a failed voice in its author’s own list, and finds it to remove it', async () => {
      const failed = reservation({ id: 'v1' })
      await admit(failed)
      await finish(failed, { fail: 'voice.corrupt' })

      expect((await book.listByGuest(WEDDING, LEA, 10)).map((entry) => entry.id)).toEqual(['v1'])
      expect((await book.findById(WEDDING, entryId('v1')))?.voice?.state).toBe('failed')
    })

    it('counts a failed voice in neither of the book’s ceilings, and a live one in both', async () => {
      const failed = reservation({ id: 'v1', sourceHash: digest('1') })
      const live = reservation({ id: 'v2', sourceHash: digest('2') })
      await admit(failed)
      await admit(live)
      await finish(failed, { fail: 'voice.corrupt' })

      expect(await book.countByGuest(WEDDING, LEA)).toBe(1)
      expect(await book.countOpenByEvent(WEDDING)).toBe(1)
    })

    it('keeps counting a taken-down voice for its guest, as it does a taken-down text', async () => {
      await admit(reservation({ id: 'v1' }))
      subject.takeDown('evt-wedding', 'v1', at(5))

      expect(await book.countByGuest(WEDDING, LEA)).toBe(1)
      expect(await book.countOpenByEvent(WEDDING)).toBe(0)
    })

    it('takes a guest’s voices with their erasure, the entry and the voice', async () => {
      await admit(reservation({ id: 'v1' }))

      expect(await book.deleteByGuest(WEDDING, LEA)).toBe(1)

      expect(await voices.findByEntry(WEDDING, entryId('v1'))).toBeNull()
    })
  })
}

const must = <T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T => {
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}
