import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import { asEventId, asGuestId, asPhotoId, asUserId } from '../shared/ids'
import type { EventId, PhotoId } from '../shared/ids'
import type { Result } from '../shared/result'
import { Caption } from './caption'
import { ContentHash } from './contentHash'
import { Dimensions } from './dimensions'
import { Photo } from './photo'
import type { NewPhoto, PhotoActor, PhotoAuthor, Reviewer } from './photo'

const MARIAGE = asEventId('evt-mariage')
const ANNIVERSAIRE = asEventId('evt-anniversaire')
const FIRST_PHOTO = asPhotoId('pho-1')
const SECOND_PHOTO = asPhotoId('pho-2')
const CAMILLE = asGuestId('gst-camille')
const JULES = asGuestId('gst-jules')
const CLAIRE = asUserId('usr-claire')
const MARC = asUserId('usr-marc')

const UPLOADED_AT = new Date('2026-06-13T20:00:00.000Z')
const DECIDED_AT = new Date('2026-06-13T20:05:00.000Z')
const GRACE_MS = 15 * 60 * 1000
const LAST_MOMENT_OF_GRACE = new Date(UPLOADED_AT.getTime() + GRACE_MS)
const AFTER_GRACE = new Date(UPLOADED_AT.getTime() + GRACE_MS + 1)

const guestAuthor: PhotoAuthor = { kind: 'guest', guestId: CAMILLE }
const hostAuthor: PhotoAuthor = { kind: 'host', userId: CLAIRE }
const theAuthor: PhotoActor = { kind: 'guest', guestId: CAMILLE }
const anotherGuest: PhotoActor = { kind: 'guest', guestId: JULES }
const theHost: PhotoActor = { kind: 'host', userId: CLAIRE }
const anotherHost: PhotoActor = { kind: 'host', userId: MARC }
const byTheHost: Reviewer = { kind: 'host', userId: CLAIRE }
const automatically: Reviewer = { kind: 'automatic' }

const unwrap = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`invalid fixture: ${result.error.code}`)
  return result.value
}

const A_SIZE = unwrap(Dimensions.create(4032, 3024))

const hashOf = (fill: string): ContentHash =>
  unwrap(ContentHash.create(fill.repeat(ContentHash.hexLength)))

const captionOf = (text: string): Caption => unwrap(Caption.create(text))

interface PhotoOverrides {
  readonly id?: PhotoId
  readonly eventId?: EventId
  readonly author?: PhotoAuthor
  readonly contentHash?: ContentHash
  readonly caption?: Caption | null
  readonly byteSize?: number
}

const createPhoto = (overrides: PhotoOverrides = {}): Result<Photo, DomainError> =>
  Photo.create(
    {
      eventId: overrides.eventId ?? MARIAGE,
      author: overrides.author ?? guestAuthor,
      contentHash: overrides.contentHash ?? hashOf('a'),
      dimensions: A_SIZE,
      byteSize: overrides.byteSize ?? 2_400_000,
      caption: overrides.caption ?? null,
    },
    overrides.id ?? FIRST_PHOTO,
    UPLOADED_AT,
  )

const aPendingPhoto = (overrides: PhotoOverrides = {}): Photo => unwrap(createPhoto(overrides))

const aPublishedPhoto = (overrides: PhotoOverrides = {}): Photo =>
  unwrap(aPendingPhoto(overrides).publish(byTheHost, DECIDED_AT))

const aRejectedPhoto = (overrides: PhotoOverrides = {}): Photo =>
  unwrap(aPendingPhoto(overrides).reject(byTheHost, DECIDED_AT))

const aHiddenPhoto = (overrides: PhotoOverrides = {}): Photo =>
  unwrap(aPublishedPhoto(overrides).hide(byTheHost, DECIDED_AT))

