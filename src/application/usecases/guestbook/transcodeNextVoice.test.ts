import { beforeEach, describe, expect, it } from 'vitest'
import type { ClientCeilingsProps } from '../../../domain/clients/clientCeilings'
import type { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import { VOICE_MIN_MS } from '../../../domain/guestbook/guestbookVoiceLimits'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { STAGED_SOURCE } from '../../../domain/photos/mediaVariant'
import { asEventId, asGuestbookEntryId } from '../../../domain/shared/ids'
import { ok } from '../../../domain/shared/result'
import {
  AT,
  aClient,
  aGuestbookEntry,
  aPhoto,
  aVoiceEntry,
  anEvent,
  type EventInput,
  type GuestbookVoiceEntryInput,
} from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { CountingClientRepository } from '../../testing/countingClientRepository'
import { FakeAudioTranscoder, fakeVoiceBytes } from '../../testing/fakeAudioTranscoder'
import { FakeClock } from '../../testing/fakeClock'
import { FakeContentHasher } from '../../testing/fakeContentHasher'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from '../../testing/fakeGuestbookVoiceRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeTranscodeNextVoice, type TranscodeNextVoice } from './transcodeNextVoice'

/**
 * One pass of the voice queue (spec 25). These are the tests that hold the line the design rests
 * on: a `ready` row appears only when there is a file behind it, the source stops costing the
 * event the moment its output replaces it, a duration is the one measured on the output, and a
 * process that was interrupted costs a guest neither their message nor the album a ghost.
 */

const EVENT = asEventId('event-1')
const ENTRY = asGuestbookEntryId('voice-1')

const POLICY = { maxDurationMs: 60_000, maxOutputBytes: 1_000_000 }

/** What the fake encoder writes for a recording of this length: 6 bytes a millisecond. */
const outputBytesFor = (audioMs: number): number => audioMs * 6

describe('transcodeNextVoice', () => {
  let events: FakeEventRepository
  let clients: CountingClientRepository
  let guestbook: FakeGuestbookRepository
  let voices: FakeGuestbookVoiceRepository
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore
  let transcoder: FakeAudioTranscoder
  let hasher: FakeContentHasher
  let bus: RecordingEventBus
  let clock: FakeClock
  let logger: CapturingLogger
  let transcodeNext: TranscodeNextVoice

  const build = (): void => {
    transcodeNext = makeTranscodeNextVoice({
      events,
      clients,
      voices,
      media,
      transcoder,
      hasher,
      bus,
      clock,
      logger,
      policy: POLICY,
    })
  }

  beforeEach(() => {
    clients = new CountingClientRepository()
    events = new FakeEventRepository({ clients })
    guestbook = new FakeGuestbookRepository()
    photos = new FakePhotoRepository()
    voices = new FakeGuestbookVoiceRepository(guestbook)
      .chargePhotoBytesFrom(photos)
      .chargeClientEventsFrom(clients)
    media = new InMemoryMediaStore()
    transcoder = new FakeAudioTranscoder()
    hasher = new FakeContentHasher()
    bus = new RecordingEventBus()
    clock = new FakeClock(AT)
    logger = new CapturingLogger()
    build()
  })

  const seedEvent = (input: EventInput = {}): void => {
    events.seed(anEvent({ id: 'event-1', ...input }))
  }

  /** What `stageGuestbookVoice` leaves: the source on the disk, then the queued row. */
  const stage = async (
    recording: Uint8Array = fakeVoiceBytes({ audioMs: 5_000 }),
    input: GuestbookVoiceEntryInput = {},
  ): Promise<GuestbookEntry> => {
    const entry = aVoiceEntry({
      id: 'voice-1',
      eventId: 'event-1',
      state: 'queued',
      sourceByteSize: 40_000,
      ...input,
    })
    const voice = entry.voice
    if (voice === null) throw new Error('fixture')
    await media.put(entry.eventId, voice.sourceHash, STAGED_SOURCE, recording)
    guestbook.put(entry)
    return entry
  }

  const voiceOf = async (id = 'voice-1') =>
    (await voices.findByEntry(EVENT, asGuestbookEntryId(id)))?.voice ?? null

  const failedWith = (result: Awaited<ReturnType<TranscodeNextVoice>>): string | null =>
    result.ok && result.value.kind === 'failed' ? result.value.code : null

  const willRetry = (result: Awaited<ReturnType<TranscodeNextVoice>>): boolean | null =>
    result.ok && result.value.kind === 'failed' ? result.value.willRetry : null

  const sourceIsOnDisk = async (entry: GuestbookEntry): Promise<boolean> =>
    entry.voice !== null &&
    (await media.exists(entry.eventId, entry.voice.sourceHash, STAGED_SOURCE))

  describe('an empty queue', () => {
    it('answers idle rather than inventing work', async () => {
      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('idle')
    })

    it('leaves a voice whose backoff has not elapsed alone', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 5_000 }), {
        queuedAt: new Date(AT.getTime() + 60_000),
      })

      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('idle')
      expect(transcoder.calls).toEqual([])
    })
  })

  describe('a recording that is transcoded', () => {
    it('becomes ready with the output’s hash, its size and its measured duration', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 5_000 }))

      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('transcoded')
      const voice = await voiceOf()
      expect(voice?.state).toBe('ready')
      expect(voice?.durationMs).toBe(5_000)
      expect(voice?.audioByteSize).toBe(outputBytesFor(5_000))
      const hash = voice?.audioHash
      expect(hash).not.toBeNull()
      expect(
        hash === null || hash === undefined ? false : await media.exists(EVENT, hash, 'voice'),
      ).toBe(true)
    })

    it('stores the output under the digest of its own bytes, in the voice variant only', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 5_000 }))

      await transcodeNext()

      const hash = (await voiceOf())?.audioHash
      if (hash === null || hash === undefined) throw new Error('not ready')
      const written = await media.read(EVENT, hash, 'voice')
      if (written === null) throw new Error('nothing was written')
      expect(hash.value).toBe(hasher.sha256Hex(written))
      expect(media.variantsOf(EVENT, hash)).toEqual(['voice'])
    })

    it('writes the output into the store before the row says it is ready', async () => {
      seedEvent()
      await stage()
      let outputWhenRowWritten: boolean | null = null
      const markReady = voices.markReady.bind(voices)
      voices.markReady = async (eventId, entryId, voice, limits) => {
        const hash = voice.audioHash
        outputWhenRowWritten = hash === null ? false : await media.exists(eventId, hash, 'voice')
        return markReady(eventId, entryId, voice, limits)
      }

      await transcodeNext()

      expect(outputWhenRowWritten).toBe(true)
    })

    it('deletes the source only after the row is ready, never before', async () => {
      seedEvent()
      const entry = await stage()
      let sourceWhenRowWritten: boolean | null = null
      const markReady = voices.markReady.bind(voices)
      voices.markReady = async (eventId, entryId, voice, limits) => {
        sourceWhenRowWritten = await sourceIsOnDisk(entry)
        return markReady(eventId, entryId, voice, limits)
      }

      await transcodeNext()

      expect(sourceWhenRowWritten).toBe(true)
      expect(await sourceIsOnDisk(entry)).toBe(false)
    })

    it('tells the host’s console, and no screen: the signal is guestbook.voice and nothing else', async () => {
      seedEvent()
      await stage()

      await transcodeNext()

      expect(bus.published).toEqual([{ type: 'guestbook.voice', eventId: EVENT }])
    })

    it('leaves the moderation of the message exactly as the event decided it at staging', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 5_000 }), { id: 'voice-1', moderation: 'auto' })

      await transcodeNext()

      const entry = await voices.findByEntry(EVENT, ENTRY)
      expect(entry?.status).toBe('published')
      expect(entry?.review?.kind).toBe('automatic')
    })

    it('hands the encoder the cap, the floor and the output ceiling of the policy', async () => {
      seedEvent()
      await stage()

      await transcodeNext()

      expect(transcoder.lastSpec).toEqual({
        maxDurationMs: POLICY.maxDurationMs,
        minDurationMs: VOICE_MIN_MS,
        maxOutputBytes: POLICY.maxOutputBytes,
      })
    })

    it('probes before it encodes, so a refusal costs no decoding', async () => {
      seedEvent()
      await stage()

      await transcodeNext()

      expect(transcoder.calls).toEqual(['probe', 'transcode'])
    })

    it('still finishes when the disk will not unlink the source: the row must not stay running', async () => {
      seedEvent()
      await stage()
      media.failDeletes()

      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('transcoded')
      expect((await voiceOf())?.state).toBe('ready')
      expect(logger.lines.some((line) => line.level === 'warn')).toBe(true)
    })
  })

  describe('the duration', () => {
    it('does not refuse a recording whose container declares no duration: that is the browser’s normal case', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 4_000, declaredMs: null }))

      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('transcoded')
      expect((await voiceOf())?.durationMs).toBe(4_000)
    })

    it('stores the duration measured on the output, never the one the header declared', async () => {
      seedEvent()
      // Declares 62 s (inside the five seconds of slack past the cap) and holds three.
      await stage(fakeVoiceBytes({ audioMs: 3_000, declaredMs: 62_000 }))

      await transcodeNext()

      expect((await voiceOf())?.durationMs).toBe(3_000)
    })

    it('bounds the stored duration at the cap when the sound is longer than the header admitted', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 120_000, declaredMs: 60_000 }))

      await transcodeNext()

      expect((await voiceOf())?.durationMs).toBe(POLICY.maxDurationMs)
    })

    it('accepts a file declaring exactly the cap plus five seconds, and refuses one a millisecond over', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 8_000, declaredMs: 65_000 }), { id: 'voice-1' })
      await stage(fakeVoiceBytes({ audioMs: 9_000, declaredMs: 65_001 }), {
        id: 'voice-2',
        queuedAt: new Date(AT.getTime() + 1),
      })
      clock.advance(10)

      const first = await transcodeNext()
      const second = await transcodeNext()

      expect(first.ok && first.value.kind).toBe('transcoded')
      expect(failedWith(second)).toBe('voice.tooLong')
    })

    it('refuses a file declaring too long before anything is decoded, and for good', async () => {
      seedEvent()
      const entry = await stage(fakeVoiceBytes({ audioMs: 3_000, declaredMs: 600_000 }))

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.tooLong')
      expect(willRetry(result)).toBe(false)
      expect(transcoder.calls).toEqual(['probe'])
      expect((await voiceOf())?.state).toBe('failed')
      expect((await voiceOf())?.failure).toBe('tooLong')
      expect(await sourceIsOnDisk(entry)).toBe(false)
    })

    it('refuses a stray tap as too short, and for good', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 400 }))

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.tooShort')
      expect(willRetry(result)).toBe(false)
      expect((await voiceOf())?.failure).toBe('tooShort')
    })
  })

  describe('what is not a voice message', () => {
    it('refuses a video renamed as a voice as notAudio, before it is encoded, and for good', async () => {
      seedEvent()
      const entry = await stage(fakeVoiceBytes({ audioMs: 5_000, hasVideo: true }))

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.notAudio')
      expect(willRetry(result)).toBe(false)
      expect(transcoder.calls).toEqual(['probe'])
      expect((await voiceOf())?.failure).toBe('notAudio')
      expect(await sourceIsOnDisk(entry)).toBe(false)
      expect(media.objectCount).toBe(0)
    })

    it('refuses a header that will not parse as corrupt, and for good', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 5_000, corrupt: true }))

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.corrupt')
      expect(willRetry(result)).toBe(false)
    })

    it('refuses a container with nothing to hear, and for good', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 5_000, noAudio: true }))

      expect(failedWith(await transcodeNext())).toBe('voice.noAudioStream')
    })

    it('tells the console and the phone when a voice is given up on, once, and not on a retry', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 5_000, transcodeError: 'voice.transcodeFailed' }))

      await transcodeNext()
      expect(bus.published).toEqual([])

      clock.advance(60_000)
      await transcodeNext()
      clock.advance(60_000)
      await transcodeNext()
      expect(bus.published).toEqual([{ type: 'guestbook.voice', eventId: EVENT }])
    })
  })

  describe('a failure of the machine rather than the file', () => {
    it('is tried again after a backoff, with the source kept for the next attempt', async () => {
      seedEvent()
      const entry = await stage(
        fakeVoiceBytes({ audioMs: 5_000, transcodeError: 'voice.transcodeFailed' }),
      )

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.transcodeFailed')
      expect(willRetry(result)).toBe(true)
      const voice = await voiceOf()
      expect(voice?.state).toBe('queued')
      expect(voice?.attempts).toBe(1)
      expect(voice?.queuedAt.getTime()).toBeGreaterThan(AT.getTime())
      expect(await sourceIsOnDisk(entry)).toBe(true)
      // Not claimable until the backoff has passed.
      expect((await transcodeNext()).ok && (await voiceOf())?.attempts).toBe(1)
    })

    it('ends as failed with a closed code after three attempts, and takes its source with it', async () => {
      seedEvent()
      const entry = await stage(
        fakeVoiceBytes({ audioMs: 5_000, transcodeError: 'voice.transcodeFailed' }),
      )

      const outcomes: (boolean | null)[] = []
      for (let attempt = 0; attempt < 3; attempt += 1) {
        clock.advance(60_000)
        outcomes.push(willRetry(await transcodeNext()))
      }

      expect(outcomes).toEqual([true, true, false])
      const voice = await voiceOf()
      expect(voice?.state).toBe('failed')
      expect(voice?.failure).toBe('transcodeFailed')
      expect(voice?.attempts).toBe(3)
      expect(await sourceIsOnDisk(entry)).toBe(false)
    })

    it('reads a timeout as the machine’s: it is retried, never a verdict on the recording', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 5_000, transcodeError: 'voice.transcodeTimedOut' }))

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.transcodeTimedOut')
      expect(willRetry(result)).toBe(true)
    })

    it('takes the bytes before the row when it gives up, so a resend cannot lose its source to the unlink', async () => {
      seedEvent()
      const entry = await stage(fakeVoiceBytes({ audioMs: 5_000, corrupt: true }))
      let sourceWhenRowWritten: boolean | null = null
      const saveVoice = voices.saveVoice.bind(voices)
      voices.saveVoice = async (eventId, entryId, voice) => {
        sourceWhenRowWritten = await sourceIsOnDisk(entry)
        return saveVoice(eventId, entryId, voice)
      }

      await transcodeNext()

      expect(sourceWhenRowWritten).toBe(false)
    })

    it('does not leave the row running when the disk will not unlink on the way out', async () => {
      seedEvent()
      await stage(fakeVoiceBytes({ audioMs: 5_000, corrupt: true }))
      media.failDeletes()

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.corrupt')
      expect((await voiceOf())?.state).toBe('failed')
    })

    it('answers a missing source as a failed pass of the machine, not a crash', async () => {
      seedEvent()
      const entry = await stage()
      await media.delete(entry.eventId, entry.voice?.sourceHash as ContentHash)

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.sourceMissing')
      expect((await voiceOf())?.state).toBe('queued')
    })

    it('answers an event that no longer exists as a failed pass, not a crash', async () => {
      await stage()

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('event.notFound')
    })

    it('takes back an output it could not store, and tries again', async () => {
      seedEvent()
      await stage()
      media.failWritesAfter(0)

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.storageFailed')
      expect(willRetry(result)).toBe(true)
      expect(media.objectCount).toBe(1)
      expect((await voiceOf())?.state).toBe('queued')
    })

    it('does not store an output it cannot give a digest to', async () => {
      seedEvent()
      await stage()
      hasher.returnGarbage()

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('photo.hashFailed')
      expect(media.objectCount).toBe(1)
    })

    it('takes back its output when the database fails after the bytes were written', async () => {
      seedEvent()
      await stage()
      voices.markReady = async () => {
        throw new Error('database is locked')
      }

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.storageFailed')
      expect(media.objectCount).toBe(1)
      expect((await voiceOf())?.state).toBe('queued')
    })
  })

  describe('what the entity and the database refuse', () => {
    it('refuses an output that cannot say how long it is, takes it back, and tries again', async () => {
      seedEvent()
      await stage()
      transcoder.transcode = async () =>
        ok({ bytes: new Uint8Array([1, 2, 3]), byteSize: 3, durationMs: 0 })

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('voice.outputInvalid')
      expect(media.objectCount).toBe(1)
      expect((await voiceOf())?.state).toBe('queued')
    })

    it('leaves the output for the sweep when it cannot ask which messages name it', async () => {
      seedEvent()
      await stage()
      const put = media.put.bind(media)
      media.put = async (...args) => {
        await put(...args)
        await voices.deleteByEntry(EVENT, ENTRY)
      }
      voices.listReferencedDigests = async () => {
        throw new Error('database is locked')
      }

      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('retired')
      // Source and output both stay: a lookup that cannot answer proves nothing, and deleting on
      // a guess is how a shared output is lost.
      expect(media.objectCount).toBe(2)
    })

    it('answers with the entity’s refusal when the queue hands it a voice that is not running', async () => {
      // No event is seeded, so the pass gives up at once, and a voice that was never claimed cannot
      // be failed: the entity refuses and the pass says so rather than writing it back.
      voices.claimNext = async () =>
        aVoiceEntry({ id: 'voice-1', eventId: 'event-1', state: 'queued' })

      const result = await transcodeNext()

      expect(!result.ok && result.error.code).toBe('guestbookVoice.illegalTransition')
    })

    it('fails the pass loudly when the queue hands it a message that carries no recording', async () => {
      seedEvent()
      voices.claimNext = async () => aGuestbookEntry({ id: 'text-1', eventId: 'event-1' })

      await expect(transcodeNext()).rejects.toThrow('without a voice')
    })
  })

  describe('a message erased while it was being processed', () => {
    it('takes back the output, keeps the source for the sweep, and says nothing', async () => {
      seedEvent()
      const entry = await stage()
      const put = media.put.bind(media)
      media.put = async (...args) => {
        await put(...args)
        await voices.deleteByEntry(EVENT, ENTRY)
      }

      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('retired')
      expect(await voiceOf()).toBeNull()
      // The one file left is the source: a resend may already hold that digest, so only the
      // sweep, which asks the database, may collect it.
      expect(media.objectCount).toBe(1)
      expect(await sourceIsOnDisk(entry)).toBe(true)
      expect(bus.published).toEqual([])
    })

    it('does not take back an output another message of the event names', async () => {
      seedEvent()
      // Another message already ready on the very same sound.
      const twin = aVoiceEntry({
        id: 'voice-0',
        eventId: 'event-1',
        state: 'ready',
        guestId: 'guest-2',
        audioHash: hasher.sha256Hex(
          fakeVoiceBytes({ audioMs: 5_000, container: 'mp4', byteSize: 30_000 }),
        ),
        audioByteSize: 30_000,
        durationMs: 5_000,
      })
      guestbook.put(twin)
      await media.put(
        EVENT,
        twin.voice?.audioHash as ContentHash,
        'voice',
        fakeVoiceBytes({ audioMs: 5_000, container: 'mp4', byteSize: 30_000 }),
      )
      await stage()
      const put = media.put.bind(media)
      media.put = async (...args) => {
        await put(...args)
        await voices.deleteByEntry(EVENT, ENTRY)
      }

      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('retired')
      expect(await media.exists(EVENT, twin.voice?.audioHash as ContentHash, 'voice')).toBe(true)
    })
  })

  describe('the quota, judged against committed state with the source credited', () => {
    it('credits the voice’s own source: an event that holds only it is not refused its own output', async () => {
      // 40 000 bytes of source and a quota of 50 000: the 30 000-byte output fits (30 000 held
      // after), though 40 000 + 30 000 does not.
      seedEvent({ quotaBytes: 50_000 })
      await stage(fakeVoiceBytes({ audioMs: 5_000 }), { sourceByteSize: 40_000 })

      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('transcoded')
    })

    it('refuses an output that does not fit what the rest of the event holds, and takes it back', async () => {
      seedEvent({ quotaBytes: 50_000 })
      photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', byteSize: 45_000 }))
      const entry = await stage(fakeVoiceBytes({ audioMs: 5_000 }), { sourceByteSize: 1_000 })

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('event.quotaExceeded')
      // The room may be made before the next attempt, so it is retried, with the source kept.
      expect(willRetry(result)).toBe(true)
      expect(await sourceIsOnDisk(entry)).toBe(true)
      expect(media.objectCount).toBe(1)
      expect((await voiceOf())?.state).toBe('queued')
    })

    it('ends a voice that never fits as failed with a closed code once its attempts are spent', async () => {
      seedEvent({ quotaBytes: 50_000 })
      photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', byteSize: 45_000 }))
      await stage(fakeVoiceBytes({ audioMs: 5_000 }), { sourceByteSize: 1_000 })

      for (let attempt = 0; attempt < 3; attempt += 1) {
        clock.advance(60_000)
        await transcodeNext()
      }

      expect((await voiceOf())?.state).toBe('failed')
      expect((await voiceOf())?.failure).toBe('storageFailed')
    })

    it('judges the client’s ceiling over all its events, with the same credit', async () => {
      const seedClient = (ceilings: Partial<ClientCeilingsProps>): void => {
        clients.seed(aClient({ id: 'client-1', ceilings }))
      }
      seedClient({ maxTotalBytes: 31_000 })
      seedEvent({ clientId: 'client-1' })
      // 40 000 of source, ceiling 31 000: the 30 000-byte output fits only because the source leaves.
      await stage(fakeVoiceBytes({ audioMs: 5_000 }), { sourceByteSize: 40_000 })

      const result = await transcodeNext()

      expect(result.ok && result.value.kind).toBe('transcoded')
    })

    it('turns an output away with the client’s own code when it passes the client’s ceiling', async () => {
      clients.seed(aClient({ id: 'client-1', ceilings: { maxTotalBytes: 20_000 } }))
      seedEvent({ clientId: 'client-1' })
      await stage(fakeVoiceBytes({ audioMs: 5_000 }), { sourceByteSize: 1_000 })

      const result = await transcodeNext()

      expect(failedWith(result)).toBe('client.storageFull')
    })
  })
})
