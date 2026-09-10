/**
 * The minimum the host is told about before they type.
 *
 * A copy of `Password.minLength` in `src/domain/users/password.ts`, used for the hint
 * and for nothing else: the server is the only judge of a password, and it answers
 * `password.tooShort`, `password.tooCommon` or `password.sameAsName` on its own terms.
 * Validating here as well would mean two rulebooks, and the weaker one would win.
 */
export const PASSWORD_MIN_LENGTH = 12
