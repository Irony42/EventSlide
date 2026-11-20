import { describe, expect, it } from 'vitest'
import { asChannelMediaJobId, asEventId, asPhotoId } from '../../../domain/shared/ids'
import { ok } from '../../../domain/shared/result'
import { aGuest } from '../../testing/builders'
import {
  aChannelScene,
  aMedia,
  aSender,
  BYTES,
  CONVERSATION,
  type ChannelScene,
} from '../../testing/channelScene'
import { MAX_ATTEMPTS, RETRY_BASE_MS, makeDrainChannelMedia } from './drainChannelMedia'

const EVENT = asEventId('event-1')
const JOB = asChannelMediaJobId('channel-job-1')
const signal = new AbortController().signal

/** A world with the conversation connected and one media received and waiting. */
const waiting = async (
  options: Parameters<typeof aChannelScene>[0] = {},
  media: Parameters<typeof aMedia>[0] = {},
): Promise<ChannelScene> => {
  const scene = aChannelScene(options)
  await scene.bindNow()
  scene.telegram.hold('file-1', BYTES)
  await scene.receive(aMedia(media))
  return scene
}

describe('drainChannelMedia: a photograph', () => {
  it('is idle when nothing is waiting', async () => {
    const scene = aChannelScene()

    expect(await scene.drain(signal)).toBe('idle')
  })

  it('stores it as the sender’s own photograph, acknowledges it, and counts it for the host', async () => {
    const scene = await waiting()

    expect(await scene.drain(signal)).toBe('stored')

    const guest = await scene.guestOf()
    expect(guest?.label()).toBe('Léa M.')
    expect(guest?.channelIdentity).toEqual({ channel: 'telegram', senderKey: 'key:telegram:42' })
    expect(scene.photoCalls).toEqual([
      {
        eventId: 'event-1',
        author: { kind: 'guest', guestId: guest?.id },
        files: [{ bytes: BYTES, declaredName: 'photo.jpg' }],
      },
    ])
    expect(scene.telegram.acknowledged).toEqual([
      { conversationRef: CONVERSATION, messageRef: 'm-1' },
    ])
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.receivedCount).toBe(1)
    expect(scene.telegram.said).toEqual([])
  })

  it('ends the job as done and forgets the name the channel showed', async () => {
    const scene = await waiting()

    await scene.drain(signal)

    const job = await scene.jobs.findById(EVENT, JOB)
    expect(job).toMatchObject({ status: 'done', failureCode: null, senderName: null })
  })

  it('downloads at most what an upload may weigh: the smaller of the ceiling and the channel’s', async () => {
    const scene = await waiting()

    await scene.drain(signal)

    expect(scene.telegram.downloads).toEqual([{ fileRef: 'file-1', maxBytes: 10_000 }])
  })

  it('finds the same guest for the same sender, and creates none twice', async () => {
    const scene = await waiting()
    await scene.drain(signal)
    await scene.receive(aMedia({ messageRef: 'm-2', fileRef: 'file-1' }))

    await scene.drain(signal)

    expect(scene.photoCalls.map((call) => call.author)).toEqual([
      scene.photoCalls[0]?.author,
      scene.photoCalls[0]?.author,
    ])
    expect(await scene.guests.list(EVENT)).toHaveLength(1)
  })

  it('renames the guest when the sender changed their name, and keeps it when the name is gone', async () => {
    const scene = await waiting()
    await scene.drain(signal)
    await scene.receive(
      aMedia({ messageRef: 'm-2', sender: aSender({ displayName: 'Léa Dupont' }) }),
    )
    await scene.drain(signal)

    expect((await scene.guestOf())?.label()).toBe('Léa D.')

    await scene.receive(aMedia({ messageRef: 'm-3', sender: aSender({ displayName: null }) }))
    await scene.drain(signal)

    expect((await scene.guestOf())?.label()).toBe('Léa D.')
  })

  it('leaves a sender without a name anonymous, and a message in the name of the group too', async () => {
    const scene = await waiting(
      {},
      { sender: aSender({ displayName: null, isAnonymous: true, ref: '-1001' }) },
    )

    await scene.drain(signal)

    expect((await scene.guestOf('-1001'))?.label()).toBeNull()
  })

  it('counts a photograph the event already had as a duplicate, and does not count it twice', async () => {
    const scene = await waiting()
    scene.answerPhotos(
      ok({
        outcomes: [
          { index: 0, declaredName: 'photo.jpg', kind: 'duplicate', photoId: asPhotoId('photo-1') },
        ],
        published: [],
      }),
    )

    expect(await scene.drain(signal)).toBe('duplicate')

    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.receivedCount).toBe(0)
    expect(scene.telegram.acknowledged).toHaveLength(1)
  })

  it('logs a counter per event and outcome, with no content', async () => {
    const scene = await waiting()

    await scene.drain(signal)

    expect(scene.logger.lines.filter((line) => line.message === 'channel.media')).toEqual([
      {
        level: 'info',
        message: 'channel.media',
        context: { eventId: 'event-1', outcome: 'stored' },
      },
    ])
  })
})

