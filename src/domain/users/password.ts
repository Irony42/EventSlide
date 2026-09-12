import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * A plaintext password on its way to being hashed. It exists only to enforce the
 * policy, and it is never stored, logged, or returned.
 *
 * 1.0 had no policy at all and shipped a hardcoded `admin` / `password` account that
 * `initDatabase()` recreated on every boot. That is the defect this file closes.
 *
 * The policy is **length-first**, deliberately. Composition rules ("one uppercase, one
 * digit, one symbol") push people towards `Password1!` and are worse than a longer
 * passphrase; NIST has recommended against them since SP 800-63B. So: a 12-character
 * minimum, a check against a small list of the passwords actually tried against
 * self-hosted apps, and a check that the password is not the email or the event name.
 */

const MIN_LENGTH = 12
/** bcrypt truncates input beyond 72 bytes; refusing is honest, silently cutting is not. */
const MAX_BYTES = 72

/**
 * Not a breach corpus — that belongs in an optional infrastructure check against a
 * real list. This is the short tail that a bored guest types into a login form they
 * found, plus the values 1.0 itself shipped.
 */
const BLOCKLIST = new Set([
  // Every entry is at least MIN_LENGTH characters. A shorter one would be dead weight:
  // `password.tooShort` fires first, so `password.tooCommon` could never be reached for
  // it — the first draft of this list carried ten such entries.
  'password1234',
  'password123456',
  'passwordpassword',
  'motdepasse12',
  'motdepasse123',
  'azertyuiop12',
  'qwertyuiop12',
  'qwertyuiopqwerty',
  '123456789012',
  '1234567890123456',
  'administrator',
  'administrateur',
  'eventslide12',
  'eventslide123',
  'photobooth12',
  'letmein12345',
  'changemenow1',
  'iloveyou1234',
])

/**
 * UTF-8 byte length, computed here because neither `Buffer` nor `TextEncoder` exists
 * in the domain project — `tsconfig.domain.json` sets `types: []` and no DOM lib.
 *
 * Walks UTF-16 code units rather than code points: `charCodeAt` returns a `number`,
 * where `codePointAt` returns `number | undefined` and forces a branch that no input
 * can reach.
 */
const utf8Length = (value: string): number => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit < 0x80) {
      bytes += 1
    } else if (unit < 0x800) {
      bytes += 2
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      // A high surrogate: together with its low surrogate it encodes one code point
      // in four bytes, so consume both units here.
      bytes += 4
      index += 1
    } else {
      bytes += 3
    }
  }
  return bytes
}

export interface PasswordContext {
  /** The account's own email — a password equal to it protects nothing. */
  readonly email?: string
  /** The event or host name, for the same reason. */
  readonly displayName?: string
}

export class Password {
  private constructor(readonly value: string) {}

  static create(raw: unknown, context: PasswordContext = {}): Result<Password, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('password.invalid'))

    // Not trimmed: leading and trailing spaces are legitimate characters in a
    // passphrase, and silently removing them means the password that worked once will
    // not work next time.
    if (raw.length < MIN_LENGTH) {
      return err(DomainError.invalid('password.tooShort', { min: MIN_LENGTH }))
    }
    if (utf8Length(raw) > MAX_BYTES) {
      return err(DomainError.invalid('password.tooLong', { maxBytes: MAX_BYTES }))
    }

    const normalised = raw.toLowerCase()
    if (BLOCKLIST.has(normalised)) {
      return err(DomainError.invalid('password.tooCommon'))
    }
    if (context.email !== undefined && normalised === context.email.toLowerCase()) {
      return err(DomainError.invalid('password.sameAsEmail'))
    }
    if (
      context.displayName !== undefined &&
      context.displayName.length >= MIN_LENGTH &&
      normalised === context.displayName.toLowerCase()
    ) {
      return err(DomainError.invalid('password.sameAsName'))
    }
    // A single repeated character reaches 12 characters without any entropy.
    if (new Set(raw).size === 1) {
      return err(DomainError.invalid('password.tooRepetitive'))
    }

    return ok(new Password(raw))
  }

  static readonly minLength = MIN_LENGTH
  static readonly maxBytes = MAX_BYTES

  /** Guards against a password reaching a log line or an error message. */
  toString(): string {
    return '[password]'
  }

  toJSON(): string {
    return '[password]'
  }
}
