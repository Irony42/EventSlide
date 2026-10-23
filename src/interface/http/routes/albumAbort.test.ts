import { describe, expect, it, vi } from 'vitest'
import {
  ALBUM_PHOTOS,
  downloadAndAbandon,
  galleryAlbum,
  hostAlbum,
  type AbortableAlbum,
} from '../testing/albumAbortHarness'

/**
 * Ring 4: a client that closes the tab in the middle of an album download.
 *
 * Both routes stream a ZIP built by the real `archiver`, and the route answers 200 with
 * the right bytes whether or not the box is left holding a file open for every photograph
 * that was queued behind the one being sent. So the assertion is on the sources: how many
 * the media store handed out, and how many have been closed since the server saw the
 * connection go. Measured before the fix, on a 60-photograph album over real files, 55
 * were still open; on the counting store here, all but one of thirty.
 *
 * Anybody who can start an album download can do this to the box — a host, and the
 * holder of a shared gallery link, which is nobody in particular.
 */

const abandonIntoTheAlbum = async (album: AbortableAlbum): Promise<void> => {
  // The first chunks are a ZIP header, written before any source is asked for its bytes.
  await downloadAndAbandon(album, () => album.counts.opened >= 3)
}

describe.each([
  ['GET /api/gallery-media/:linkId/album.zip, for anybody holding the link', galleryAlbum],
  ['GET /events/:eventSlug/album.zip, for the host', hostAlbum],
])('%s', (_route, build) => {
  it('closes every source it opened when the client abandons the download', async () => {
    const album = await build()

    await abandonIntoTheAlbum(album)

    await vi.waitFor(() => expect(album.counts.closed).toBe(album.counts.opened), {
      timeout: 2_000,
    })
    expect(album.counts.opened).toBeGreaterThanOrEqual(3)
  })

  it('does not open the album’s photographs ahead of the client reading them', async () => {
    // What was opened by the time the client left is what the writer's buffers held: a
    // few photographs, never the thirty that were queued before the fix.
    const album = await build()

    await abandonIntoTheAlbum(album)

    await vi.waitFor(() => expect(album.counts.closed).toBe(album.counts.opened), {
      timeout: 2_000,
    })
    expect(album.counts.opened).toBeLessThan(ALBUM_PHOTOS / 2)
  })
})
