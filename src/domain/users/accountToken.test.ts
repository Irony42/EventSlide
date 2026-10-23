import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import { asAccountTokenId, asClientId, asEventId, asUserId } from '../shared/ids'
import type { Result } from '../shared/result'
import {
  ACCOUNT_TOKEN_LIFETIME_MS,
  ACCOUNT_TOKEN_PURPOSES,
  INVITATION_MAX_PER_ADDRESS_PER_HOUR,
  INVITATION_WINDOW_MS,
  invitationTargetOf,
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

/** An invitation as an owner issues it: to an address, for one event, with no account behind it. */
const eventInvitation = (overrides: Partial<NewAccountToken> = {}): NewAccountToken =>
  input({
    purpose: 'invitation',
    userId: null,
    eventId: asEventId('event-1'),
    eventRole: 'moderator',
    ...overrides,
  })

const clientInvitation = (overrides: Partial<NewAccountToken> = {}): NewAccountToken =>
  input({
    purpose: 'invitation',
    userId: null,
    clientId: asClientId('client-1'),
    clientRole: 'owner',
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
    // An invitation is for an address and a target; the other two are for an account.
    const token = unwrap(
      issueAccountToken(purpose === 'invitation' ? eventInvitation() : input({ purpose }), ID, NOW),
    )

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

  it('carries an invitation to a client with the role it grants', () => {
    const token = unwrap(issueAccountToken(clientInvitation({ clientRole: 'member' }), ID, NOW))

    expect(token.clientId).toBe('client-1')
    expect(token.clientRole).toBe('member')
    expect(token.eventId).toBeNull()
  })

  it('refuses an invitation that grants nothing, since its holder would be admitted to nowhere', () => {
    const result = issueAccountToken(input({ purpose: 'invitation', userId: null }), ID, NOW)

    expect(!result.ok && result.error.code).toBe('accountToken.targetRequired')
  })

  it('refuses an invitation to an event and a client at once, which no one could choose between', () => {
    const result = issueAccountToken(
      eventInvitation({ clientId: asClientId('client-1'), clientRole: 'owner' }),
      ID,
      NOW,
    )

    expect(!result.ok && result.error.code).toBe('accountToken.targetAmbiguous')
  })

  it('refuses an invitation that names an account: whether the address has one is decided when the link is spent', () => {
    const result = issueAccountToken(eventInvitation({ userId: asUserId('user-1') }), ID, NOW)

    expect(!result.ok && result.error.code).toBe('accountToken.userForbidden')
  })

  it.each([
    ['a client without a role', { clientId: asClientId('client-1') }, 'accountToken.roleRequired'],
    ['an event without a role', { eventId: asEventId('event-1') }, 'accountToken.roleRequired'],
    [
      'a client role without a client',
      { clientRole: 'owner' as const },
      'accountToken.clientRequired',
    ],
  ])('refuses %s', (_label, overrides, code) => {
    const result = issueAccountToken(
      input({ purpose: 'invitation', userId: null, ...overrides }),
      ID,
      NOW,
    )

    expect(!result.ok && result.error.code).toBe(code)
  })

  it.each(['passwordReset', 'emailVerification'] as const)(
    'refuses a %s that names an event or a client, since nothing that spends it would read one',
    (purpose) => {
      for (const target of [
        { eventId: asEventId('event-1'), eventRole: 'moderator' as const },
        { clientId: asClientId('client-1'), clientRole: 'owner' as const },
      ]) {
        const result = issueAccountToken(input({ purpose, ...target }), ID, NOW)

        expect(!result.ok && result.error.code).toBe('accountToken.targetForbidden')
      }
    },
  )

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
    expect(issueAccountToken(eventInvitation(), ID, NOW).ok).toBe(true)
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

describe('invitationTargetOf', () => {
  it('reads an event invitation as a moderator of that event', () => {
    const token = unwrap(issueAccountToken(eventInvitation(), ID, NOW))

    expect(invitationTargetOf(token)).toEqual({
      kind: 'event',
      eventId: 'event-1',
      role: 'moderator',
    })
  })

  it('reads a client invitation as a place in that client, with its role', () => {
    const token = unwrap(issueAccountToken(clientInvitation({ clientRole: 'member' }), ID, NOW))

    expect(invitationTargetOf(token)).toEqual({
      kind: 'client',
      clientId: 'client-1',
      role: 'member',
    })
  })

  it('reads nothing from a token that is not an invitation', () => {
    expect(invitationTargetOf(issue())).toBeNull()
  })

  it('reads nothing from a reset that a row somehow gave a target, which is not a grant', () => {
    // Not reachable through `issueAccountToken`, which refuses it; a hand-edited row could be.
    const reset = {
      ...issue(),
      eventId: asEventId('event-1'),
      eventRole: 'moderator' as const,
      clientId: asClientId('client-1'),
      clientRole: 'owner' as const,
    }

    expect(invitationTargetOf(reset)).toBeNull()
  })

  it('reads nothing from an invitation row that names no complete target', () => {
    // Not reachable through `issueAccountToken`; a row the database holds could be, and the
    // answer must be "nothing to grant" rather than a half-built grant.
    const token = unwrap(issueAccountToken(eventInvitation(), ID, NOW))

    expect(invitationTargetOf({ ...token, eventRole: null })).toBeNull()
  })
})

describe('the invitation cap', () => {
  it('is five an hour per address, counted over an hour', () => {
    expect(INVITATION_MAX_PER_ADDRESS_PER_HOUR).toBe(5)
    expect(INVITATION_WINDOW_MS).toBe(HOUR)
  })
})
