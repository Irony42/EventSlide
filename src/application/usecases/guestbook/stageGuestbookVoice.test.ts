import { beforeEach, describe, expect, it } from 'vitest'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import { STAGED_SOURCE } from '../../../domain/photos/mediaVariant'
import { ContentHash } from '../../../domain/photos/contentHash'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import {
  MAX_QUEUED_VOICES,
  MAX_QUEUED_VOICES_PER_EVENT,
} from '../../../domain/guestbook/guestbookVoiceLimits'
import {
  AT,
  aClient,
  aGuestbookEntry,
  aPhoto,
  aVoiceEntry,
  anEvent,
  type EventInput,
} from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import {
  FakeAudioTranscoder,
  fakeVoiceBytes,
  notARecording,
} from '../../testing/fakeAudioTranscoder'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeContentHasher } from '../../testing/fakeContentHasher'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from '../../testing/fakeGuestbookVoiceRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeStageGuestbookVoice, type StageGuestbookVoice } from './stageGuestbookVoice'

/**
 * Staging a voice message (spec 25). The rules this protects decide what a guest standing in a
 * room is told, and one of them is an order: **the row before the bytes**, so a refusal costs
 * nothing on the disk. Each case below names one rule.
 */

const EVENT = asEventId('event-1')
const LEA = asGuestId('guest-lea')
const SAM = asGuestId('guest-sam')
const DAY_MS = 86_400_000

/** A recording of a given size, told apart from another by its seed (the length it says it has). */
const aRecording = (seed = 'a', byteSize = 40_000): Uint8Array =>
  fakeVoiceBytes({ audioMs: 10_000 + seed.charCodeAt(0), byteSize, container: 'mp4' })

/** A voice-enabled event's settings: what a host who switched voice on has chosen. */
const VOICE_ON: EventSettingsPatch = { allowGuestbook: true, guestbookVoice: { enabled: true } }

