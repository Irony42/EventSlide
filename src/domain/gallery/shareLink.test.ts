import { describe, expect, it } from 'vitest'
import { asEventId, asShareLinkId, asUserId } from '../shared/ids'
import { ShareLink, type NewShareLink } from './shareLink'
import { ShareLinkLifetime } from './shareLinkLifetime'

const AT = new Date('2026-06-21T10:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const DIGEST = 'a'.repeat(64)

const lifetime = (days: number): ShareLinkLifetime => {
  const parsed = ShareLinkLifetime.create(days)
  if (!parsed.ok) throw new Error('fixture lifetime refused')
  return parsed.value
}

const input = (overrides: Partial<NewShareLink> = {}): NewShareLink => ({
  eventId: asEventId('mariage'),
  tokenDigest: DIGEST,
  passwordHash: null,
  createdBy: asUserId('hote'),
  lifetime: lifetime(30),
  ...overrides,
})

const aLink = (overrides: Partial<NewShareLink> = {}): ShareLink => {
  const created = ShareLink.create(input(overrides), asShareLinkId('link-1'), AT)
  if (!created.ok) throw new Error(`fixture link refused: ${created.error.code}`)
  return created.value
}

describe('ShareLink.create', () => {
  it('opens for the lifetime the host chose, counted from the instant it was made', () => {
    const link = aLink({ lifetime: lifetime(7) })

    expect(link.createdAt).toEqual(AT)
    expect(link.expiresAt).toEqual(new Date(AT.getTime() + 7 * DAY))
    expect(link.revokedAt).toBeNull()
  })

  it('stores the digest it was handed and no token', () => {
    // The guard on the property the whole storage design rests on: nothing in the row is
    // the secret in the URL. A 43-character base64url token is exactly what a caller
    // would pass by mistake, and it must be refused rather than written down.
    const link = aLink()

    expect(link.tokenDigest).toBe(DIGEST)
    expect(Object.keys(link.toProps())).not.toContain('token')
  })

  it.each([
    ['a raw base64url token', 'Zm9vYmFyYmF6cXV1eC1zZWNyZXQtdG9rZW4tNDNjaGFyc3h4'],
    ['upper-case hex', 'A'.repeat(64)],
    ['a digest one character short', 'a'.repeat(63)],
    ['nothing at all', ''],
  ])('refuses %s where the digest belongs', (_label, tokenDigest) => {
    const created = ShareLink.create(input({ tokenDigest }), asShareLinkId('link-1'), AT)

    expect(!created.ok && created.error.code).toBe('shareLink.digestInvalid')
  })

  it('asks for a password exactly when the host set one', () => {
    expect(aLink().requiresPassword).toBe(false)
    expect(aLink({ passwordHash: 'hash:un-mot-de-passe-long' }).requiresPassword).toBe(true)
  })
})

describe('ShareLink.isOpenAt', () => {
  it('opens while it is neither revoked nor expired', () => {
    expect(aLink().isOpenAt(new Date(AT.getTime() + DAY))).toBe(true)
  })

  it('is shut at the expiry instant itself, not a moment after it', () => {
    const link = aLink({ lifetime: lifetime(1) })

    expect(link.isOpenAt(new Date(link.expiresAt.getTime() - 1))).toBe(true)
    expect(link.isOpenAt(link.expiresAt)).toBe(false)
  })

  it('is shut once revoked, however long it had left', () => {
    const revoked = aLink({ lifetime: lifetime(90) }).revoke(new Date(AT.getTime() + DAY))

    expect(revoked.isOpenAt(new Date(AT.getTime() + 2 * DAY))).toBe(false)
  })
})

describe('ShareLink.revoke', () => {
  it('keeps the first revocation instant when revoked twice', () => {
    const first = new Date(AT.getTime() + DAY)
    const once = aLink().revoke(first)

    const twice = once.revoke(new Date(AT.getTime() + 2 * DAY))

    expect(twice.revokedAt).toEqual(first)
  })

  it('leaves the link it was called on untouched', () => {
    const link = aLink()

    link.revoke(new Date(AT.getTime() + DAY))

    expect(link.revokedAt).toBeNull()
  })
})

describe('ShareLink.restore', () => {
  it('round-trips a stored row', () => {
    const props = aLink({ passwordHash: 'hash:x' }).revoke(AT).toProps()

    expect(ShareLink.restore(props).toProps()).toEqual(props)
  })
})
