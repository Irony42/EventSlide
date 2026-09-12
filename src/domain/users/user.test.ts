import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import { asUserId } from '../shared/ids'
import type { UserId } from '../shared/ids'
import type { Result } from '../shared/result'
import { EmailAddress } from './emailAddress'
import { User } from './user'
import type { PasswordHash, UserProps } from './user'

const CLAIRE = asUserId('usr-claire')
const MARC = asUserId('usr-marc')

const CREATED_AT = new Date('2026-06-13T18:00:00.000Z')
const SIGNED_IN_AT = new Date('2026-06-13T20:00:00.000Z')
const DISABLED_AT = new Date('2026-06-14T09:00:00.000Z')
const A_DAY_LATER = new Date('2026-06-15T09:00:00.000Z')

/** Opaque to the domain: the shape only has to be a non-empty string. */
const STORED_HASH: PasswordHash = 'argon2id$v=19$m=19456$stored'
const ROTATED_HASH: PasswordHash = 'argon2id$v=19$m=19456$rotated'

const unwrap = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`invalid fixture: ${result.error.code}`)
  return result.value
}

const CLAIRE_EMAIL = unwrap(EmailAddress.create('claire@example.com'))
const MARC_EMAIL = unwrap(EmailAddress.create('marc@example.com'))

interface UserOverrides {
  readonly id?: UserId
  readonly email?: EmailAddress
  readonly displayName?: string | null
  readonly passwordHash?: PasswordHash
  readonly mustChangePassword?: boolean
}

const createUser = (overrides: UserOverrides = {}): Result<User, DomainError> =>
  User.create(
    {
      email: overrides.email ?? CLAIRE_EMAIL,
      displayName: overrides.displayName === undefined ? 'Claire Martin' : overrides.displayName,
      passwordHash: overrides.passwordHash ?? STORED_HASH,
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
    overrides.id ?? CLAIRE,
    CREATED_AT,
  )

const aUser = (overrides: UserOverrides = {}): User => unwrap(createUser(overrides))

/**
 * A copy of every observable field. `toProps()` hands back the entity's own object, so
 * comparing it against itself would pass even if a transition had mutated in place.
 */
const snapshot = (user: User): Record<string, unknown> => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  passwordHash: user.passwordHash,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
  mustChangePassword: user.mustChangePassword,
  disabledAt: user.disabledAt,
})

