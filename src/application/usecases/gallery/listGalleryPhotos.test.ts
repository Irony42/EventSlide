import { beforeEach, describe, expect, it } from 'vitest'
import { aClip, aPhoto, atPlus, AT } from '../../testing/builders'
import {
  buildGalleryWorld,
  GALA,
  STRANGER,
  WEDDING,
  type GalleryWorld,
} from '../../testing/galleryWorld'
import { isMediaGrantSigned, sealCursor } from './galleryAccess'
import { GALLERY_PAGE_SIZE, makeListGalleryPhotos } from './listGalleryPhotos'

const HOUR = 60 * 60 * 1000

describe('listGalleryPhotos', () => {
  let world: GalleryWorld

  const list = (token: string, cursor: string | null = null, unlockProof: string | null = null) =>
    makeListGalleryPhotos(world)({ token, unlockProof, cursor })

  beforeEach(() => {
    world = buildGalleryWorld()
  })

  it('lists the published photographs, newest first, and nothing the host kept back', async () => {
    const { token } = world.seedLink()
    world.photos.seed(
      aPhoto({ id: 'old', eventId: WEDDING, status: 'published', createdAt: atPlus(1) }),
      aPhoto({ id: 'new', eventId: WEDDING, status: 'published', createdAt: atPlus(2) }),
      aPhoto({ id: 'waiting', eventId: WEDDING, status: 'pending' }),
      aPhoto({ id: 'refused', eventId: WEDDING, status: 'rejected' }),
      aPhoto({ id: 'hidden', eventId: WEDDING, status: 'hidden' }),
    )

    const result = await list(token)

    expect(result.ok && result.value.items.map((item) => item.photo.id)).toEqual(['new', 'old'])
    expect(result.ok && result.value.nextCursor).toBeNull()
  })

  it('never lists another event’s photographs', async () => {
    const { token } = world.seedLink()
    world.photos.seed(aPhoto({ id: 'gala', eventId: GALA, status: 'published' }))

    const result = await list(token)

    expect(result.ok && result.value.items).toEqual([])
  })

  it('signs a preview, a view and a download for a photograph, each for this link', async () => {
    const { token, link } = world.seedLink()
    world.photos.seed(aPhoto({ id: 'p1', eventId: WEDDING, status: 'published' }))

    const result = await list(token)
    const item = result.ok ? result.value.items[0] : undefined
    if (item === undefined) throw new Error('expected one item')

    expect([item.preview.variant, item.view.variant, item.download.variant]).toEqual([
      'thumb',
      'display',
      'original',
    ])
    for (const grant of [item.preview, item.view, item.download]) {
      expect(grant.linkId).toBe(link.id)
      expect(grant.expiresAt).toEqual(atPlus(HOUR))
      expect(
        isMediaGrantSigned(
          world.signer,
          {
            linkId: grant.linkId,
            photoId: grant.photoId,
            variant: grant.variant,
            expiresAtMs: grant.expiresAt.getTime(),
          },
          grant.signature,
        ),
      ).toBe(true)
    }
  })

  it('signs a clip’s poster to look at and its transcode to download', async () => {
    const { token } = world.seedLink()
    world.photos.seed(aClip({ id: 'c1', eventId: WEDDING, status: 'published' }))

    const result = await list(token)
    const item = result.ok ? result.value.items[0] : undefined

    expect([item?.preview.variant, item?.view.variant, item?.download.variant]).toEqual([
      'poster',
      'poster',
      'video',
    ])
  })

  it('pages the album, and the cursor it hands out takes the next page', async () => {
    const { token } = world.seedLink()
    for (let index = 0; index <= GALLERY_PAGE_SIZE; index += 1) {
      world.photos.seed(
        aPhoto({
          id: `p${index}`,
          eventId: WEDDING,
          status: 'published',
          createdAt: atPlus(index),
        }),
      )
    }

    const first = await list(token)
    if (!first.ok || first.value.nextCursor === null) throw new Error('expected a second page')
    const second = await list(token, first.value.nextCursor)

    expect(first.value.items).toHaveLength(GALLERY_PAGE_SIZE)
    expect(second.ok && second.value.items.map((item) => item.photo.id)).toEqual(['p0'])
    expect(second.ok && second.value.nextCursor).toBeNull()
  })

  it('refuses a cursor it did not seal, before the repository sees it', async () => {
    const { token } = world.seedLink()

    const result = await list(token, 'bm90IGEgY3Vyc29y')

    expect(!result.ok && result.error.code).toBe('gallery.cursorInvalid')
  })

  it('refuses a cursor sealed for another link', async () => {
    const { token } = world.seedLink()
    const other = world.seedLink({ id: 'gala-link', eventId: GALA, createdBy: STRANGER })

    const result = await list(token, sealCursor(world.signer, other.link, 'bm90IGEgY3Vyc29y'))

    expect(!result.ok && result.error.code).toBe('gallery.cursorInvalid')
  })

  it('answers a dead link the way the gallery does', async () => {
    const { token } = world.seedLink({ revokedAt: AT })

    const result = await list(token)

    expect(!result.ok && result.error.code).toBe('gallery.notAvailable')
  })

  it('asks for the password before listing a protected album', async () => {
    const { token } = world.seedLink({ passwordHash: 'hash:les mariés de juin' })

    const result = await list(token)

    expect(!result.ok && result.error.code).toBe('gallery.passwordRequired')
  })
})
