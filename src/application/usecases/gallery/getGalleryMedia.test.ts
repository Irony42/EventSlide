import { beforeEach, describe, expect, it } from 'vitest'
import { ShareLink } from '../../../domain/gallery/shareLink'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { asPhotoId, asShareLinkId, type PhotoId } from '../../../domain/shared/ids'
import { AT, aClip, aPhoto, aUser, atPlus } from '../../testing/builders'
import {
  buildGalleryWorld,
  GALA,
  OWNER,
  WEDDING,
  WEDDING_SLUG,
  type GalleryWorld,
} from '../../testing/galleryWorld'
import { grantMedia } from './galleryAccess'
import { makeGetGalleryMedia, type GetGalleryMediaInput } from './getGalleryMedia'

const HOUR = 60 * 60 * 1000
const P1 = asPhotoId('p1')

describe('getGalleryMedia', () => {
  let world: GalleryWorld
  let link: ShareLink

  const get = (input: GetGalleryMediaInput) => makeGetGalleryMedia(world)(input)

  /** What the listing would have handed out for this photograph, this rendition. */
  const signed = (
    variant: ServedVariant = 'original',
    photoId: PhotoId = P1,
    under: ShareLink = link,
  ): GetGalleryMediaInput => {
    const grant = grantMedia(world.signer, under.id, photoId, variant, atPlus(HOUR))
    return {
      linkId: grant.linkId,
      photoId: grant.photoId,
      variant: grant.variant,
      expiresAtMs: grant.expiresAt.getTime(),
      signature: grant.signature,
    }
  }

  const refusal = async (input: GetGalleryMediaInput) => {
    const result = await get(input)
    return result.ok ? null : result.error.code
  }

  beforeEach(async () => {
    world = buildGalleryWorld()
    link = world.seedLink().link
    const photo = aPhoto({ id: 'p1', eventId: WEDDING, status: 'published' })
    world.photos.seed(photo)
    await world.storeMedia(photo)
  })

  it('serves the full-resolution original as an attachment named by the server', async () => {
    const result = await get(signed('original'))
    if (!result.ok) throw new Error(`expected media, got ${result.error.code}`)

    expect(result.value.disposition).toBe('attachment')
    expect(result.value.variant).toBe('original')
    expect(result.value.fileName).toMatch(new RegExp(`^${WEDDING_SLUG}-[0-9a-f]+\\.jpg$`))
    expect(result.value.expiresAt).toEqual(atPlus(HOUR))
    const bytes = await result.value.open()
    const chunks: number[] = []
    for await (const chunk of bytes ?? []) chunks.push(...chunk)
    expect(chunks).toEqual([1, 2, 3])
  })

  it('serves a grid tile inline, under no file name', async () => {
    const result = await get(signed('thumb'))

    expect(result.ok && result.value.disposition).toBe('inline')
    expect(result.ok && result.value.fileName).toBeNull()
  })

  it('serves a clip’s transcode as an .mp4 attachment and its poster inline', async () => {
    const clip = aClip({ id: 'c1', eventId: WEDDING, status: 'published' })
    world.photos.seed(clip)
    await world.storeMedia(clip)

    const video = await get(signed('video', asPhotoId('c1')))
    const poster = await get(signed('poster', asPhotoId('c1')))

    expect(video.ok && video.value.fileName).toMatch(/\.mp4$/)
    expect(video.ok && video.value.disposition).toBe('attachment')
    expect(poster.ok && poster.value.disposition).toBe('inline')
  })

  describe('a URL that was tampered with', () => {
    it.each<[string, (input: GetGalleryMediaInput) => GetGalleryMediaInput]>([
      ['another photograph', (input) => ({ ...input, photoId: asPhotoId('p2') })],
      ['another rendition', (input) => ({ ...input, variant: 'display' })],
      ['another link', (input) => ({ ...input, linkId: asShareLinkId('link-other') })],
      ['a later expiry', (input) => ({ ...input, expiresAtMs: input.expiresAtMs + 24 * HOUR })],
      ['no signature', (input) => ({ ...input, signature: '' })],
    ])('refuses one pointed at %s', async (_label, tamper) => {
      world.photos.seed(aPhoto({ id: 'p2', eventId: WEDDING, status: 'published' }))

      expect(await refusal(tamper(signed('original')))).toBe('gallery.notAvailable')
    })

    it('refuses a signature for another link, even for a photograph that link could show', async () => {
      const gala = world.seedLink({ id: 'gala-link', eventId: GALA, createdBy: 'user-stranger' })
      const galaPhoto = aPhoto({ id: 'g1', eventId: GALA, status: 'published' })
      world.photos.seed(galaPhoto)
      await world.storeMedia(galaPhoto)

      // Signed under the gala's link, then presented as the wedding's.
      const input = { ...signed('original', asPhotoId('g1'), gala.link), linkId: link.id }

      expect(await refusal(input)).toBe('gallery.notAvailable')
    })
  })

  it('refuses a properly signed URL for a photograph in another event', async () => {
    // Signed by this server, under the wedding's link, for a gala photograph id: the
    // photograph is looked up in the link's event and never in the one the id belongs to.
    const galaPhoto = aPhoto({ id: 'g1', eventId: GALA, status: 'published' })
    world.photos.seed(galaPhoto)
    await world.storeMedia(galaPhoto)

    expect(await refusal(signed('original', asPhotoId('g1')))).toBe('gallery.notAvailable')
  })

  it('refuses a URL whose hour has run out', async () => {
    const input = signed('original')
    world.clock.advance(HOUR)

    expect(await refusal(input)).toBe('gallery.notAvailable')
  })

  it('refuses every URL of a link the moment it is revoked, not when they expire', async () => {
    const input = signed('original')

    await world.shareLinks.revokeCurrent(WEDDING, world.clock.now())

    expect(await refusal(input)).toBe('gallery.notAvailable')
  })

  it('refuses every URL of a link whose creator was switched off', async () => {
    const input = signed('original')

    await world.users.save(aUser({ id: OWNER, email: 'hote@example.test', disabledAt: AT }))

    expect(await refusal(input)).toBe('gallery.notAvailable')
  })

  it('refuses a URL for a link that does not exist, however it was signed', async () => {
    const ghost = ShareLink.restore({ ...link.toProps(), id: asShareLinkId('link-ghost') })
    const input = signed('original', P1, ghost)

    expect(await refusal(input)).toBe('gallery.notAvailable')
  })

  it.each<PhotoStatus>(['hidden', 'rejected', 'pending'])(
    'refuses a photograph that is %s by the time its URL is used',
    async (status) => {
      const input = signed('original')

      world.photos.seed(aPhoto({ id: 'p1', eventId: WEDDING, status }))

      expect(await refusal(input)).toBe('gallery.notAvailable')
    },
  )

  it('refuses a photograph that was deleted after its URL was handed out', async () => {
    const input = signed('original')

    await world.photos.delete(WEDDING, P1)

    expect(await refusal(input)).toBe('gallery.notAvailable')
  })

  it('refuses a rendition this kind of row does not have, even when signed', async () => {
    expect(await refusal(signed('video'))).toBe('gallery.notAvailable')
  })

  it('reports a published photograph whose bytes are gone as missing media', async () => {
    world.photos.seed(aPhoto({ id: 'p3', eventId: WEDDING, status: 'published' }))

    expect(await refusal(signed('original', asPhotoId('p3')))).toBe('photo.mediaMissing')
  })
})
