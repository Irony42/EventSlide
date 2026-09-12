import { describe, expect, it } from 'vitest'
import {
  joinUrl,
  mediaUrl,
  toEventDto,
  toEventSettingsDto,
  toGuestDto,
  toGuestPhotoDto,
  toModerationPhotoDto,
  toPublicEventDto,
  toSessionUserDto,
  type PresenterContext,
} from './presenters'
import { AT, aGuest, aPhoto, aUser, anEvent } from '../../../application/testing/builders'

const context: PresenterContext = {
  publicUrl: 'https://photos.example.com',
  uploadLimits: { maxBytes: 25_000_000, maxFiles: 20 },
}

describe('joinUrl', () => {
  it('puts the code in the path, not a query parameter', () => {
    // 1.0 emitted `?partyname=` on the QR page and read `?party` on the upload page,
    // so every guest silently uploaded to the default event. A path segment cannot be
    // misspelled by one side without the route failing loudly.
    expect(joinUrl(context.publicUrl, 'H7K2QM')).toBe('https://photos.example.com/join/H7K2QM')
  })

  it('encodes a code that would otherwise change the path', () => {
    expect(joinUrl(context.publicUrl, 'A/B?C')).toBe('https://photos.example.com/join/A%2FB%3FC')
  })
})

describe('mediaUrl', () => {
  it('builds an event-scoped, variant-specific path', () => {
    expect(mediaUrl('mariage', 'photo-1', 'thumb')).toBe('/api/events/mariage/photos/photo-1/thumb')
  })

  it('encodes both the slug and the photo id', () => {
    expect(mediaUrl('a b', 'c/d', 'display')).toBe('/api/events/a%20b/photos/c%2Fd/display')
  })
})

describe('toPublicEventDto', () => {
  const event = anEvent({
    slug: 'mariage',
    name: 'Camille & Sacha',
    joinCode: 'H7K2QM',
    quotaBytes: 5_000_000_000,
    ownerId: 'host-1',
    settings: { allowCaptions: true, allowReactions: false, maxPhotosPerGuest: 30 },
  })

  it('tells a guest the name and what they are allowed to do', () => {
    expect(toPublicEventDto(event, context)).toEqual({
      slug: 'mariage',
      name: 'Camille & Sacha',
      allowCaptions: true,
      allowReactions: false,
      maxUploadBytes: 25_000_000,
      maxFilesPerUpload: 20,
    })
  })

  it.each(['joinCode', 'quotaBytes', 'ownerId', 'photoCount', 'settings', 'retentionDays'])(
    'never exposes %s to a guest',
    (field) => {
      // A guest holding the join code learns the event's name and its two guest-facing
      // toggles. Everything else — who owns it, how full it is, how long it is kept —
      // is none of their business, and a leak here would be permanent once printed on
      // a card.
      expect(Object.keys(toPublicEventDto(event, context))).not.toContain(field)
    },
  )
})

describe('toEventDto', () => {
  const input = {
    event: anEvent({
      id: 'event-1',
      slug: 'mariage',
      name: 'Camille & Sacha',
      joinCode: 'H7K2QM',
      status: 'live' as const,
      quotaBytes: 5_000_000_000,
      startsAt: AT,
    }),
    role: 'owner' as const,
    counts: { photoCount: 42, pendingCount: 7, guestCount: 18, usedBytes: 900_000 },
  }

  it('gives a host the join code and the link behind the QR code', () => {
    const dto = toEventDto(input, context)

    expect(dto.joinCode).toBe('H7K2QM')
    expect(dto.joinUrl).toBe('https://photos.example.com/join/H7K2QM')
  })

  it('carries the counts the dashboard shows', () => {
    const dto = toEventDto(input, context)

    expect(dto).toMatchObject({
      photoCount: 42,
      pendingCount: 7,
      guestCount: 18,
      usedBytes: 900_000,
      quotaBytes: 5_000_000_000,
      role: 'owner',
      status: 'live',
    })
  })

  it('serialises timestamps as ISO strings', () => {
    const dto = toEventDto(input, context)

    expect(dto.createdAt).toBe(AT.toISOString())
    expect(dto.startsAt).toBe(AT.toISOString())
  })

  it('renders an absent timestamp as null rather than omitting the key', () => {
    // The client destructures these; an absent key and a null are different shapes to
    // handle, and one of them would be missed.
    const dto = toEventDto(
      { ...input, event: anEvent({ slug: 'mariage', status: 'live', startsAt: null }) },
      context,
    )

    expect(dto.startsAt).toBeNull()
    expect(dto.closedAt).toBeNull()
  })

  it('stamps closedAt for a closed event', () => {
    const dto = toEventDto(
      { ...input, event: anEvent({ slug: 'mariage', status: 'closed' }) },
      context,
    )

    expect(dto.closedAt).not.toBeNull()
  })
})

