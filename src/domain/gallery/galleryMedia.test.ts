import { describe, expect, it } from 'vitest'
import { PHOTO_STATUSES } from '../photos/photoStatus'
import { SERVED_VARIANTS } from '../photos/mediaVariant'
import { asEventId, asShareLinkId, asUserId } from '../shared/ids'
import {
  GALLERY_GRANT_TTL_MS,
  GALLERY_RENDITIONS,
  GALLERY_UNLOCK_TTL_MS,
  grantExpiresAt,
  isGalleryDownload,
  isGalleryVariant,
  isInSharedGallery,
  unlockExpiresAt,
} from './galleryMedia'
import { ShareLink } from './shareLink'
import { ShareLinkLifetime } from './shareLinkLifetime'

const AT = new Date('2026-06-21T10:00:00.000Z')
const HOUR = 60 * 60 * 1000

const linkExpiringIn = (days: number, now = AT): ShareLink => {
  const lifetime = ShareLinkLifetime.create(days)
  if (!lifetime.ok) throw new Error('fixture lifetime refused')
  const created = ShareLink.create(
    {
      eventId: asEventId('mariage'),
      tokenDigest: 'b'.repeat(64),
      passwordHash: null,
      createdBy: asUserId('hote'),
      lifetime: lifetime.value,
    },
    asShareLinkId('link-1'),
    now,
  )
  if (!created.ok) throw new Error('fixture link refused')
  return created.value
}

describe('which photographs a shared gallery shows', () => {
  it('shows what the wall shows, and nothing the host kept off it', () => {
    // `hidden` is the case worth naming: the host's own ZIP keeps it (`isInAlbum`), and a
    // link sent to every guest must not, because "take it off the wall" was a decision
    // about who sees it.
    expect(PHOTO_STATUSES.filter(isInSharedGallery)).toEqual(['published'])
  })
})

describe('which renditions a shared gallery serves', () => {
  it('downloads the stored original of a photograph, never a smaller rendition', () => {
    expect(GALLERY_RENDITIONS.photo.download).toBe('original')
    expect(isGalleryDownload('photo', 'original')).toBe(true)
  })

  it('downloads the transcode of a clip, because a clip has no original', () => {
    expect(GALLERY_RENDITIONS.clip.download).toBe('video')
    expect(isGalleryDownload('clip', 'video')).toBe(true)
  })

  it('serves a preview inline rather than as an attachment', () => {
    expect(isGalleryDownload('photo', 'thumb')).toBe(false)
    expect(isGalleryDownload('photo', 'display')).toBe(false)
    expect(isGalleryDownload('clip', 'poster')).toBe(false)
  })

  it('serves no rendition a row of that kind does not have', () => {
    const photo = SERVED_VARIANTS.filter((variant) => isGalleryVariant('photo', variant))
    const clip = SERVED_VARIANTS.filter((variant) => isGalleryVariant('clip', variant))

    expect(photo).toEqual(['original', 'display', 'thumb'])
    expect(clip).toEqual(['video', 'poster'])
  })
})

describe('how long a grant lasts', () => {
  it('lets a signed media URL live an hour', () => {
    expect(grantExpiresAt(AT, linkExpiringIn(30))).toEqual(new Date(AT.getTime() + HOUR))
    expect(GALLERY_GRANT_TTL_MS).toBe(HOUR)
  })

  it('lets an entered password last two hours', () => {
    expect(unlockExpiresAt(AT, linkExpiringIn(30))).toEqual(new Date(AT.getTime() + 2 * HOUR))
    expect(GALLERY_UNLOCK_TTL_MS).toBe(2 * HOUR)
  })

  it('never lets a grant outlive the link it was granted under', () => {
    // A link created a day ago with one day to run has half an hour left: neither a media
    // URL nor an unlock may promise more than that.
    const link = linkExpiringIn(1, new Date(AT.getTime() - 24 * HOUR + HOUR / 2))

    expect(grantExpiresAt(AT, link)).toEqual(link.expiresAt)
    expect(unlockExpiresAt(AT, link)).toEqual(link.expiresAt)
  })
})