describe('drainChannelMedia: a video', () => {
  const video = { kind: 'video', fileRef: 'file-1', declaredName: 'clip.mp4' } as const

  it('sends a short video to the clip pipeline as it is, as the sender’s own', async () => {
    const scene = await waiting({}, { ...video, durationMs: 9_000 })

    expect(await scene.drain(signal)).toBe('stored')

    expect(scene.clipCalls).toEqual([
      {
        eventId: 'event-1',
        author: { kind: 'guest', guestId: (await scene.guestOf())?.id },
        file: { bytes: BYTES, declaredName: 'clip.mp4' },
        trim: null,
      },
    ])
    expect(scene.photoCalls).toEqual([])
    expect(scene.telegram.downloads[0]?.maxBytes).toBe(20_000)
  })

  it('keeps the first fifteen seconds of a longer one', async () => {
    const scene = await waiting({}, { ...video, durationMs: 120_000 })

    await scene.drain(signal)

    expect(scene.clipCalls[0]?.trim).toEqual({ startMs: 0, endMs: 15_000 })
  })

  it('counts a clip that was already there as a duplicate', async () => {
    const scene = await waiting({}, { ...video, durationMs: 9_000 })
    scene.answerClips(
      ok({
        clipJobId: scene.ids.clipJobId(),
        status: 'queued',
        photoId: asPhotoId('photo-2'),
        failureCode: null,
        duplicate: true,
      }),
    )

    expect(await scene.drain(signal)).toBe('duplicate')
  })

  it('refuses a video for an event that does not take clips, and says so', async () => {
    const scene = await waiting(
      { settings: { allowClips: false } },
      { ...video, durationMs: 9_000 },
    )

    expect(await scene.drain(signal)).toBe('refused')

    expect(scene.clipCalls).toEqual([])
    expect(scene.telegram.downloads).toEqual([])
    expect(scene.telegram.said[0]?.text).toContain('Les vidéos ne sont pas acceptées')
  })

  it('answers what the clip pipeline refused with, in words when a person can act on it', async () => {
    const scene = await waiting({}, { ...video, durationMs: 9_000 })
    scene.answerClips(scene.failedUpload('clip.queueFull'))

    expect(await scene.drain(signal)).toBe('refused')

    expect(scene.telegram.said[0]?.text).toContain('Doucement')
  })
})