describe('toEventSettingsDto', () => {
  it('mirrors every setting the host can change', () => {
    const event = anEvent({
      settings: {
        moderation: 'auto',
        allowCaptions: false,
        allowReactions: true,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 30,
        maxPhotosPerGuest: 10,
      },
    })

    expect(toEventSettingsDto(event.settings)).toEqual({
      moderation: 'auto',
      allowCaptions: false,
      allowReactions: true,
      allowGuestSelfDelete: false,
      guestSelfDeleteGraceSeconds: 60,
      retentionDays: 30,
      maxPhotosPerGuest: 10,
    })
  })

  it('renders "keep forever" and "no limit" as null', () => {
    const event = anEvent({ settings: { retentionDays: null, maxPhotosPerGuest: null } })

    const dto = toEventSettingsDto(event.settings)

    expect(dto.retentionDays).toBeNull()
    expect(dto.maxPhotosPerGuest).toBeNull()
  })
})

describe('toGuestPhotoDto', () => {
  it('trusts the domain for canDelete rather than re-deriving it', () => {
    // Two implementations of the grace-window rule would drift, and the button would
    // then be enabled for an action the server refuses.
    const photo = aPhoto({ id: 'photo-1', status: 'pending' })

    expect(toGuestPhotoDto({ photo, slug: 'mariage', canDelete: false }).canDelete).toBe(false)
    expect(toGuestPhotoDto({ photo, slug: 'mariage', canDelete: true }).canDelete).toBe(true)
  })

  it('gives a guest only a thumbnail, not the full-size link', () => {
    const dto = toGuestPhotoDto({
      photo: aPhoto({ id: 'photo-1' }),
      slug: 'mariage',
      canDelete: true,
    })

    expect(dto.thumbUrl).toBe('/api/events/mariage/photos/photo-1/thumb')
    expect(Object.keys(dto)).not.toContain('displayUrl')
  })

  it('renders a missing caption as null', () => {
    const dto = toGuestPhotoDto({
      photo: aPhoto({ caption: null }),
      slug: 'mariage',
      canDelete: false,
    })

    expect(dto.caption).toBeNull()
  })

  it('carries the caption when there is one', () => {
    const dto = toGuestPhotoDto({
      photo: aPhoto({ caption: 'Les confettis' }),
      slug: 'mariage',
      canDelete: false,
    })

    expect(dto.caption).toBe('Les confettis')
  })
})

describe('toModerationPhotoDto', () => {
  it('gives a moderator the dimensions, so the grid does not reflow as thumbs arrive', () => {
    const dto = toModerationPhotoDto({
      photo: aPhoto({ id: 'photo-1', width: 2560, height: 1707, byteSize: 812_345 }),
      slug: 'mariage',
      authorName: 'Léa',
    })

    expect(dto).toMatchObject({
      width: 2560,
      height: 1707,
      byteSize: 812_345,
      authorName: 'Léa',
      thumbUrl: '/api/events/mariage/photos/photo-1/thumb',
      displayUrl: '/api/events/mariage/photos/photo-1/display',
    })
  })

  it('accepts an anonymous author without inventing a label', () => {
    // The French fallback is the client's choice, from web/src/lib/i18n.
    const dto = toModerationPhotoDto({
      photo: aPhoto({}),
      slug: 'mariage',
      authorName: null,
    })

    expect(dto.authorName).toBeNull()
  })

  it.each(['contentHash', 'author', 'review', 'eventId'])(
    'never exposes %s on the wire',
    (field) => {
      const dto = toModerationPhotoDto({ photo: aPhoto({}), slug: 'mariage', authorName: null })

      expect(Object.keys(dto)).not.toContain(field)
    },
  )
})

describe('toGuestDto', () => {
  it('reports the display name, the counts and whether the guest was removed', () => {
    const guest = aGuest({ id: 'guest-1', displayName: 'Léa' })

    expect(toGuestDto(guest)).toMatchObject({
      id: 'guest-1',
      displayName: 'Léa',
      revoked: false,
      joinedAt: AT.toISOString(),
    })
  })

  it('reports an anonymous guest as null, not as an empty string', () => {
    expect(toGuestDto(aGuest({ displayName: null })).displayName).toBeNull()
  })

  it('reports a revoked guest as revoked', () => {
    expect(toGuestDto(aGuest({ revokedAt: AT })).revoked).toBe(true)
  })
})

describe('toSessionUserDto', () => {
  it('carries the identity and the forced-change flag, never the hash', () => {
    const user = aUser({ email: 'host@example.com', displayName: 'Camille' })

    const dto = toSessionUserDto(user)

    expect(dto).toEqual({
      userId: user.id,
      email: 'host@example.com',
      displayName: 'Camille',
      mustChangePassword: false,
    })
    expect(Object.keys(dto)).not.toContain('passwordHash')
  })

  it('surfaces mustChangePassword so the client can gate the admin surface', () => {
    const user = aUser({ mustChangePassword: true })

    expect(toSessionUserDto(user).mustChangePassword).toBe(true)
  })
})
