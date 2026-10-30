import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId, asPhotoId } from '../../../domain/shared/ids'
import { MEDIA_VARIANTS } from '../../ports/mediaStore'
import {
  aClip,
  aClipJob,
  aGuest,
  anEvent,
  aPhoto,
  aReaction,
  type PhotoInput,
} from '../../testing/builders'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
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
  let media: InMemoryMediaStore
  let bus: RecordingEventBus
  let erase: EraseGuestContribution

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    guests = new FakeGuestRepository(photos)
    reactions = new FakeReactionRepository()
    clips = new FakeClipJobRepository()
    media = new InMemoryMediaStore()
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
      media,
      bus,
      clock: new FakeClock(),
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

    expect(result).toEqual({ ok: true, value: { photos: 2, clips: 0 } })
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

    expect(result).toEqual({ ok: true, value: { photos: 0, clips: 1 } })
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

    expect(result).toEqual({ ok: true, value: { photos: 0, clips: 1 } })
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

    expect(result).toEqual({ ok: true, value: { photos: 205, clips: 0 } })
    expect((await photos.list(EVENT)).items).toEqual([])
  })
})