describe('stageGuestbookVoice', () => {
  let events: FakeEventRepository
  let clients: FakeClientRepository
  let guestbook: FakeGuestbookRepository
  let voices: FakeGuestbookVoiceRepository
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore
  let transcoder: FakeAudioTranscoder
  let hasher: FakeContentHasher
  let bus: RecordingEventBus
  let clock: FakeClock
  let logger: CapturingLogger
  let stage: StageGuestbookVoice

  const seedEvent = (
    input: Omit<EventInput, 'settings'> & { readonly settings?: EventSettingsPatch } = {},
  ): void => {
    events.seed(anEvent({ id: 'event-1', ...input, settings: { ...VOICE_ON, ...input.settings } }))
  }

  const build = (limits = { maxQueuedVoices: 40, maxQueuedVoicesPerEvent: 20 }): void => {
    stage = makeStageGuestbookVoice({
      events,
      clients,
      guestbook,
      voices,
      media,
      transcoder,
      hasher,
      bus,
      clock,
      ids: new SequentialIdGenerator(),
      logger,
      limits,
    })
  }

  beforeEach(() => {
    clients = new FakeClientRepository()
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
    seedEvent()
    build()
  })

  const send = (
    bytes: Uint8Array = aRecording(),
    guestId = LEA,
    caption?: unknown,
    eventId = EVENT,
  ) => stage({ eventId, guestId, file: { bytes }, caption })

  const codeOf = async (promise: ReturnType<typeof send>): Promise<string | null> => {
    const result = await promise
    return result.ok ? null : result.error.code
  }

  describe('a recording that is accepted', () => {
    it('is stored as a queued voice message with no text, waiting for the transcoder', async () => {
      const result = await send(aRecording(), LEA, 'Pour Camille')

      expect(result.ok && result.value.duplicate).toBe(false)
      const entry = result.ok ? result.value.entry : null
      expect(entry?.text).toBeNull()
      expect(entry?.voice?.state).toBe('queued')
      expect(entry?.voice?.caption?.value).toBe('Pour Camille')
      expect(entry?.guestId).toBe(LEA)
      expect(entry?.status).toBe('pending')
      expect(entry).not.toBeNull()
      if (entry === null) return
      expect((await voices.findByEntry(EVENT, entry.id))?.voice?.state).toBe('queued')
    })

    it('puts the source on the disk under its own digest, as the one thing the worker will read', async () => {
      const bytes = aRecording()

      const result = await send(bytes)

      const digest = ContentHash.create(hasher.sha256Hex(bytes))
      if (!digest.ok) throw new Error('fixture')
      expect(result.ok).toBe(true)
      expect(await media.exists(EVENT, digest.value, STAGED_SOURCE)).toBe(true)
      expect(media.objectCount).toBe(1)
    })

    it('wakes the worker with one fact, which is never for a screen', async () => {
      await send()

      expect(bus.published).toEqual([{ type: 'voice.queued', eventId: EVENT }])
    })

    it('announces nothing to the wall: no guestbook.changed, which the wall re-reads on', async () => {
      await send()

      expect(bus.published.map((fact) => fact.type)).not.toContain('guestbook.changed')
    })

    it('publishes on arrival, as an automatic decision, on an event that publishes on arrival', async () => {
      seedEvent({ settings: { moderation: 'auto' } })

      const result = await send()

      expect(result.ok && result.value.entry.status).toBe('published')
      expect(result.ok && result.value.entry.review).toEqual({ kind: 'automatic', at: AT })
    })

    it('takes no caption as no caption, and a blank one as none', async () => {
      const none = await send(aRecording('a'))
      const blank = await send(aRecording('b'), LEA, '   ')

      expect(none.ok && none.value.entry.voice?.caption).toBeNull()
      expect(blank.ok && blank.value.entry.voice?.caption).toBeNull()
    })

    it('signs the message with the guest the token proves, at the event the route names', async () => {
      const result = await send(aRecording(), SAM)

      expect(result.ok && result.value.entry.guestId).toBe(SAM)
      expect(result.ok && result.value.entry.eventId).toBe(EVENT)
    })

    it('accepts on a closed event for seven days after it closed, and not after', async () => {
      const closedAt = new Date(AT.getTime() - DAY_MS)
      seedEvent({ status: 'closed', closedAt })
      clock.set(new Date(closedAt.getTime() + 7 * DAY_MS - 1))
      expect((await send(aRecording('a'))).ok).toBe(true)

      clock.set(new Date(closedAt.getTime() + 7 * DAY_MS))
      expect(await codeOf(send(aRecording('b')))).toBe('event.notAcceptingUploads')
    })
  })

  describe('the gates, in the order a guest can act on them', () => {
    it('answers an event the operator took down as an event that is not there', async () => {
      await events.setTakenDown(EVENT, new Date(0))

      expect(await codeOf(send())).toBe('event.notFound')
    })

    it('answers an unknown event as one that is not there', async () => {
      expect(await codeOf(send(aRecording(), LEA, undefined, asEventId('nope')))).toBe(
        'event.notFound',
      )
    })

    it.each(['draft', 'archived'] as const)('refuses on a %s event', async (status) => {
      seedEvent({ status })

      expect(await codeOf(send())).toBe('event.notAcceptingUploads')
    })

    it('refuses when the host switched the guestbook off, whatever the voice setting says', async () => {
      seedEvent({ settings: { allowGuestbook: false, guestbookVoice: { enabled: true } } })

      expect(await codeOf(send())).toBe('guestbook.disabled')
    })

    it('refuses when the host did not switch voice on, and writes nothing', async () => {
      seedEvent({ settings: { guestbookVoice: { enabled: false } } })

      expect(await codeOf(send())).toBe('guestbook.voiceDisabled')
      expect(media.objectCount).toBe(0)
      expect(guestbook.all(EVENT)).toEqual([])
      expect(bus.published).toEqual([])
    })

    it('refuses before any byte when this box has no encoder, which is not a failure of the file', async () => {
      transcoder.unavailable()

      const result = await send()

      expect(!result.ok && result.error.code).toBe('voice.transcoderUnavailable')
      expect(!result.ok && result.error.kind).toBe('unexpected')
      expect(media.objectCount).toBe(0)
      expect(guestbook.all(EVENT)).toEqual([])
      expect(logger.lines.some((line) => line.level === 'error')).toBe(true)
    })

    it('refuses a renamed document on its signature, before a byte is written or a row made', async () => {
      const result = await send(notARecording())

      expect(!result.ok && result.error.code).toBe('voice.unsupportedFormat')
      expect(media.objectCount).toBe(0)
      expect(guestbook.all(EVENT)).toEqual([])
      expect(transcoder.calls).toEqual(['identify'])
    })

    it('checks the box can transcode before it looks at the file', async () => {
      transcoder.unavailable()

      await send(notARecording())

      // The capability is asked first, so a box with no encoder answers the same for every file.
      expect(transcoder.calls).toEqual([])
    })

    it('refuses a caption the domain refuses, and stores nothing', async () => {
      expect(await codeOf(send(aRecording(), LEA, 'x'.repeat(141)))).toBe('caption.tooLong')
      expect(await codeOf(send(aRecording(), LEA, 7))).toBe('caption.invalid')
      expect(media.objectCount).toBe(0)
      expect(guestbook.all(EVENT)).toEqual([])
    })

    it('refuses an empty upload that a signature check waved through, charging nothing', async () => {
      transcoder.identify = () => 'mp4'

      const result = await send(new Uint8Array(0))

      expect(!result.ok && result.error.code).toBe('voice.sourceByteSizeInvalid')
      expect(media.objectCount).toBe(0)
      expect(guestbook.all(EVENT)).toEqual([])
    })

    it('fails closed when the hasher breaks, and says it is not the guest’s file', async () => {
      hasher.returnGarbage()

      const result = await send()

      expect(!result.ok && result.error.code).toBe('photo.hashFailed')
      expect(media.objectCount).toBe(0)
    })
  })

  describe('the row before the bytes', () => {
    it('refuses the fourth message of a guest, texts and voices together, for the price of no byte', async () => {
      guestbook.seed(aGuestbookEntry({ id: 'w1', eventId: 'event-1', guestId: 'guest-lea' }))
      await send(aRecording('a'))
      await send(aRecording('b'))
      const before = media.objectCount

      const refused = await send(aRecording('c'))

      expect(!refused.ok && refused.error.code).toBe('guestbook.limitReached')
      expect(!refused.ok && refused.error.details).toEqual({ max: 3 })
      expect(media.objectCount).toBe(before)
    })

    it('decides the ceilings again where requests overlap: both read room, only one is given it', async () => {
      guestbook.seed(aGuestbookEntry({ id: 'w1', eventId: 'event-1', guestId: 'guest-lea' }))
      guestbook.seed(
        aGuestbookEntry({ id: 'w2', eventId: 'event-1', guestId: 'guest-lea', text: 'w2' }),
      )

      const [first, second] = await Promise.all([send(aRecording('a')), send(aRecording('b'))])

      // The early count is a cheap refusal, not the decision: both passed it with two held, and
      // the transaction's answer is the one that holds.
      const codes = [first, second].map((result) => (result.ok ? 'sent' : result.error.code))
      expect(codes.sort()).toEqual(['guestbook.limitReached', 'sent'])
      expect(media.objectCount).toBe(1)
    })

    it('does not count a voice that failed: three failures leave the guest their fourth try', async () => {
      for (const id of ['f1', 'f2', 'f3']) {
        guestbook.seed(
          aVoiceEntry({
            id,
            state: 'failed',
            eventId: 'event-1',
            guestId: 'guest-lea',
            sourceHash: id.charCodeAt(1).toString(16).padStart(64, '0'),
          }),
        )
      }

      const result = await send(aRecording('z'))

      expect(result.ok).toBe(true)
    })

    it('refuses the 201st voice of an event with its own code, and the 501st message with another', async () => {
      for (let n = 0; n < 200; n += 1) {
        guestbook.seed(
          aVoiceEntry({
            id: `fill-${n}`,
            state: 'ready',
            eventId: 'event-1',
            guestId: `guest-${Math.floor(n / 3)}`,
            sourceHash: n.toString(16).padStart(64, '0'),
          }),
        )
      }

      const refused = await send(aRecording('v'), asGuestId('guest-late'))

      expect(!refused.ok && refused.error.code).toBe('guestbook.voiceEventFull')
      expect(!refused.ok && refused.error.details).toEqual({ max: 200 })
      expect(media.objectCount).toBe(0)
    })

    it('says the book is full before it says the voices are', async () => {
      for (let n = 0; n < 500; n += 1) {
        guestbook.seed(
          aGuestbookEntry({
            id: `fill-${n}`,
            eventId: 'event-1',
            guestId: `guest-${n}`,
            text: `fill-${n}`,
          }),
        )
      }

      const refused = await send(aRecording('v'), asGuestId('guest-late'))

      expect(!refused.ok && refused.error.code).toBe('guestbook.eventFull')
    })

    it('refuses with a 429 and the depth when the queue is full, never with the quota’s 413', async () => {
      build({ maxQueuedVoices: 40, maxQueuedVoicesPerEvent: 1 })
      await send(aRecording('a'), SAM)

      const refused = await send(aRecording('b'), LEA)

      expect(!refused.ok && refused.error.code).toBe('voice.queueFull')
      expect(!refused.ok && refused.error.kind).toBe('rateLimited')
      expect(!refused.ok && refused.error.details).toEqual({
        depth: 1,
        maxDepth: 1,
        retryAfterSeconds: 1,
      })
      expect(media.objectCount).toBe(1)
    })

    it('is judged on the box-wide depth too, across events', async () => {
      build({ maxQueuedVoices: 1, maxQueuedVoicesPerEvent: 20 })
      seedEvent()
      events.seed(
        anEvent({ id: 'event-2', slug: 'brunch', joinCode: 'BBBBBB', settings: VOICE_ON }),
      )
      await send(aRecording('a'), LEA, undefined, asEventId('event-2'))

      const refused = await send(aRecording('b'))

      expect(!refused.ok && refused.error.code).toBe('voice.queueFull')
      expect(MAX_QUEUED_VOICES).toBeGreaterThan(MAX_QUEUED_VOICES_PER_EVENT)
    })

    it('refuses what does not fit the event quota, with what is left, and writes nothing', async () => {
      seedEvent({ quotaBytes: 100_000 })
      photos.seed(aPhoto({ id: 'held', eventId: 'event-1', byteSize: 80_000 }))

      const result = await send(aRecording('a', 40_000))

      expect(!result.ok && result.error.code).toBe('event.quotaExceeded')
      expect(!result.ok && result.error.details).toEqual({ remaining: 20_000, required: 40_000 })
      expect(media.objectCount).toBe(0)
      expect(guestbook.all(EVENT)).toEqual([])
    })

    it('counts the voices already held in the quota: the reservation is charged from its first instant', async () => {
      seedEvent({ quotaBytes: 100_000 })
      await send(aRecording('a', 60_000), SAM)

      const result = await send(aRecording('b', 60_000), LEA)

      expect(!result.ok && result.error.code).toBe('event.quotaExceeded')
    })

    it('refuses on the ceiling the event’s client puts on all its events together', async () => {
      clients.seed(aClient({ id: 'client-1', ceilings: { maxTotalBytes: 50_000 } }))
      events.seed(
        anEvent({
          id: 'event-3',
          slug: 'gala',
          joinCode: 'CCCCCC',
          clientId: 'client-1',
          settings: VOICE_ON,
        }),
      )
      const eventId = asEventId('event-3')

      const first = await send(aRecording('a', 40_000), SAM, undefined, eventId)
      const second = await send(aRecording('b', 40_000), LEA, undefined, eventId)

      expect(first.ok).toBe(true)
      expect(!second.ok && second.error.code).toBe('client.storageFull')
      expect(media.objectCount).toBe(1)
    })
  })

  describe('the same recording sent again', () => {
    it('answers with the first message and stores nothing new, nor announces anything', async () => {
      const first = await send(aRecording('a'))
      bus.published.length = 0

      const again = await send(aRecording('a'))

      expect(again.ok && again.value.duplicate).toBe(true)
      expect(again.ok && first.ok && again.value.entry.id).toBe(first.ok && first.value.entry.id)
      expect(guestbook.all(EVENT)).toHaveLength(1)
      expect(media.objectCount).toBe(1)
      expect(bus.published).toEqual([])
    })

    it('answers it before the ceilings: a guest at their limit who retries is told “sent”', async () => {
      guestbook.seed(aGuestbookEntry({ id: 'w1', eventId: 'event-1', guestId: 'guest-lea' }))
      guestbook.seed(
        aGuestbookEntry({ id: 'w2', eventId: 'event-1', guestId: 'guest-lea', text: 'w2' }),
      )
      await send(aRecording('a'))

      const retry = await send(aRecording('a'))

      expect(retry.ok && retry.value.duplicate).toBe(true)
    })

    it('answers the retry of a request still holding its reservation with that reservation', async () => {
      const bytes = aRecording('r')
      const digest = ContentHash.create(hasher.sha256Hex(bytes))
      if (!digest.ok) throw new Error('fixture')
      guestbook.seed(
        aVoiceEntry({
          id: 'held',
          state: 'reserved',
          eventId: 'event-1',
          guestId: 'guest-lea',
          sourceHash: digest.value.value,
        }),
      )

      const result = await send(bytes)

      expect(result.ok && result.value.duplicate).toBe(true)
      expect(result.ok && result.value.entry.id).toBe('held')
    })

    it('lets two events each hold the same recording', async () => {
      events.seed(
        anEvent({ id: 'event-2', slug: 'brunch', joinCode: 'BBBBBB', settings: VOICE_ON }),
      )
      await send(aRecording('a'))

      const other = await send(aRecording('a'), LEA, undefined, asEventId('event-2'))

      expect(other.ok && other.value.duplicate).toBe(false)
    })

    it('lets a guest send again what a failed attempt could not save', async () => {
      const bytes = aRecording('f')
      const digest = ContentHash.create(hasher.sha256Hex(bytes))
      if (!digest.ok) throw new Error('fixture')
      guestbook.seed(
        aVoiceEntry({
          id: 'failed',
          state: 'failed',
          eventId: 'event-1',
          guestId: 'guest-lea',
          sourceHash: digest.value.value,
        }),
      )

      const result = await send(bytes)

      expect(result.ok && result.value.duplicate).toBe(false)
    })

    it('answers the race the transaction decides: two requests for the same bytes make one message', async () => {
      const [first, second] = await Promise.all([send(aRecording('p')), send(aRecording('p'))])

      const duplicates = [first, second].filter((result) => result.ok && result.value.duplicate)
      expect(duplicates).toHaveLength(1)
      expect(guestbook.all(EVENT)).toHaveLength(1)
    })
  })

  describe('when the bytes cannot be written', () => {
    it('gives the reservation back: the guest keeps their place and the digest is free again', async () => {
      media.failWritesAfter(0)

      const failed = await send(aRecording('a'))
      media.failWritesAfter(Number.POSITIVE_INFINITY)
      const retry = await send(aRecording('a'))

      expect(!failed.ok && failed.error.code).toBe('voice.stageFailed')
      expect(retry.ok && retry.value.duplicate).toBe(false)
      expect(guestbook.all(EVENT)).toHaveLength(1)
    })

    it('says nothing to the bus about a recording that is not on the disk', async () => {
      media.failWritesAfter(0)

      await send(aRecording('a'))

      expect(bus.published).toEqual([])
    })

    it('still gives the reservation back when the disk refuses to remove what it was asked to', async () => {
      media.failWritesAfter(0)
      media.failDeletes()

      const failed = await send(aRecording('a'))

      expect(!failed.ok && failed.error.code).toBe('voice.stageFailed')
      expect(guestbook.all(EVENT)).toEqual([])
      expect(logger.lines.some((line) => line.level === 'warn')).toBe(true)
    })

    it('gives the reservation back when the queue refuses the hand-over', async () => {
      const real = voices.saveVoice.bind(voices)
      voices.saveVoice = async () => {
        throw new Error('disk I/O error')
      }

      const failed = await send(aRecording('a'))
      voices.saveVoice = real

      expect(!failed.ok && failed.error.code).toBe('voice.stageFailed')
      expect(guestbook.all(EVENT)).toEqual([])
      expect(bus.published).toEqual([])
    })

    it('leaves the bytes alone when the reservation was already gone: they may be a re-send’s', async () => {
      voices.saveVoice = async () => false

      const failed = await send(aRecording('a'))

      expect(!failed.ok && failed.error.code).toBe('voice.stageFailed')
      // Nothing proves these bytes are still this request's, so they are left for the sweep.
      expect(media.objectCount).toBe(1)
      expect(bus.published).toEqual([])
    })
  })
})
