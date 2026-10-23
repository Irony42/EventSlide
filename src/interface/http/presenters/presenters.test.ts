import { describe, expect, it } from 'vitest'
import {
  joinUrl,
  mediaUrl,
  toClientAuditPageDto,
  toEventDto,
  toEventSettingsDto,
  toGuestDto,
  toGuestPhotoDto,
  toInvitationAcceptedDto,
  toInvitationIssuedDto,
  toInvitationPreviewDto,
  toModerationPhotoDto,
  toPublicEventDto,
  toSessionUserDto,
  type PresenterContext,
} from './presenters'
import type { AuditRecord } from '../../../application/ports/auditLog'
import { AT, aGuest, aPhoto, aUser, anEvent } from '../../../application/testing/builders'
import { asClientId, asUserId } from '../../../domain/shared/ids'

const context: PresenterContext = {
  publicUrl: 'https://photos.example.com',
  uploadLimits: { maxBytes: 25_000_000, maxFiles: 20 },
  clipLimits: { maxBytes: 80_000_000, maxSeconds: 15, supported: true },
}

describe('the invitation DTOs', () => {
  const NOW = new Date('2026-06-27T21:00:00.000Z')

  it('shows a link only when no mail went out', () => {
    const base = { invitationId: 'inv-1' as never, expiresAt: NOW }

    expect(toInvitationIssuedDto({ ...base, delivery: 'mail' })).toEqual({
      status: 'invited',
      expiresAt: NOW.toISOString(),
    })
    expect(
      toInvitationIssuedDto({ ...base, delivery: 'link', link: 'https://x.test/invite/t' }),
    ).toEqual({
      status: 'invited',
      expiresAt: NOW.toISOString(),
      link: 'https://x.test/invite/t',
    })
  })

  it('names the slug of an event and nothing of a client', () => {
    const event = {
      userId: 'user-1' as never,
      email: 'a@b.test',
      target: { kind: 'event', eventId: 'event-1' as never, role: 'moderator' },
      place: { kind: 'event', slug: 'camille', name: 'Camille' },
    } as const
    const client = {
      userId: 'user-1' as never,
      email: 'a@b.test',
      target: { kind: 'client', clientId: 'client-1' as never, role: 'owner' },
      place: { kind: 'client', name: 'Atelier' },
    } as const

    expect(toInvitationAcceptedDto(event)).toEqual({
      status: 'accepted',
      kind: 'event',
      role: 'moderator',
      targetName: 'Camille',
      eventSlug: 'camille',
    })
    expect(toInvitationAcceptedDto(client)).toEqual({
      status: 'accepted',
      kind: 'client',
      role: 'owner',
      targetName: 'Atelier',
      eventSlug: null,
    })
  })

  it('previews the purpose, the target and the end, as strings', () => {
    expect(
      toInvitationPreviewDto({
        kind: 'client',
        role: 'member',
        targetName: 'Atelier',
        expiresAt: NOW,
      }),
    ).toEqual({
      kind: 'client',
      role: 'member',
      targetName: 'Atelier',
      expiresAt: NOW.toISOString(),
    })
  })
})

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
    expect(toPublicEventDto(event, context, true)).toEqual({
      slug: 'mariage',
      name: 'Camille & Sacha',
      allowCaptions: true,
      allowReactions: false,
      maxUploadBytes: 25_000_000,
      maxFilesPerUpload: 20,
      allowClips: true,
      maxClipBytes: 80_000_000,
      maxClipSeconds: 15,
      // Not a permission like the two above: it is what the host's event looks like, and
      // the guest's phone is one of the three screens it looks like it on.
      theme: { accentHue: 305, fonts: 'sans', frame: 'soft', material: 'glass' },
    })
  })

  it('carries the clip limits the upload will actually be judged against', () => {
    // Not decoration and not a duplicate of the assertion above: these are the numbers
    // the guest's picker refuses on, and a refusal that arrives *before* eighty
    // megabytes go up a venue's Wi-Fi is the whole reason they are on the wire. A
    // constant in the bundle would be a second copy of `MAX_CLIP_BYTES` that no
    // deployment's `.env` could move.
    const strict = toPublicEventDto(
      event,
      { ...context, clipLimits: { maxBytes: 40_000_000, maxSeconds: 8, supported: true } },
      true,
    )

    expect(strict.maxClipBytes).toBe(40_000_000)
    expect(strict.maxClipSeconds).toBe(8)
  })

  it('tells a guest there is no video when the box has no encoder, whatever the host ticked', () => {
    // The host's switch and the box's capability are two different facts, and the guest
    // needs the conjunction. `uploadClip` refuses with `clip.transcoderUnavailable` —
    // **after** multer has written the upload to disk — so a deployment with no ffmpeg
    // and a ticked checkbox charges every guest a full eighty-megabyte upload to be told
    // `500`, and nothing about the answer improves by repeating it.
    const noEncoder = toPublicEventDto(
      event,
      { ...context, clipLimits: { ...context.clipLimits, supported: false } },
      true,
    )

    expect(noEncoder.allowClips).toBe(false)
  })

  it('tells a guest there is no video when the join says the event does not accept clips', () => {
    // The host's switch and the client's plan are the use case's conjunction
    // (`Event.acceptsClips`, held at ring 1 and in `joinEvent`); the presenter reads the answer
    // and not the host's setting, so a plan that lost video is not offered to a guest as one.
    // Without it the picker offers a control that answers `403 event.clipsNotAllowed` after the
    // upload.
    expect(toPublicEventDto(event, context, false).allowClips).toBe(false)
  })

  it.each(['joinCode', 'quotaBytes', 'ownerId', 'photoCount', 'settings', 'retentionDays'])(
    'never exposes %s to a guest',
    (field) => {
      // A guest holding the join code learns the event's name and its two guest-facing
      // toggles. Everything else — who owns it, how full it is, how long it is kept —
      // is none of their business, and a leak here would be permanent once printed on
      // a card.
      expect(Object.keys(toPublicEventDto(event, context, true))).not.toContain(field)
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
    limits: { quotaBytes: 5_000_000_000, liveWindowEnd: null },
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

  it('answers with the quota the event is judged against, not the one it was stored with', () => {
    // G2-05's review, finding 4: an operator lowered the client's ceiling after the event
    // was created, so the stored 5 GB is a promise the box no longer keeps.
    const dto = toEventDto(
      { ...input, limits: { quotaBytes: 2_000, liveWindowEnd: null } },
      context,
    )

    expect(dto.quotaBytes).toBe(2_000)
  })

  it('announces when the live window closes, and has no such key when there is none', () => {
    const closing = new Date('2026-06-23T18:00:00.000Z')

    const announced = toEventDto(
      { ...input, limits: { quotaBytes: 1, liveWindowEnd: closing } },
      context,
    )
    const silent = toEventDto(input, context)

    expect(announced.liveWindowEnd).toBe('2026-06-23T18:00:00.000Z')
    expect(Object.keys(silent)).not.toContain('liveWindowEnd')
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
        allowClips: false,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 30,
        maxPhotosPerGuest: 10,
        theme: { accentHue: 250, fonts: 'serif', frame: 'square', material: 'glass' },
        wallLanguage: 'es',
      },
    })

    expect(toEventSettingsDto(event.settings)).toEqual({
      moderation: 'auto',
      allowCaptions: false,
      allowReactions: true,
      allowClips: false,
      allowGuestSelfDelete: false,
      guestSelfDeleteGraceSeconds: 60,
      retentionDays: 30,
      maxPhotosPerGuest: 10,
      theme: { accentHue: 250, fonts: 'serif', frame: 'square', material: 'glass' },
      wallLanguage: 'es',
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

describe('toClientAuditPageDto', () => {
  const record = (over: Partial<AuditRecord> = {}): AuditRecord => ({
    seq: 7,
    at: AT,
    actor: { kind: 'operator', userId: asUserId('user-operator'), label: null },
    action: 'invitation.issued',
    subject: { type: 'invitation', id: 'inv-1' },
    clientId: asClientId('client-1'),
    details: { pendingApproval: true },
    ...over,
  })

  it('names the kind of actor and never the account behind it', () => {
    const dto = toClientAuditPageDto({ items: [record()], next: null })

    expect(dto.items[0]?.actor).toEqual({ kind: 'operator', label: null })
    expect(JSON.stringify(dto)).not.toContain('user-operator')
  })

  it('keeps the label of an integration, which is a constant and not a person', () => {
    const dto = toClientAuditPageDto({
      items: [
        record({ actor: { kind: 'integration', userId: null, label: 'cloud:stripe-webhook' } }),
      ],
      next: null,
    })

    expect(dto.items[0]?.actor).toEqual({ kind: 'integration', label: 'cloud:stripe-webhook' })
  })

  it('keeps the id of an invitation, which the owner matches against their own list', () => {
    const dto = toClientAuditPageDto({ items: [record()], next: null })

    expect(dto.items[0]?.subject).toEqual({ type: 'invitation', id: 'inv-1' })
  })

  it('drops the id of an account, which identifies a person and means nothing to its reader', () => {
    const dto = toClientAuditPageDto({
      items: [
        record({ action: 'account.resetIssued', subject: { type: 'account', id: 'user-member' } }),
      ],
      next: null,
    })

    expect(dto.items[0]?.subject).toEqual({ type: 'account' })
    expect(JSON.stringify(dto)).not.toContain('user-member')
  })

  it('lets through only numbers, switches and instants of an entry’s details, whatever the row holds', () => {
    // A row is read back as stored, so an older allow-list, or a future one with an id kind, could
    // have put a string in it. The owner's door checks again.
    const dto = toClientAuditPageDto({
      items: [
        record({
          details: {
            pendingApproval: true,
            count: 3,
            gone: null,
            at: '2026-06-21T10:00:00.000Z',
            note: 'jean.dupont@example.org',
            list: ['x'] as never,
            nested: { max: 5, label: 'Mariage Secret', since: '2026-06-21T10:00:00.000Z' },
          },
        }),
      ],
      next: null,
    })

    expect(dto.items[0]?.details).toEqual({
      pendingApproval: true,
      count: 3,
      gone: null,
      at: '2026-06-21T10:00:00.000Z',
      nested: { max: 5, since: '2026-06-21T10:00:00.000Z' },
    })
    expect(JSON.stringify(dto)).not.toMatch(/dupont|Secret/)
  })

  it('carries the instant, the sequence, the details and the cursor as they are', () => {
    const dto = toClientAuditPageDto({ items: [record()], next: 6 })

    expect(dto).toMatchObject({
      items: [
        {
          seq: 7,
          at: AT.toISOString(),
          action: 'invitation.issued',
          details: { pendingApproval: true },
        },
      ],
      next: 6,
    })
  })

  it('does not carry the client the entry belongs to, which the caller named or is the only one of', () => {
    const dto = toClientAuditPageDto({ items: [record()], next: null })

    expect(Object.keys(dto.items[0] ?? {})).not.toContain('clientId')
  })
})
