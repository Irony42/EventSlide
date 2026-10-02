import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import { asAccountTokenId, asEventId, asUserId } from '../shared/ids'
import type { Result } from '../shared/result'
import {
  ACCOUNT_TOKEN_LIFETIME_MS,
  ACCOUNT_TOKEN_PURPOSES,
  isAccountTokenPurpose,
  isAccountTokenUsable,
  isTokenDigest,
  issueAccountToken,
  type AccountToken,
  type NewAccountToken,
} from './accountToken'
import { EmailAddress } from './emailAddress'

const NOW = new Date('2026-06-20T21:00:00.000Z')
const ID = asAccountTokenId('tok-1')
const DIGEST = 'ab'.repeat(32)
const HOUR = 60 * 60 * 1000

const unwrap = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`invalid fixture: ${result.error.code}`)
  return result.value
}

const EMAIL = unwrap(EmailAddress.create('hote@example.test'))

const input = (overrides: Partial<NewAccountToken> = {}): NewAccountToken => ({
  purpose: 'passwordReset',
  tokenDigest: DIGEST,
  email: EMAIL,
  userId: asUserId('user-1'),
  delivery: 'mail',
  createdBy: null,
  ...overrides,
})

const issue = (overrides: Partial<NewAccountToken> = {}, at = NOW): AccountToken =>
  unwrap(issueAccountToken(input(overrides), ID, at))

describe('issueAccountToken', () => {
  it('issues a token that is unspent, unrevoked and unapproved', () => {
    const token = issue()

    expect(token).toMatchObject({
      id: ID,
      purpose: 'passwordReset',
      tokenDigest: DIGEST,
      userId: 'user-1',
      eventId: null,
      eventRole: null,
      delivery: 'mail',
      requiresApproval: false,
      approvedBy: null,
      approvedAt: null,
      createdAt: NOW,
      consumedAt: null,
      revokedAt: null,
    })
  })

  it.each([
    ['invitation', 7 * 24 * HOUR],
    ['passwordReset', HOUR],
    ['emailVerification', 24 * HOUR],
  ] as const)('lets a %s live exactly as long as its purpose says', (purpose, lifetime) => {
    const token = issue({ purpose, userId: asUserId('user-1') })

    expect(token.expiresAt.getTime() - NOW.getTime()).toBe(lifetime)
  })

  it('gives a password reset an hour, which is the number the plan states', () => {
    expect(ACCOUNT_TOKEN_LIFETIME_MS.passwordReset).toBe(60 * 60 * 1000)
  })

  it('keeps the actor and the approval flag it was given', () => {
    const token = issue({ requiresApproval: true, createdBy: asUserId('user-2') })

    expect(token.requiresApproval).toBe(true)
    expect(token.createdBy).toBe('user-2')
  })

  it('carries an invitation to an event with the role it grants', () => {
    const token = issue({
      purpose: 'invitation',
      userId: null,
      eventId: asEventId('event-1'),
      eventRole: 'moderator',
    })

    expect(token.eventId).toBe('event-1')
    expect(token.eventRole).toBe('moderator')
  })

  it('refuses a digest that is not a SHA-256 in lower-case hex, so a token cannot be stored as one', () => {
    for (const tokenDigest of ['', 'abc', 'AB'.repeat(32), 'zz'.repeat(32), 'ab'.repeat(33)]) {
      const result = issueAccountToken(input({ tokenDigest }), ID, NOW)

      expect(!result.ok && result.error.code, tokenDigest).toBe('accountToken.digestInvalid')
    }
  })

  it('refuses a purpose it does not know', () => {
    const result = issueAccountToken(input({ purpose: 'magicLogin' as never }), ID, NOW)

    expect(!result.ok && result.error.code).toBe('accountToken.purposeInvalid')
  })

  it('refuses a password reset that names no account, since nothing could apply it', () => {
    const result = issueAccountToken(input({ userId: null }), ID, NOW)

    expect(!result.ok && result.error.code).toBe('accountToken.userRequired')
  })

  it('accepts an invitation that names no account, because none exists yet', () => {
    expect(issueAccountToken(input({ purpose: 'invitation', userId: null }), ID, NOW).ok).toBe(true)
  })

  it('refuses a role without an event, which would grant moderation of nothing', () => {
    const result = issueAccountToken(
      input({ purpose: 'invitation', userId: null, eventRole: 'moderator' }),
      ID,
      NOW,
    )

    expect(!result.ok && result.error.code).toBe('accountToken.eventRequired')
  })
})

describe('isAccountTokenUsable', () => {
  const justBeforeExpiry = new Date(NOW.getTime() + HOUR - 1)
  const atExpiry = new Date(NOW.getTime() + HOUR)

  it('is usable from the moment it is issued', () => {
    expect(isAccountTokenUsable(issue(), NOW)).toBe(true)
  })

  it('is usable until the last millisecond of its life', () => {
    expect(isAccountTokenUsable(issue(), justBeforeExpiry)).toBe(true)
  })

  it('is dead at the instant it expires, so an hour has no extra millisecond in it', () => {
    expect(isAccountTokenUsable(issue(), atExpiry)).toBe(false)
  })

  it('is dead after it was spent', () => {
    expect(isAccountTokenUsable({ ...issue(), consumedAt: NOW }, NOW)).toBe(false)
  })

  it('is dead after it was revoked', () => {
    expect(isAccountTokenUsable({ ...issue(), revokedAt: NOW }, NOW)).toBe(false)
  })

  it('is not usable while it waits for an approval it needs', () => {
    expect(isAccountTokenUsable(issue({ requiresApproval: true }), NOW)).toBe(false)
  })

  it('is usable once the approval it needed has been given', () => {
    const approved = { ...issue({ requiresApproval: true }), approvedAt: NOW }

    expect(isAccountTokenUsable(approved, NOW)).toBe(true)
  })

  it('does not need an approval it never asked for', () => {
    expect(isAccountTokenUsable({ ...issue(), approvedAt: null }, NOW)).toBe(true)
  })
})

describe('the vocabularies', () => {
  it('knows exactly the three purposes the table admits', () => {
    expect([...ACCOUNT_TOKEN_PURPOSES]).toEqual([
      'invitation',
      'passwordReset',
      'emailVerification',
    ])
    expect(isAccountTokenPurpose('passwordReset')).toBe(true)
    expect(isAccountTokenPurpose('magicLogin')).toBe(false)
    expect(isAccountTokenPurpose(undefined)).toBe(false)
  })

  it('recognises a digest only in its stored shape', () => {
    expect(isTokenDigest(DIGEST)).toBe(true)
    expect(isTokenDigest(DIGEST.toUpperCase())).toBe(false)
    expect(isTokenDigest(42)).toBe(false)
  })
})
