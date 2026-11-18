import { beforeEach, describe, expect, it } from 'vitest'
import type { ShareLink } from '../../../domain/gallery/shareLink'
import { asPhotoId } from '../../../domain/shared/ids'
import { AT, anEvent, aPhoto, atPlus } from '../../testing/builders'
import {
  buildGalleryWorld,
  GALA,
  OWNER,
  WEDDING,
  WEDDING_SLUG,
  type GalleryWorld,
} from '../../testing/galleryWorld'
import { grantArchive, grantMedia } from './galleryAccess'
import { makeDownloadGalleryArchive } from './downloadGalleryArchive'
import { makeGetGalleryMedia } from './getGalleryMedia'
import { makeListGalleryPhotos } from './listGalleryPhotos'
import { makeOpenGallery } from './openGallery'

/**
 * The shared gallery before and after the reveal of a disposable-camera evening (spec 23): a
 * valid link opens, shows nothing and says so by an empty list, every dead link is still
 * `gallery.notAvailable`, and the bytes follow the same gate.
 */

const HOUR = 60 * 60 * 1000
const P1 = asPhotoId('p1')

describe('the shared gallery and the reveal gate', () => {
  let world: GalleryWorld
  let link: ShareLink
  let token: string

  /** The wedding's reveal, `at` relative to the clock (AT): positive is the future. */
  const revealAt = (offsetMs: number | null, enabled = true): void => {
    world.events.seed(
      anEvent({
        id: WEDDING,
        ownerId: OWNER,
        slug: WEDDING_SLUG,
        status: 'closed',
        settings: {
          reveal: { enabled, at: offsetMs === null ? null : new Date(AT.getTime() + offsetMs) },
        },
      }),
    )
  }

  beforeEach(async () => {
    world = buildGalleryWorld()
    ;({ link, token } = world.seedLink())
    for (const photo of [
      aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', createdAt: atPlus(1) }),
      aPhoto({ id: 'p2', eventId: WEDDING, status: 'published', createdAt: atPlus(2) }),
      aPhoto({ id: 'pending', eventId: WEDDING, status: 'pending' }),
    ]) {
      world.photos.seed(photo)
      await world.storeMedia(photo)
    }
  })

  const list = () => makeListGalleryPhotos(world)({ token, unlockProof: null, cursor: null })
  const open = () => makeOpenGallery(world)({ token, unlockProof: null })
  const media = (variant: 'thumb' | 'display' = 'thumb') => {
    const grant = grantMedia(world.signer, link.id, P1, variant, atPlus(HOUR))
    return makeGetGalleryMedia(world)({
      linkId: grant.linkId,
      photoId: grant.photoId,
      variant: grant.variant,
      expiresAtMs: grant.expiresAt.getTime(),
      signature: grant.signature,
    })
  }
  const archive = async () => {
    const grant = grantArchive(world.signer, link.id, atPlus(HOUR))
    const result = await makeDownloadGalleryArchive(world)({
      linkId: grant.linkId,
      expiresAtMs: grant.expiresAt.getTime(),
      signature: grant.signature,
    })
    if (!result.ok) return result
    for await (const chunk of result.value.chunks) void chunk
    return result
  }

  it('opens a valid link before the reveal, with no photograph counted and a clock to say why', async () => {
    revealAt(60 * 60_000)

    const result = await open()

    expect(result.ok && result.value.photoCount).toBe(0)
    expect(result.ok && result.value.now).toEqual(AT)
    expect(result.ok && result.value.event.settings.reveal.enabled).toBe(true)
  })

  it('lists nothing before the reveal: no tile, no signed address, no cursor', async () => {
    revealAt(60 * 60_000)

    const result = await list()

    expect(result.ok && result.value.items).toEqual([])
    expect(result.ok && result.value.nextCursor).toBeNull()
  })

  it('refuses the bytes of a published photograph before the reveal, as a dead link does', async () => {
    revealAt(60 * 60_000)

    const result = await media()

    expect(!result.ok && result.error.code).toBe('gallery.notAvailable')
  })

  it('archives nothing before the reveal', async () => {
    revealAt(null)

    const result = await archive()

    expect(result.ok).toBe(true)
    expect(world.archive.names).toEqual([])
  })

  it('keeps a revoked or unknown link exactly as dead as before the mode existed', async () => {
    revealAt(60 * 60_000)
    world.shareLinks.seed(link.revoke(AT))

    const revoked = await makeOpenGallery(world)({ token, unlockProof: null })
    const unknown = await makeOpenGallery(world)({ token: 'nope', unlockProof: null })

    expect(!revoked.ok && revoked.error.code).toBe('gallery.notAvailable')
    expect(!unknown.ok && unknown.error.code).toBe('gallery.notAvailable')
  })

  it('shows everything published from the instant of the reveal, and still not what had no decision', async () => {
    revealAt(0)

    const opened = await open()
    const listed = await list()
    const bytes = await media()
    await archive()

    expect(opened.ok && opened.value.photoCount).toBe(2)
    expect(listed.ok && listed.value.items.map((item) => item.photo.id)).toEqual(['p2', 'p1'])
    expect(bytes.ok).toBe(true)
    expect(world.archive.names).toHaveLength(2)
  })

  it('is the gallery it always was when the mode is off', async () => {
    revealAt(60 * 60_000, false)

    const listed = await list()

    expect(listed.ok && listed.value.items).toHaveLength(2)
  })

  it('never reads another event’s photographs through this event’s gate', async () => {
    revealAt(-60_000)
    world.events.seed(
      anEvent({
        id: GALA,
        ownerId: OWNER,
        slug: 'gala-annuel',
        joinCode: 'Z3N9PT',
        settings: { reveal: { enabled: true, at: new Date(AT.getTime() + HOUR) } },
      }),
    )
    world.photos.seed(aPhoto({ id: 'gala-1', eventId: GALA, status: 'published' }))

    const listed = await list()

    expect(listed.ok && listed.value.items.map((item) => item.photo.id)).toEqual(['p2', 'p1'])
  })
})
