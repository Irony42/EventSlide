import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import request from 'supertest'
import { aPhoto, atPlus, anEvent, AT, aUser } from '../../../application/testing/builders'
import { InMemoryMediaStore } from '../../../application/testing/inMemoryMediaStore'
import { FakeGuestbookRepository } from '../../../application/testing/fakeGuestbookRepository'
import { FakeGuestRepository } from '../../../application/testing/fakeGuestRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { makeExportAlbum } from '../../../application/usecases/photos/exportAlbum'
import { MEDIA_VARIANTS } from '../../../application/ports/mediaStore'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { archiverWriter } from '../../../infrastructure/media/archiverWriter'
import { mediaRoutes } from '../routes/mediaRoutes'
import { buildGalleryHarness, WEDDING } from './galleryHarness'
import { buildHarness, signInAs } from './middlewareHarness'

/**
 * A real download, over a real socket, that the client walks away from.
 *
 * This is the one HTTP test that needs an open port: supertest buffers a response to its
 * end, and what is being asked is what the server does when the client stops reading and
 * closes the connection half-way. The writer under the routes is the **real** `archiverWriter`
 * — which is why this lives in `testing/`, the one place under `src/interface` that may
 * import an adapter — and the media store is counting every source it hands out and every
 * one that is closed. A fake archive writer here would prove nothing about a leak that
 * lives in the real one.
 *
 * **A count, because a leak is a count.** The route answers 200 with the right bytes
 * either way; only the sources still open afterwards tell them apart.
 */

/** Photographs in the album: far more than the writer may hold open at once. */
export const ALBUM_PHOTOS = 30

/** Big enough that each photograph is several chunks of the response, not one. */
const PHOTO_BYTES = 256 * 1024

/** What a file read hands over at a time, as a real filesystem stream does. */
const READ_CHUNK = 64 * 1024

export interface SourceCounts {
  /** Streams the media store handed out: each holds a file descriptor on a real disk. */
  opened: number
  /** Streams whose generator was closed, however it ended. */
  closed: number
}

export interface AbortableAlbum {
  readonly app: Express
  readonly counts: SourceCounts
  /** The path to GET, and the headers that authorise it. */
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
}

/**
 * Wraps `openRead` so a test can see how many sources are open, in place.
 *
 * Each source hands its bytes over in several chunks, as a file does. A store that gave a
 * photograph back in one chunk would finish on its own as soon as the writer had read it,
 * so a source nobody ever finished with would look closed and the leak would not show.
 */
const countOpenSources = (media: InMemoryMediaStore): SourceCounts => {
  const counts: SourceCounts = { opened: 0, closed: 0 }
  const openRead = media.openRead.bind(media)
  media.openRead = async (...args) => {
    const stream = await openRead(...args)
    if (stream === null) return null
    counts.opened += 1
    return (async function* () {
      try {
        for await (const chunk of stream) {
          for (let at = 0; at < chunk.length; at += READ_CHUNK) {
            yield chunk.subarray(at, at + READ_CHUNK)
          }
        }
      } finally {
        counts.closed += 1
      }
    })()
  }
  return counts
}

/** The shared gallery's `album.zip`, which anybody holding the link can start. */
export const galleryAlbum = async (): Promise<AbortableAlbum> => {
  const harness = buildGalleryHarness({}, { archive: archiverWriter })
  const counts = countOpenSources(harness.media)
  for (let index = 0; index < ALBUM_PHOTOS; index += 1) {
    const photo = aPhoto({
      id: `55555555-0000-4000-8000-${String(index).padStart(12, '0')}`,
      eventId: WEDDING,
      status: 'published',
      createdAt: atPlus(index),
    })
    await harness.seedPhoto(photo)
    await harness.media.put(WEDDING, photo.contentHash, 'original', new Uint8Array(PHOTO_BYTES))
  }

  const { token } = harness.seedLink()
  const opened = (await request(harness.app).get(`/api/gallery/${token}`).expect(200)).body as {
    archiveUrl: string
  }
  return { app: harness.app, counts, path: opened.archiveUrl, headers: {} }
}

/** The host's own `album.zip`, behind a session. */
export const hostAlbum = async (): Promise<AbortableAlbum> => {
  const HOST = 'host-id'
  const event = asEventId('wedding-id')
  const photos = new FakePhotoRepository()
  const media = new InMemoryMediaStore()
  const counts = countOpenSources(media)

  const harness = buildHarness({
    routes: (app, deps) => {
      app.post('/sign-in/host', signInAs({ userId: HOST, email: 'hote@example.test' }))
      app.use(
        mediaRoutes({
          deps,
          usecases: {
            getPhotoMedia: () => Promise.reject(new Error('not part of an album download')),
            identifyMediaViewer: () => Promise.reject(new Error('not part of an album download')),
            getVenuePhotoMedia: () => Promise.reject(new Error('not part of an album download')),
            exportAlbum: makeExportAlbum({
              events: deps.events,
              photos,
              guestbook: new FakeGuestbookRepository(),
              guests: new FakeGuestRepository(),
              media,
              archive: archiverWriter,
              logger: deps.logger,
            }),
          },
        }),
      )
    },
  })
  harness.users.seed(aUser({ id: asUserId(HOST), email: 'hote@example.test' }))
  harness.events.seed(
    anEvent({ id: event, slug: 'mariage', ownerId: HOST, joinCode: 'H7K2QM', status: 'closed' }),
  )
  harness.memberships.seed({
    eventId: event,
    userId: asUserId(HOST),
    role: 'moderator',
    grantedAt: AT,
  })
  for (let index = 0; index < ALBUM_PHOTOS; index += 1) {
    const photo = aPhoto({
      id: `photo-${String(index).padStart(3, '0')}`,
      eventId: event,
      status: 'published',
      createdAt: atPlus(index),
    })
    photos.seed(photo)
    for (const variant of MEDIA_VARIANTS) {
      await media.put(photo.eventId, photo.contentHash, variant, new Uint8Array(PHOTO_BYTES))
    }
  }

  const signedIn = await request(harness.app).post('/sign-in/host').expect(204)
  const cookies = signedIn.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [])
    .map((value) => String(value).split(';')[0] ?? '')
    .join('; ')
  return {
    app: harness.app,
    counts,
    path: '/events/mariage/album.zip',
    headers: { Cookie: cookie },
  }
}

/**
 * Starts the download, reads until `reached` says the writer is well into the album, then
 * destroys the connection — and resolves once the **server** has seen it close.
 *
 * Waiting on the server's own `close` is what makes the count afterwards mean something: a
 * test that sampled straight after the client hung up could read the counts before the
 * server had noticed, and would pass on a leak that had not happened yet.
 */
export const downloadAndAbandon = async (
  album: AbortableAlbum,
  reached: () => boolean,
): Promise<void> => {
  const server = http.createServer(album.app)
  const serverSawClose = new Promise<void>((resolve) => {
    server.on('request', (_req, res) => {
      res.once('close', () => resolve())
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  try {
    await new Promise<void>((resolve, reject) => {
      const outgoing = http.get(
        { host: '127.0.0.1', port, path: album.path, headers: { ...album.headers } },
        (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`the album answered ${String(response.statusCode)}`))
            response.destroy()
            return
          }
          response.on('data', () => {
            if (!reached()) return
            // The tab is closed: the socket goes, nobody reads the rest.
            response.destroy()
            resolve()
          })
          response.on('error', () => undefined)
        },
      )
      outgoing.on('error', () => undefined)
    })
    await serverSawClose
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
