import { beforeEach, describe, expect, it } from 'vitest'
import { ShareLink } from '../../../domain/gallery/shareLink'
import { asShareLinkId } from '../../../domain/shared/ids'
import { AT, aClip, aPhoto, atPlus } from '../../testing/builders'
import {
  buildGalleryWorld,
  WEDDING,
  WEDDING_SLUG,
  type GalleryWorld,
} from '../../testing/galleryWorld'
import type { MediaStore } from '../../ports/mediaStore'
import { grantArchive } from './galleryAccess'
import {
  makeDownloadGalleryArchive,
  ShareLinkWithdrawnError,
  type DownloadGalleryArchiveInput,
} from './downloadGalleryArchive'

const HOUR = 60 * 60 * 1000

describe('downloadGalleryArchive', () => {
  let world: GalleryWorld
  let link: ShareLink

  const download = (input: DownloadGalleryArchiveInput) => makeDownloadGalleryArchive(world)(input)

  const signed = (
    expiresAt = atPlus(HOUR),
    under: ShareLink = link,
  ): DownloadGalleryArchiveInput => {
    const grant = grantArchive(world.signer, under.id, expiresAt)
    return {
      linkId: grant.linkId,
      expiresAtMs: grant.expiresAt.getTime(),
      signature: grant.signature,
    }
  }

  const drain = async (chunks: AsyncIterable<Uint8Array>): Promise<number> => {
    let count = 0
    for await (const chunk of chunks) count += chunk.length
    return count
  }

  beforeEach(async () => {
    world = buildGalleryWorld()
    link = world.seedLink().link
    for (const photo of [
      aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', createdAt: atPlus(1) }),
      aClip({ id: 'c1', eventId: WEDDING, status: 'published', createdAt: atPlus(2) }),
      aPhoto({ id: 'hidden', eventId: WEDDING, status: 'hidden' }),
      aPhoto({ id: 'pending', eventId: WEDDING, status: 'pending' }),
    ]) {
      world.photos.seed(photo)
      await world.storeMedia(photo)
    }
  })

  it('archives the published photographs and clips, as their downloads, and nothing else', async () => {
    const result = await download(signed())
    if (!result.ok) throw new Error(`expected an archive, got ${result.error.code}`)
    await drain(result.value.chunks)

    expect(result.value.event.id).toBe(WEDDING)
    expect(world.archive.names).toHaveLength(2)
    expect(world.archive.names[0]).toMatch(new RegExp(`^${WEDDING_SLUG}/0001-[0-9a-f]+[.]mp4$`))
    expect(world.archive.names[1]).toMatch(new RegExp(`^${WEDDING_SLUG}/0002-[0-9a-f]+[.]jpg$`))
  })

  it('aborts, rather than ends cleanly, when the link is revoked mid-download', async () => {
    // A ZIP that stops early but well-formed looks exactly like a complete album.
    const result = await download(signed())
    if (!result.ok) throw new Error('expected an archive')
    const chunks = result.value.chunks[Symbol.asyncIterator]()

    await chunks.next()
    await world.shareLinks.revokeCurrent(WEDDING, world.clock.now())

    await expect(chunks.next()).rejects.toBeInstanceOf(ShareLinkWithdrawnError)
    expect(world.archive.names).toHaveLength(1)
  })

  it('skips a photograph whose bytes are gone, and says so to the operator', async () => {
    world.photos.seed(
      aPhoto({ id: 'orphan', eventId: WEDDING, status: 'published', createdAt: atPlus(3) }),
    )

    const result = await download(signed())
    if (!result.ok) throw new Error('expected an archive')
    await drain(result.value.chunks)

    expect(world.archive.names).toHaveLength(2)
    expect(world.logger.lines.map((line) => line.level)).toEqual(['warn'])
  })

  it('skips a photograph whose bytes vanish between being sized and being read', async () => {
    // The retention purge is allowed to run while somebody is downloading.
    const vanishing: MediaStore = Object.assign(Object.create(world.media) as MediaStore, {
      openRead: async () => null,
    })

    const result = await makeDownloadGalleryArchive({ ...world, media: vanishing })(signed())
    if (!result.ok) throw new Error('expected an archive')
    await drain(result.value.chunks)

    expect(world.archive.names).toEqual([])
  })

  it.each<[string, (input: DownloadGalleryArchiveInput) => DownloadGalleryArchiveInput]>([
    ['a later expiry', (input) => ({ ...input, expiresAtMs: input.expiresAtMs + HOUR })],
    ['no signature', (input) => ({ ...input, signature: '' })],
  ])('refuses a URL with %s', async (_label, tamper) => {
    const result = await download(tamper(signed()))

    expect(!result.ok && result.error.code).toBe('gallery.notAvailable')
  })

  it('refuses a URL whose hour has run out', async () => {
    const input = signed()
    world.clock.advance(HOUR)

    const result = await download(input)

    expect(!result.ok && result.error.code).toBe('gallery.notAvailable')
  })

  it('refuses a URL for a link that has been revoked', async () => {
    const input = signed()
    await world.shareLinks.revokeCurrent(WEDDING, AT)

    const result = await download(input)

    expect(!result.ok && result.error.code).toBe('gallery.notAvailable')
  })

  it('refuses a correctly signed URL for a link that does not exist', async () => {
    const ghost = ShareLink.restore({ ...link.toProps(), id: asShareLinkId('link-ghost') })

    const result = await download(signed(atPlus(HOUR), ghost))

    expect(!result.ok && result.error.code).toBe('gallery.notAvailable')
  })
})