describe('Photo.create', () => {
  it('carries the identity, author and bytes it was ingested with', () => {
    const ingested: NewPhoto = {
      eventId: MARIAGE,
      author: guestAuthor,
      contentHash: hashOf('b'),
      dimensions: A_SIZE,
      byteSize: 2_400_000,
      caption: captionOf('Vive les mariés'),
    }

    const photo = unwrap(Photo.create(ingested, FIRST_PHOTO, UPLOADED_AT))

    expect({
      id: photo.id,
      eventId: photo.eventId,
      author: photo.author,
      contentHash: photo.contentHash,
      dimensions: photo.dimensions,
      byteSize: photo.byteSize,
      caption: photo.caption,
      createdAt: photo.createdAt,
    }).toEqual({
      id: FIRST_PHOTO,
      eventId: MARIAGE,
      author: guestAuthor,
      contentHash: ingested.contentHash,
      dimensions: A_SIZE,
      byteSize: 2_400_000,
      caption: ingested.caption,
      createdAt: UPLOADED_AT,
    })
  })

  it('starts pending with no decision on record, even when the event auto-publishes', () => {
    // Auto-publish is the use case calling `publish` straight afterwards with an
    // `automatic` reviewer, so nothing ever reaches the wall undecided.
    const photo = aPendingPhoto()

    expect([photo.status, photo.review]).toEqual(['pending', null])
  })

  it('accepts a one-byte file, the smallest thing the media store can have written', () => {
    const result = createPhoto({ byteSize: 1 })

    expect(result.ok && result.value.byteSize).toBe(1)
  })

  it.each([0, -1, 1.5])('refuses a byte size of %s, since a stored file has bytes', (byteSize) => {
    const result = createPhoto({ byteSize })

    expect(!result.ok && result.error.code).toBe('photo.byteSizeInvalid')
  })
})

describe('Photo moderation', () => {
  it('publishes a pending photo onto the wall', () => {
    const result = aPendingPhoto().publish(byTheHost, DECIDED_AT)

    expect(result.ok && result.value.status).toBe('published')
  })

  it('publishes a rejected photo when the host changes their mind', () => {
    const result = aRejectedPhoto().publish(byTheHost, DECIDED_AT)

    expect(result.ok && result.value.status).toBe('published')
  })

  it('puts a hidden photo back on the wall', () => {
    const result = aHiddenPhoto().publish(byTheHost, DECIDED_AT)

    expect(result.ok && result.value.status).toBe('published')
  })

  it('accepts publishing an already published photo, so a double click is not an error', () => {
    const result = aPublishedPhoto().publish(byTheHost, DECIDED_AT)

    expect(result.ok && result.value.status).toBe('published')
  })

  it('rejects a pending photo', () => {
    const result = aPendingPhoto().reject(byTheHost, DECIDED_AT)

    expect(result.ok && result.value.status).toBe('rejected')
  })

  it('rejects a published photo that was approved by mistake', () => {
    const result = aPublishedPhoto().reject(byTheHost, DECIDED_AT)

    expect(result.ok && result.value.status).toBe('rejected')
  })

  it('hides a published photo, taking it off the wall but leaving it in the album', () => {
    const result = aPublishedPhoto().hide(byTheHost, DECIDED_AT)

    expect(result.ok && result.value.status).toBe('hidden')
  })

  it('refuses to hide a pending photo, which has never been on the wall', () => {
    const result = aPendingPhoto().hide(byTheHost, DECIDED_AT)

    expect(!result.ok && result.error.code).toBe('photo.illegalTransition')
  })

  it('refuses to hide a rejected photo instead of quietly reviving it', () => {
    const result = aRejectedPhoto().hide(byTheHost, DECIDED_AT)

    expect(!result.ok && result.error.code).toBe('photo.illegalTransition')
  })

  it('reports an illegal transition as a conflict, so the HTTP layer answers 409', () => {
    const result = aPendingPhoto().hide(byTheHost, DECIDED_AT)

    expect(!result.ok && result.error.kind).toBe('conflict')
  })

  it('records the host who decided, so a host can answer how a photo got on the wall', () => {
    const published = unwrap(aPendingPhoto().publish(byTheHost, DECIDED_AT))

    expect(published.review).toEqual({ kind: 'host', userId: CLAIRE, at: DECIDED_AT })
  })

  it('records an automatic decision with no user, keeping it distinct from a host one', () => {
    const published = unwrap(aPendingPhoto().publish(automatically, DECIDED_AT))

    expect(published.review).toEqual({ kind: 'automatic', at: DECIDED_AT })
  })

  it('leaves the original instance pending, so a caller can still offer an undo', () => {
    const pending = aPendingPhoto()

    unwrap(pending.publish(byTheHost, DECIDED_AT))

    expect(pending.status).toBe('pending')
  })
})

