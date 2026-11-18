import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId, asGuestbookEntryId, asPhotoId } from '../../../domain/shared/ids'
import { MEDIA_VARIANTS, STAGED_SOURCE } from '../../../domain/photos/mediaVariant'
import {
  aClip,
  aClipJob,
  aGuest,
  aGuestbookEntry,
  anEvent,
  aPhoto,
  aReaction,
  aVoiceEntry,
  type PhotoInput,
} from '../../testing/builders'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from '../../testing/fakeGuestbookVoiceRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeEraseGuestContribution, type EraseGuestContribution } from './eraseGuestContribution'

const EVENT = asEventId('event-1')
const OTHER_EVENT = asEventId('event-2')
const LEA = asGuestId('guest-lea')
const SAM = asGuestId('guest-sam')

describe('eraseGuestContribution', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let guests: FakeGuestRepository
  let reactions: FakeReactionRepository
  let clips: FakeClipJobRepository
  let guestbook: FakeGuestbookRepository
  let media: InMemoryMediaStore
  let bus: RecordingEventBus
  let erase: EraseGuestContribution

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    guests = new FakeGuestRepository(photos)
    reactions = new FakeReactionRepository()
    clips = new FakeClipJobRepository()
    guestbook = new FakeGuestbookRepository()
    const clock = new FakeClock()
    media = new InMemoryMediaStore(clock)
    bus = new RecordingEventBus()
    events.seed(anEvent({ id: 'event-1' }))
    guests.seed(aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }))
    guests.seed(aGuest({ id: 'guest-sam', eventId: 'event-1' }))
    erase = makeEraseGuestContribution({
      events,
      guests,
      photos,
      reactions,
      clips,
      guestbook,
      voices: new FakeGuestbookVoiceRepository(guestbook),
      media,
      bus,
      clock,
    })
  })

  const seedPhoto = async (input: PhotoInput) => {
    const photo = input.clip === undefined ? aPhoto(input) : aClip(input)
    photos.seed(photo)
    for (const variant of MEDIA_VARIANTS) {
      await media.put(photo.eventId, photo.contentHash, variant, Uint8Array.of(1))
    }
    return photo
  }

  const run = (guestId = LEA, eventId = EVENT) => erase({ eventId, guestId })

  it('removes every photo of the guest whatever its status, files and rows, and announces each', async () => {
    const pending = await seedPhoto({
      id: 'p1',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-lea' },
      status: 'pending',
    })
    const published = await seedPhoto({
      id: 'p2',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-lea' },
      status: 'published',
    })

    const result = await run()

    expect(result).toEqual({ ok: true, value: { photos: 2, clips: 0, messages: 0 } })
    expect(await photos.findById(EVENT, pending.id)).toBeNull()
    expect(await photos.findById(EVENT, published.id)).toBeNull()
    expect(media.variantsOf(EVENT, published.contentHash)).toEqual([])
    expect(bus.published.filter((e) => e.type === 'photo.deleted')).toHaveLength(2)
    expect(bus.published.at(-1)).toEqual({ type: 'guest.erased', eventId: EVENT, guestId: LEA })
  })

  it('ignores the self-delete switch and the grace window', async () => {
    events.seed(anEvent({ id: 'event-1', settings: { allowGuestSelfDelete: false } }))
    await seedPhoto({
      id: 'p1',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-lea' },
      status: 'published',
    })

    const result = await run()

    expect(result.ok).toBe(true)
    expect(await photos.findById(EVENT, asPhotoId('p1'))).toBeNull()
  })

  it('leaves other guests and host photos alone', async () => {
    const samPhoto = await seedPhoto({
      id: 'p3',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-sam' },
    })
    const hostPhoto = await seedPhoto({
      id: 'p4',
      eventId: 'event-1',
      author: { kind: 'host', id: 'user-1' },
    })
    await seedPhoto({ id: 'p1', eventId: 'event-1', author: { kind: 'guest', id: 'guest-lea' } })

    await run()

    expect(await photos.findById(EVENT, samPhoto.id)).not.toBeNull()
    expect(await photos.findById(EVENT, hostPhoto.id)).not.toBeNull()
    expect(await guests.findById(EVENT, SAM)).not.toBeNull()
  })

  it('removes the guest row, which is where the display name lives', async () => {
    await run()

    expect(await guests.findById(EVENT, LEA)).toBeNull()
  })

  it("removes their reactions on other photos and keeps everyone else's", async () => {
    const samPhoto = await seedPhoto({
      id: 'p3',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-sam' },
    })
    reactions.seed(
      aReaction({
        id: 'r1',
        eventId: 'event-1',
        photoId: 'p3',
        guestId: 'guest-lea',
        kind: 'love',
      }),
      aReaction({
        id: 'r2',
        eventId: 'event-1',
        photoId: 'p3',
        guestId: 'guest-sam',
        kind: 'love',
      }),
    )

    await run()

    expect((await reactions.countsFor(EVENT, samPhoto.id)).love).toBe(1)
  })

  it('counts a transcoded clip as a clip and retires its job', async () => {
    await seedPhoto({
      id: 'c1',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-lea' },
      clip: {},
    })
    await clips.stage(
      aClipJob({
        id: 'job-done',
        eventId: 'event-1',
        status: 'done',
        photoId: 'c1',
        author: { kind: 'guest', id: 'guest-lea' },
      }),
      { quotaBytes: 1e12, maxQueuedClips: 10, maxQueuedClipsPerEvent: 10 },
    )

    const result = await run()

    expect(result).toEqual({ ok: true, value: { photos: 0, clips: 1, messages: 0 } })
    expect(await clips.listByAuthor(EVENT, LEA)).toEqual([])
  })

  it('deletes the staged source of a clip still in the queue, and its job', async () => {
    const job = aClipJob({
      id: 'job-q',
      eventId: 'event-1',
      status: 'queued',
      author: { kind: 'guest', id: 'guest-lea' },
    })
    await clips.stage(job, { quotaBytes: 1e12, maxQueuedClips: 10, maxQueuedClipsPerEvent: 10 })
    await media.put(EVENT, job.sourceHash, 'source', Uint8Array.of(1))

    const result = await run()

    expect(result).toEqual({ ok: true, value: { photos: 0, clips: 1, messages: 0 } })
    expect(media.variantsOf(EVENT, job.sourceHash)).toEqual([])
    expect(await clips.findById(EVENT, job.id)).toBeNull()
  })

  it('is scoped to the event: the same guest id elsewhere is not found', async () => {
    events.seed(anEvent({ id: 'event-2', slug: 'gala-acme', joinCode: '2AB3CD' }))
    const result = await run(LEA, OTHER_EVENT)

    expect(!result.ok && result.error.code).toBe('guest.notFound')
    expect(await guests.findById(EVENT, LEA)).not.toBeNull()
  })

  it('answers event.notFound for an event that is gone', async () => {
    const result = await run(LEA, asEventId('nope'))

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('works on a closed event: erasing is not uploading', async () => {
    events.seed(anEvent({ id: 'event-1', status: 'closed' }))
    await seedPhoto({ id: 'p1', eventId: 'event-1', author: { kind: 'guest', id: 'guest-lea' } })

    expect((await run()).ok).toBe(true)
  })

  it('erases a guest whose photographs span more than one page of the album', async () => {
    for (let n = 0; n < 205; n += 1) {
      photos.seed(
        aPhoto({
          id: `bulk-${n}`,
          eventId: 'event-1',
          author: { kind: 'guest', id: 'guest-lea' },
          createdAt: new Date(Date.UTC(2026, 5, 1, 12, 0, n)),
        }),
      )
    }

    const result = await run()

    expect(result).toEqual({ ok: true, value: { photos: 205, clips: 0, messages: 0 } })
    expect((await photos.list(EVENT)).items).toEqual([])
  })

  it('keeps a clip poster written seconds ago, which another guest transcode may be about to name, and removes the clip own bytes at once', async () => {
    const clip = await seedPhoto({
      id: 'c-fresh',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-lea' },
      clip: {},
    })
    const [mp4, poster] = clip.storageHashes
    if (mp4 === undefined || poster === undefined) throw new Error('a clip has two digests')
    await media.put(EVENT, poster, 'poster', Uint8Array.of(1))

    await run()

    expect(media.variantsOf(EVENT, poster)).toEqual(['poster'])
    expect(media.variantsOf(EVENT, mp4)).toEqual([])
  })

  it('also removes a clip inserted after the queued jobs were retired, right up to the guest row', async () => {
    const late = aClip({
      id: 'c-late',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-lea' },
    })
    const original = reactions.deleteByGuest.bind(reactions)
    reactions.deleteByGuest = async (eventId, guestId) => {
      await original(eventId, guestId)
      photos.seed(late)
      await media.put(EVENT, late.contentHash, 'original', Uint8Array.of(1))
    }

    const result = await run()

    expect(result.ok).toBe(true)
    expect(media.variantsOf(EVENT, late.contentHash)).toEqual([])
    expect(bus.published).toContainEqual({
      type: 'photo.deleted',
      eventId: EVENT,
      photoId: late.id,
    })
  })

  it('unlinks the source of a failed job, which the recovery sweep abandons without removing', async () => {
    const job = aClipJob({
      id: 'job-failed',
      eventId: 'event-1',
      status: 'failed',
      author: { kind: 'guest', id: 'guest-lea' },
    })
    await clips.stage(job, { quotaBytes: 1e12, maxQueuedClips: 10, maxQueuedClipsPerEvent: 10 })
    await media.put(EVENT, job.sourceHash, 'source', Uint8Array.of(1))

    const result = await run()

    expect(result).toEqual({ ok: true, value: { photos: 0, clips: 0, messages: 0 } })
    expect(media.variantsOf(EVENT, job.sourceHash)).toEqual([])
  })

  it('keeps a source digest that a row of the event still names', async () => {
    const job = aClipJob({
      id: 'job-failed',
      eventId: 'event-1',
      status: 'failed',
      author: { kind: 'guest', id: 'guest-lea' },
    })
    await clips.stage(job, { quotaBytes: 1e12, maxQueuedClips: 10, maxQueuedClipsPerEvent: 10 })
    await media.put(EVENT, job.sourceHash, 'source', Uint8Array.of(1))
    photos.seed(
      aPhoto({
        id: 'p-other',
        eventId: 'event-1',
        author: { kind: 'guest', id: 'guest-sam' },
        contentHash: job.sourceHash.value,
      }),
    )

    await run()

    expect(media.variantsOf(EVENT, job.sourceHash)).toEqual(['source'])
  })

  it('refuses on a purge-held event with the generic failure deletePhoto answers, and touches nothing', async () => {
    const photo = await seedPhoto({
      id: 'p1',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-lea' },
    })
    await events.setPurgeHeld(EVENT, new Date(0))

    const result = await run()

    expect(!result.ok && result.error.code).toBe('photo.deleteFailed')
    expect(await photos.findById(EVENT, photo.id)).not.toBeNull()
    expect(await guests.findById(EVENT, LEA)).not.toBeNull()
    expect(media.variantsOf(EVENT, photo.contentHash)).not.toEqual([])
    expect(bus.published).toEqual([])
  })

  it('never touches a photograph the operator took down: not deleted, not counted, bytes kept, guest row kept without its name', async () => {
    const down = await seedPhoto({
      id: 'p-down',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-lea' },
    })
    await seedPhoto({ id: 'p-up', eventId: 'event-1', author: { kind: 'guest', id: 'guest-lea' } })
    await photos.setTakenDown(EVENT, down.id, new Date(0))

    const result = await run()

    expect(result).toEqual({ ok: true, value: { photos: 1, clips: 0, messages: 0 } })
    expect(media.variantsOf(EVENT, down.contentHash)).not.toEqual([])
    expect((await photos.locate(down.id))?.takenDownAt).not.toBeNull()
    expect(bus.published.filter((e) => e.type === 'photo.deleted')).toHaveLength(1)
    const kept = await guests.findById(EVENT, LEA)
    expect(kept).not.toBeNull()
    expect(kept?.label()).toBeNull()
  })

  describe('the guestbook', () => {
    const entryOf = (id: string, guestId: string, eventId = 'event-1') =>
      aGuestbookEntry({ id, guestId, eventId, text: id })
    const GUESTBOOK_EVENT = asEventId('event-1')

    it('removes every message of the guest whatever its status, counts them, and announces the change', async () => {
      const published = aGuestbookEntry({ id: 'm1', guestId: 'guest-lea', moderation: 'auto' })
      guestbook.seed(published, entryOf('m2', 'guest-lea'))

      const result = await run()

      expect(result).toEqual({ ok: true, value: { photos: 0, clips: 0, messages: 2 } })
      expect(guestbook.all(GUESTBOOK_EVENT)).toEqual([])
      expect(bus.published.map((e) => e.type)).toContain('guestbook.changed')
    })

    it('ignores the self-delete switch for messages as it does for photographs', async () => {
      events.seed(anEvent({ id: 'event-1', settings: { allowGuestSelfDelete: false } }))
      guestbook.seed(aGuestbookEntry({ id: 'm1', guestId: 'guest-lea', moderation: 'auto' }))

      const result = await run()

      expect(result.ok && result.value.messages).toBe(1)
    })

    it('leaves the messages of another guest and of another event alone', async () => {
      guestbook.seed(
        entryOf('m1', 'guest-lea'),
        entryOf('m-sam', 'guest-sam'),
        entryOf('m-other', 'guest-lea', 'event-2'),
      )

      await run()

      expect(guestbook.all(GUESTBOOK_EVENT).map((row) => row.id)).toEqual(['m-sam'])
      expect(guestbook.all(OTHER_EVENT).map((row) => row.id)).toEqual(['m-other'])
    })

    it('announces nothing about messages when there were none', async () => {
      await run()

      expect(bus.published.map((e) => e.type)).not.toContain('guestbook.changed')
    })

    it('keeps a message the operator took down, uncounted, and keeps the guest row without its name', async () => {
      guestbook.seed(entryOf('m-down', 'guest-lea'), entryOf('m-up', 'guest-lea'))
      guestbook.takeDown(GUESTBOOK_EVENT, asGuestbookEntryId('m-down'), new Date(0))

      const result = await run()

      expect(result.ok && result.value.messages).toBe(1)
      expect(guestbook.all(GUESTBOOK_EVENT).map((row) => row.id)).toEqual(['m-down'])
      const kept = await guests.findById(EVENT, LEA)
      expect(kept).not.toBeNull()
      expect(kept?.label()).toBeNull()
    })

    it('keeps every message on a purge-held event and fails generically', async () => {
      guestbook.seed(entryOf('m1', 'guest-lea'))
      await events.setPurgeHeld(EVENT, new Date(0))

      const result = await run()

      expect(!result.ok && result.error.code).toBe('photo.deleteFailed')
      expect(guestbook.all(GUESTBOOK_EVENT)).toHaveLength(1)
    })
  })

  describe('the voice messages (spec 25)', () => {
    const VOICE_EVENT = asEventId('event-1')
    const bytesOf = (seed: number): Uint8Array => new Uint8Array([seed, seed, seed])

    /** A recording the box finished: the output is on the disk under its digest. */
    const seedReady = async (id: string, guestId: string, eventId = 'event-1') => {
      const entry = aVoiceEntry({ id, guestId, eventId, state: 'ready', moderation: 'auto' })
      guestbook.seed(entry)
      const hash = entry.voice?.audioHash
      if (hash === null || hash === undefined) throw new Error('fixture')
      await media.put(entry.eventId, hash, 'voice', bytesOf(1))
      return { entry, hash }
    }

    /** A recording still being processed: its source is on the disk. */
    const seedQueued = async (id: string, guestId: string, sourceHash?: string) => {
      const entry = aVoiceEntry({
        id,
        guestId,
        eventId: 'event-1',
        state: 'queued',
        ...(sourceHash === undefined ? {} : { sourceHash }),
      })
      guestbook.seed(entry)
      const hash = entry.voice?.sourceHash
      if (hash === undefined) throw new Error('fixture')
      await media.put(entry.eventId, hash, STAGED_SOURCE, bytesOf(2))
      return { entry, hash }
    }

    it('takes the output of a recording with it, the row and the bytes, and counts it as a message', async () => {
      const { hash } = await seedReady('v1', 'guest-lea')

      const result = await run()

      expect(result).toEqual({ ok: true, value: { photos: 0, clips: 0, messages: 1 } })
      expect(guestbook.all(VOICE_EVENT)).toEqual([])
      expect(await media.exists(VOICE_EVENT, hash, 'voice')).toBe(false)
      expect(media.objectCount).toBe(0)
    })

    it('takes the source of a recording the worker has not finished with it', async () => {
      const { hash } = await seedQueued('v1', 'guest-lea')

      await run()

      expect(await media.exists(VOICE_EVENT, hash, STAGED_SOURCE)).toBe(false)
      expect(guestbook.all(VOICE_EVENT)).toEqual([])
    })

    it('deletes the bytes while the row that names them is still there, never the other way round', async () => {
      await seedReady('v1', 'guest-lea')
      await seedQueued('v2', 'guest-lea')
      const rowsWhenBytesWent: number[] = []
      const deleteBytes = media.delete.bind(media)
      media.delete = async (...args) => {
        rowsWhenBytesWent.push(guestbook.all(VOICE_EVENT).length)
        return deleteBytes(...args)
      }

      await run()

      expect(rowsWhenBytesWent).toEqual([2, 2])
    })

    it('stops with the rows still in place when a recording cannot be deleted, so pressing the button again finishes', async () => {
      await seedReady('v1', 'guest-lea')
      media.failDeletes()

      await expect(run()).rejects.toThrow()

      expect(guestbook.all(VOICE_EVENT)).toHaveLength(1)
      expect(await guests.findById(EVENT, LEA)).not.toBeNull()
    })

    it('leaves the bytes of a fresh attempt alone when the guest’s own failed voice names the same digest', async () => {
      const failed = aVoiceEntry({
        id: 'v-failed',
        guestId: 'guest-lea',
        eventId: 'event-1',
        state: 'failed',
      })
      guestbook.seed(failed)
      const digest = failed.voice?.sourceHash.value
      if (digest === undefined) throw new Error('fixture')
      // Sam's attempt at the very same bytes, which a failed voice does not block.
      const { hash } = await seedQueued('v-sam', 'guest-sam', digest)

      const result = await run()

      expect(result.ok && result.value.messages).toBe(1)
      expect(await media.exists(VOICE_EVENT, hash, STAGED_SOURCE)).toBe(true)
      expect(guestbook.all(VOICE_EVENT).map((row) => row.id)).toEqual(['v-sam'])
    })

    it('keeps the file another guest’s recording still names when two came out as the same bytes', async () => {
      const lea = await seedReady('v-lea', 'guest-lea')
      const sam = aVoiceEntry({
        id: 'v-sam',
        guestId: 'guest-sam',
        eventId: 'event-1',
        state: 'ready',
        audioHash: lea.hash.value,
      })
      guestbook.seed(sam)

      await run()

      expect(guestbook.all(VOICE_EVENT).map((row) => row.id)).toEqual(['v-sam'])
      expect(await media.exists(VOICE_EVENT, lea.hash, 'voice')).toBe(true)
    })

    it('leaves the recordings of another guest and of another event alone', async () => {
      await seedReady('v-lea', 'guest-lea')
      const sam = await seedReady('v-sam', 'guest-sam')
      guests.seed(aGuest({ id: 'guest-lea', eventId: 'event-2' }))
      const other = await seedReady('v-other', 'guest-lea', 'event-2')

      await run()

      expect(guestbook.all(VOICE_EVENT).map((row) => row.id)).toEqual(['v-sam'])
      expect(await media.exists(VOICE_EVENT, sam.hash, 'voice')).toBe(true)
      expect(guestbook.all(OTHER_EVENT).map((row) => row.id)).toEqual(['v-other'])
      expect(await media.exists(OTHER_EVENT, other.hash, 'voice')).toBe(true)
    })

    it('keeps a recording the operator took down, with its bytes, which are evidence', async () => {
      const { hash } = await seedReady('v-down', 'guest-lea')
      guestbook.takeDown(VOICE_EVENT, asGuestbookEntryId('v-down'), new Date(0))

      const result = await run()

      expect(result.ok && result.value.messages).toBe(0)
      expect(guestbook.all(VOICE_EVENT)).toHaveLength(1)
      expect(await media.exists(VOICE_EVENT, hash, 'voice')).toBe(true)
    })

    it('touches no byte on a purge-held event, and fails generically', async () => {
      const { hash } = await seedReady('v1', 'guest-lea')
      await events.setPurgeHeld(EVENT, new Date(0))

      const result = await run()

      expect(!result.ok && result.error.code).toBe('photo.deleteFailed')
      expect(await media.exists(VOICE_EVENT, hash, 'voice')).toBe(true)
      expect(guestbook.all(VOICE_EVENT)).toHaveLength(1)
    })

    it('tells the console, which reads voices on a signal of its own, and not only the wall', async () => {
      await seedReady('v1', 'guest-lea')

      await run()

      expect(bus.published.map((event) => event.type)).toContain('guestbook.voice')
    })

    it('says nothing on that signal when the guest had no recording', async () => {
      guestbook.seed(aGuestbookEntry({ id: 'm1', guestId: 'guest-lea', moderation: 'auto' }))

      await run()

      expect(bus.published.map((event) => event.type)).not.toContain('guestbook.voice')
    })
  })
})