describe('drainChannelMedia: what is refused before the download', () => {
  it('refuses a file declared heavier than the ceiling, and fetches nothing', async () => {
    const scene = await waiting({}, { declaredBytes: 10_001 })

    expect(await scene.drain(signal)).toBe('refused')

    expect(scene.telegram.downloads).toEqual([])
    expect(scene.telegram.said[0]?.text).toContain('trop lourd')
    const job = await scene.jobs.findById(EVENT, JOB)
    expect(job).toMatchObject({ status: 'failed', failureCode: 'channel.mediaTooLarge' })
  })

  it('refuses a document that is neither a picture nor a film', async () => {
    const scene = await waiting({}, { kind: 'document', declaredMimeType: 'application/pdf' })

    expect(await scene.drain(signal)).toBe('refused')

    expect(scene.telegram.said[0]?.text).toContain('Ce format de fichier')
  })

  it('takes a document that says it is an image', async () => {
    const scene = await waiting({}, { kind: 'document', declaredMimeType: 'image/png' })

    expect(await scene.drain(signal)).toBe('stored')
  })

  it('refuses when the event stopped accepting uploads since the message was queued', async () => {
    const scene = await waiting()
    const closed = scene.event.close(scene.clock.now())
    if (!closed.ok) throw new Error('close')
    scene.events.seed(closed.value)

    expect(await scene.drain(signal)).toBe('refused')

    expect(scene.photoCalls).toEqual([])
    expect(scene.telegram.said[0]?.text).toBe(
      "La soirée est terminée, elle n'accepte plus de photos.",
    )
  })

  it('refuses silently the media of a guest the host revoked since', async () => {
    const scene = await waiting()
    await scene.guests.save(
      aGuest({
        id: 'guest-lea',
        displayName: 'Léa M.',
        eventId: 'event-1',
        channelIdentity: { channel: 'telegram', senderKey: 'key:telegram:42' },
      }).revoke(scene.clock.now()),
    )

    expect(await scene.drain(signal)).toBe('refused')

    expect(scene.photoCalls).toEqual([])
    expect(scene.telegram.said).toEqual([])
    const job = await scene.jobs.findById(EVENT, JOB)
    expect(job?.failureCode).toBe('guest.revoked')
  })

  it('drops the job of a group that was unlinked since the message came', async () => {
    const scene = await waiting()
    const binding = await scene.bindings.findActive('telegram', CONVERSATION)
    if (binding === null) throw new Error('binding')
    await scene.bindings.save(binding.unbind(scene.clock.now()))

    expect(await scene.drain(signal)).toBe('skipped')

    expect(scene.photoCalls).toEqual([])
    expect(scene.telegram.downloads).toEqual([])
    expect(scene.telegram.said).toEqual([])
  })

  it('drops the job of an event that is gone', async () => {
    const scene = await waiting()
    await scene.events.delete(EVENT)

    expect(await scene.drain(signal)).toBe('skipped')
  })

  it('drops the job when this box has no adapter for its channel any more', async () => {
    const scene = await waiting()
    const drain = makeDrainChannelMedia({ ...scene.drainDeps, channels: new Map() })

    expect(await drain(signal)).toBe('skipped')
  })
})

describe('drainChannelMedia: the download', () => {
  it('tries again later when the network failed, up to three times in all, then gives up quietly', async () => {
    const scene = await waiting()
    const blink = { code: 'channel.downloadUnavailable', retryable: true }
    scene.telegram.failNextDownload(blink).failNextDownload(blink).failNextDownload(blink)

    expect(await scene.drain(signal)).toBe('retry')
    const waiting1 = await scene.jobs.findById(EVENT, JOB)
    expect(waiting1).toMatchObject({ status: 'queued', attempts: 1 })
    expect(waiting1?.availableAt).toEqual(new Date(scene.clock.now().getTime() + RETRY_BASE_MS))
    expect(await scene.drain(signal)).toBe('idle')

    scene.clock.advance(RETRY_BASE_MS)
    expect(await scene.drain(signal)).toBe('retry')
    const waiting2 = await scene.jobs.findById(EVENT, JOB)
    expect(waiting2?.availableAt).toEqual(new Date(scene.clock.now().getTime() + 2 * RETRY_BASE_MS))

    scene.clock.advance(2 * RETRY_BASE_MS)
    expect(MAX_ATTEMPTS).toBe(3)
    expect(await scene.drain(signal)).toBe('refused')
    expect(await scene.jobs.findById(EVENT, JOB)).toMatchObject({
      status: 'failed',
      failureCode: 'channel.downloadFailed',
    })
    expect(scene.telegram.said).toEqual([])
  })

  it('stores the media once the network is back', async () => {
    const scene = await waiting()
    scene.telegram.failNextDownload({ code: 'channel.downloadUnavailable', retryable: true })

    await scene.drain(signal)
    scene.clock.advance(RETRY_BASE_MS)

    expect(await scene.drain(signal)).toBe('stored')
  })

  it('stores nothing and recreates no guest when the sender erased themselves while the file travelled', async () => {
    const scene = await waiting()
    const job = await scene.jobs.findById(EVENT, JOB)
    const download = scene.telegram.download.bind(scene.telegram)
    scene.telegram.download = async (...args) => {
      const fetched = await download(...args)
      await scene.jobs.deleteBySender(EVENT, job?.senderKey ?? '')
      return fetched
    }

    expect(await scene.drain(signal)).toBe('skipped')

    expect(scene.photoCalls).toEqual([])
    expect(await scene.guestOf('42')).toBeNull()
    expect(scene.telegram.acknowledged).toEqual([])
  })

  it('gives up at once on a file that is gone, saying nothing', async () => {
    const scene = await waiting()
    scene.telegram.failNextDownload({ code: 'channel.fileGone', retryable: false })

    expect(await scene.drain(signal)).toBe('refused')

    expect(await scene.jobs.findById(EVENT, JOB)).toMatchObject({
      failureCode: 'channel.fileGone',
    })
    expect(scene.telegram.said).toEqual([])
  })

  it('says so when the file turns out heavier than it was declared', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    scene.telegram.hold('file-1', new Uint8Array(10_001))
    await scene.receive(aMedia({ declaredBytes: 10 }))

    expect(await scene.drain(signal)).toBe('refused')

    expect(scene.photoCalls).toEqual([])
    expect(scene.telegram.said[0]?.text).toContain('trop lourd')
  })
})