describe('Photo.isAuthoredBy', () => {
  it('recognises the guest who sent the photo', () => {
    expect(aPendingPhoto().isAuthoredBy(theAuthor)).toBe(true)
  })

  it('does not mistake another guest for the author', () => {
    expect(aPendingPhoto().isAuthoredBy(anotherGuest)).toBe(false)
  })

  it('recognises the host who uploaded from the venue camera roll', () => {
    expect(aPendingPhoto({ author: hostAuthor }).isAuthoredBy(theHost)).toBe(true)
  })

  it('does not mistake another host for the uploading host', () => {
    expect(aPendingPhoto({ author: hostAuthor }).isAuthoredBy(anotherHost)).toBe(false)
  })

  it('never matches a guest against a host-authored photo, whatever the ids read like', () => {
    expect(aPendingPhoto({ author: hostAuthor }).isAuthoredBy(theAuthor)).toBe(false)
  })

  it('never matches a host against a guest-authored photo', () => {
    expect(aPendingPhoto().isAuthoredBy(theHost)).toBe(false)
  })
})

describe('Photo.isWithinAuthorGrace', () => {
  it('still counts a photo on the last millisecond of the window', () => {
    expect(aPendingPhoto().isWithinAuthorGrace(LAST_MOMENT_OF_GRACE, GRACE_MS)).toBe(true)
  })

  it('closes the window one millisecond later', () => {
    expect(aPendingPhoto().isWithinAuthorGrace(AFTER_GRACE, GRACE_MS)).toBe(false)
  })
})

describe('Photo.canBeDeletedBy', () => {
  it('lets a host delete a photo already on the wall, long after the upload', () => {
    expect(aPublishedPhoto().canBeDeletedBy(theHost, AFTER_GRACE, GRACE_MS)).toBe(true)
  })

  it('lets the author take back a pending photo inside the window', () => {
    expect(aPendingPhoto().canBeDeletedBy(theAuthor, LAST_MOMENT_OF_GRACE, GRACE_MS)).toBe(true)
  })

  it('lets the author take back a rejected photo inside the window', () => {
    expect(aRejectedPhoto().canBeDeletedBy(theAuthor, LAST_MOMENT_OF_GRACE, GRACE_MS)).toBe(true)
  })

  it('refuses the author a published photo: pulling it off the wall is the host call', () => {
    expect(aPublishedPhoto().canBeDeletedBy(theAuthor, LAST_MOMENT_OF_GRACE, GRACE_MS)).toBe(false)
  })

  it('refuses the author a hidden photo, which the album still counts on', () => {
    expect(aHiddenPhoto().canBeDeletedBy(theAuthor, LAST_MOMENT_OF_GRACE, GRACE_MS)).toBe(false)
  })

  it('refuses the author once the window has closed', () => {
    expect(aPendingPhoto().canBeDeletedBy(theAuthor, AFTER_GRACE, GRACE_MS)).toBe(false)
  })

  it('refuses a guest who did not send the photo', () => {
    expect(aPendingPhoto().canBeDeletedBy(anotherGuest, LAST_MOMENT_OF_GRACE, GRACE_MS)).toBe(false)
  })
})

describe('Photo.canCaptionBeEditedBy', () => {
  it('lets a host recaption a photo at any time', () => {
    expect(aPublishedPhoto().canCaptionBeEditedBy(theHost, AFTER_GRACE, GRACE_MS)).toBe(true)
  })

  it('lets the author fix a typo while the photo is still pending', () => {
    const photo = aPendingPhoto()

    expect(photo.canCaptionBeEditedBy(theAuthor, LAST_MOMENT_OF_GRACE, GRACE_MS)).toBe(true)
  })

  it('refuses the author once the photo is published, because the room has read it', () => {
    const photo = aPublishedPhoto()

    expect(photo.canCaptionBeEditedBy(theAuthor, LAST_MOMENT_OF_GRACE, GRACE_MS)).toBe(false)
  })

  it('refuses the author once the window has closed', () => {
    expect(aPendingPhoto().canCaptionBeEditedBy(theAuthor, AFTER_GRACE, GRACE_MS)).toBe(false)
  })

  it('refuses a guest who did not send the photo', () => {
    const photo = aPendingPhoto()

    expect(photo.canCaptionBeEditedBy(anotherGuest, LAST_MOMENT_OF_GRACE, GRACE_MS)).toBe(false)
  })
})