describe('User.create', () => {
  it('carries the identity, email, name and hash it was created with', () => {
    const user = aUser()

    expect({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt,
    }).toEqual({
      id: CLAIRE,
      email: CLAIRE_EMAIL,
      displayName: 'Claire Martin',
      passwordHash: STORED_HASH,
      createdAt: CREATED_AT,
    })
  })

  it('starts enabled and with no login on record', () => {
    const user = aUser()

    expect({ lastLoginAt: user.lastLoginAt, disabledAt: user.disabledAt }).toEqual({
      lastLoginAt: null,
      disabledAt: null,
    })
  })

  it('accepts a host who has not given a display name', () => {
    const user = aUser({ displayName: null })

    expect(user.displayName).toBeNull()
  })

  it('carries the forced password change an invited moderator is created with', () => {
    const user = aUser({ mustChangePassword: true })

    expect(user.mustChangePassword).toBe(true)
  })

  it.each(['', '   '])(
    'refuses an account whose password hash is %j, since it could never authenticate',
    (passwordHash) => {
      const result = createUser({ passwordHash })

      expect(!result.ok && result.error.code).toBe('user.passwordHashEmpty')
    },
  )

  it('reports an empty hash as invalid input, so the HTTP layer answers 400', () => {
    const result = createUser({ passwordHash: '' })

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('User.restore', () => {
  it('rehydrates every stored field, so a repository read is the account it wrote', () => {
    const stored: UserProps = {
      id: MARC,
      email: MARC_EMAIL,
      displayName: 'Marc Petit',
      passwordHash: ROTATED_HASH,
      createdAt: CREATED_AT,
      lastLoginAt: SIGNED_IN_AT,
      mustChangePassword: true,
      disabledAt: DISABLED_AT,
    }

    const user = User.restore(stored)

    expect(snapshot(user)).toEqual(stored)
  })
})

describe('User sign-in eligibility', () => {
  it('lets an enabled account sign in', () => {
    expect(aUser().canSignIn()).toBe(true)
  })

  it('refuses a disabled account before its hash is even compared', () => {
    expect(aUser().disable(DISABLED_AT).canSignIn()).toBe(false)
  })

  it('reports an enabled account as not disabled', () => {
    expect(aUser().isDisabled()).toBe(false)
  })

  it('reports a disabled account as disabled', () => {
    expect(aUser().disable(DISABLED_AT).isDisabled()).toBe(true)
  })

  it('still lets an account with a pending password change sign in', () => {
    // The forced change is enforced after authentication, not instead of it.
    expect(aUser({ mustChangePassword: true }).canSignIn()).toBe(true)
  })
})

describe('User.recordLogin', () => {
  it('stamps the moment the account last signed in', () => {
    const signedIn = aUser().recordLogin(SIGNED_IN_AT)

    expect(signedIn.lastLoginAt).toBe(SIGNED_IN_AT)
  })

  it('keeps a forced password change pending across a login', () => {
    const signedIn = aUser({ mustChangePassword: true }).recordLogin(SIGNED_IN_AT)

    expect(signedIn.mustChangePassword).toBe(true)
  })
})

describe('User.withPasswordHash', () => {
  it('stores the new hash', () => {
    const result = aUser().withPasswordHash(ROTATED_HASH)

    expect(result.ok && result.value.passwordHash).toBe(ROTATED_HASH)
  })

  it('clears the forced change, because choosing a password is what it was asking for', () => {
    const result = aUser({ mustChangePassword: true }).withPasswordHash(ROTATED_HASH)

    expect(result.ok && result.value.mustChangePassword).toBe(false)
  })

  it.each(['', '   '])('refuses a replacement hash of %j', (hash) => {
    const result = aUser().withPasswordHash(hash)

    expect(!result.ok && result.error.code).toBe('user.passwordHashEmpty')
  })

  it('refuses the stored hash handed straight back, which changes nothing', () => {
    const result = aUser().withPasswordHash(STORED_HASH)

    expect(!result.ok && result.error.code).toBe('user.passwordUnchanged')
  })
})

describe('User.requirePasswordChange', () => {
  it('makes the next sign-in choose a new password', () => {
    expect(aUser().requirePasswordChange().mustChangePassword).toBe(true)
  })
})

describe('User.rename', () => {
  it('sets the display name a host chose', () => {
    expect(aUser().rename('Claire M.').displayName).toBe('Claire M.')
  })

  it('clears the display name back to nothing', () => {
    expect(aUser().rename(null).displayName).toBeNull()
  })
})

describe('User.disable', () => {
  it('records the moment the account was taken out of service', () => {
    expect(aUser().disable(DISABLED_AT).disabledAt).toBe(DISABLED_AT)
  })

  it('keeps the first timestamp when disabled twice, so the audit trail is not rewritten', () => {
    const disabledTwice = aUser().disable(DISABLED_AT).disable(A_DAY_LATER)

    expect(disabledTwice.disabledAt).toBe(DISABLED_AT)
  })

  it('leaves the account disabled after a second attempt', () => {
    const disabledTwice = aUser().disable(DISABLED_AT).disable(A_DAY_LATER)

    expect(disabledTwice.isDisabled()).toBe(true)
  })
})

describe('User.enable', () => {
  it('clears the timestamp when an account is put back in service', () => {
    expect(aUser().disable(DISABLED_AT).enable().disabledAt).toBeNull()
  })

  it('lets a re-enabled account sign in again', () => {
    expect(aUser().disable(DISABLED_AT).enable().canSignIn()).toBe(true)
  })
})

describe('User immutability', () => {
  const transitions: readonly [string, (user: User) => unknown][] = [
    ['recording a login', (user) => user.recordLogin(SIGNED_IN_AT)],
    ['setting a new password hash', (user) => user.withPasswordHash(ROTATED_HASH)],
    ['requiring a password change', (user) => user.requirePasswordChange()],
    ['renaming', (user) => user.rename('Claire M.')],
    ['disabling', (user) => user.disable(DISABLED_AT)],
    ['enabling', (user) => user.enable()],
  ]

  it.each(transitions)(
    'leaves the original account untouched after %s, so a caller can still undo',
    (_transitionName, transition) => {
      const user = aUser({ mustChangePassword: true })
      const before = snapshot(user)

      transition(user)

      expect(snapshot(user)).toEqual(before)
    },
  )

  it('leaves a disabled account untouched when it is enabled', () => {
    const disabled = aUser().disable(DISABLED_AT)
    const before = snapshot(disabled)

    disabled.enable()

    expect(snapshot(disabled)).toEqual(before)
  })
})

describe('User identity', () => {
  it('considers two instances of the same account equal, whatever changed around them', () => {
    const account = aUser()

    expect(account.disable(DISABLED_AT).equals(account)).toBe(true)
  })

  it('considers two different accounts different', () => {
    expect(aUser({ id: MARC, email: MARC_EMAIL }).equals(aUser())).toBe(false)
  })

  it('round-trips through toProps and restore after every transition it can undergo', () => {
    const stored = aUser({ mustChangePassword: true })
      .recordLogin(SIGNED_IN_AT)
      .rename('Claire M.')
      .requirePasswordChange()
      .disable(DISABLED_AT)

    const rehydrated = User.restore(stored.toProps())

    expect(snapshot(rehydrated)).toEqual(snapshot(stored))
  })

  it('rehydrates an account the rest of the domain treats as the same one', () => {
    const stored = aUser().disable(DISABLED_AT)

    expect(User.restore(stored.toProps()).equals(stored)).toBe(true)
  })
})