describe('drainChannelMedia: what the photograph pipeline says', () => {
  it.each([
    ['event.photoLimitReached', 'nombre maximal de photos'],
    ['event.quotaExceeded', 'album de cette soirée est plein'],
    ['image.unsupportedFormat', 'Ce format de fichier'],
  ])('answers a refusal %s in words a person can act on', async (code, words) => {
    const scene = await waiting()
    scene.answerPhotos(scene.refusedPhoto(code))

    expect(await scene.drain(signal)).toBe('refused')

    expect(scene.telegram.said[0]?.text).toContain(words)
    expect(scene.telegram.acknowledged).toEqual([])
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.receivedCount).toBe(0)
  })

  it('keeps a failure it has no words for in the log, as a code', async () => {
    const scene = await waiting()
    scene.answerPhotos(scene.refusedPhoto('photo.saveFailed'))

    await scene.drain(signal)

    expect(scene.telegram.said).toEqual([])
    expect(scene.logger.lines.at(-1)?.context).toEqual({
      eventId: 'event-1',
      outcome: 'refused',
      code: 'photo.saveFailed',
    })
  })

  it('refuses when the whole request failed, not only the file', async () => {
    const scene = await waiting()
    scene.answerPhotos(scene.failedUpload('event.notAcceptingUploads'))

    expect(await scene.drain(signal)).toBe('refused')

    expect(scene.telegram.said[0]?.text).toContain('La soirée est terminée')
  })

  it('tells a sender once an hour about the same refusal, however many media it touched', async () => {
    const scene = await waiting({ limits: { mediaPerMinute: 10 } })
    scene.answerPhotos(scene.refusedPhoto('event.photoLimitReached'))
    await scene.receive(aMedia({ messageRef: 'm-2' }))

    await scene.drain(signal)
    await scene.drain(signal)

    expect(scene.telegram.said).toHaveLength(1)
  })
})

describe('drainChannelMedia: the guests a channel creates', () => {
  it('creates a guest only for a media that was accepted', async () => {
    const scene = await waiting({}, { declaredBytes: 10_001 })

    await scene.drain(signal)

    expect(await scene.guests.list(EVENT)).toEqual([])
  })

  it('never reads another event’s guest for the same sender', async () => {
    const scene = await waiting()
    await scene.guests.save(
      aGuest({
        id: 'guest-elsewhere',
        eventId: 'event-9',
        channelIdentity: { channel: 'telegram', senderKey: 'key:telegram:42' },
      }),
    )

    await scene.drain(signal)

    expect((await scene.guestOf())?.id).not.toBe('guest-elsewhere')
    expect(await scene.guests.list(EVENT)).toHaveLength(1)
  })
})