describe('Photo.withCaption', () => {
  it('sets a caption on a photo that had none', () => {
    const captioned = aPendingPhoto().withCaption(captionOf('Vive les mariés'))

    expect(captioned.caption?.value).toBe('Vive les mariés')
  })

  it('clears a caption the guest thought better of', () => {
    const cleared = aPendingPhoto({ caption: captionOf('Oups') }).withCaption(null)

    expect(cleared.caption).toBeNull()
  })

  it('leaves the original instance captioned as it was, like every other transition', () => {
    const photo = aPendingPhoto({ caption: captionOf('Oups') })

    photo.withCaption(null)

    expect(photo.caption?.value).toBe('Oups')
  })
})

describe('Photo.isDuplicateOf', () => {
  it('treats the same bytes in the same event as a retry rather than a second photo', () => {
    const first = aPendingPhoto({ contentHash: hashOf('c') })
    const retry = aPendingPhoto({ contentHash: hashOf('c'), id: SECOND_PHOTO })

    expect(retry.isDuplicateOf(first)).toBe(true)
  })

  it('treats the same bytes in another event as its own photo: each event owns its copy', () => {
    const atTheWedding = aPendingPhoto({ contentHash: hashOf('c') })
    const atTheBirthday = aPendingPhoto({ contentHash: hashOf('c'), eventId: ANNIVERSAIRE })

    expect(atTheBirthday.isDuplicateOf(atTheWedding)).toBe(false)
  })

  it('treats different bytes in the same event as different photos', () => {
    const first = aPendingPhoto({ contentHash: hashOf('c') })
    const second = aPendingPhoto({ contentHash: hashOf('d'), id: SECOND_PHOTO })

    expect(second.isDuplicateOf(first)).toBe(false)
  })
})

describe('Photo identity', () => {
  it('considers two instances of the same photo equal, whatever changed around them', () => {
    const pending = aPendingPhoto()
    const published = aPublishedPhoto()

    expect(published.equals(pending)).toBe(true)
  })

  it('considers two different photos different', () => {
    expect(aPendingPhoto({ id: SECOND_PHOTO }).equals(aPendingPhoto())).toBe(false)
  })

  it('round-trips through restore, so a repository rehydrates exactly what it stored', () => {
    const caption = captionOf('Vive les mariés')
    const stored = aPublishedPhoto({ caption })

    // A copy of the props, not the props themselves: `toProps` hands back its own
    // object, so restoring from it and then comparing the two would compare one
    // object with itself and pass whatever `restore` did.
    const rehydrated = Photo.restore({ ...stored.toProps() })

    expect({
      id: rehydrated.id,
      eventId: rehydrated.eventId,
      author: rehydrated.author,
      status: rehydrated.status,
      contentHash: rehydrated.contentHash,
      dimensions: rehydrated.dimensions,
      byteSize: rehydrated.byteSize,
      caption: rehydrated.caption,
      createdAt: rehydrated.createdAt,
      review: rehydrated.review,
    }).toEqual({
      id: FIRST_PHOTO,
      eventId: MARIAGE,
      author: guestAuthor,
      status: 'published',
      contentHash: hashOf('a'),
      dimensions: A_SIZE,
      byteSize: 2_400_000,
      caption,
      createdAt: UPLOADED_AT,
      review: { kind: 'host', userId: CLAIRE, at: DECIDED_AT },
    })
  })

  it('rehydrates a photo the rest of the domain treats as the same one', () => {
    const stored = aHiddenPhoto()

    expect(Photo.restore(stored.toProps()).equals(stored)).toBe(true)
  })
})
