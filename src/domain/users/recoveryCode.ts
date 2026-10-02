/**
 * A recovery code: what an operator types when the phone with the authenticator is gone.
 *
 * Eighty random bits shown as `K7QM-2XTR-9PHD-4VNB`. The length is chosen against the way
 * the code is stored, as a bare SHA-256 digest (the same construction as every other secret
 * token here): a digest of 256 random bits could never be searched, but one of 40 would fall
 * to a database thief with a graphics card, and 80 puts a search out of reach while still
 * being something a person can copy off a sheet of paper in a minute.
 *
 * The alphabet is Crockford's, as for join codes, for the same reason: a code read off a
 * printout has no `I`, `L`, `O` or `U` to be mistaken for another character, and
 * {@link canonicalRecoveryCode} folds the ones a person will type anyway. Randomness lives in
 * the `IdGenerator` port; this module only maps bytes to characters, which keeps minting
 * deterministic under test.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** How many codes an enrolment hands out, and how many a regeneration replaces them with. */
export const RECOVERY_CODE_COUNT = 10

/** Entropy per code: ten bytes, sixteen characters of five bits. */
export const RECOVERY_CODE_BYTES = 10

const CODE_LENGTH = (RECOVERY_CODE_BYTES * 8) / 5

const GROUP_LENGTH = 4

/** `I` and `L` are read as `1`, `O` as `0`. */
const CONFUSABLES: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0' }

/** The canonical form of a code made from `bytes`: sixteen characters, no separators. */
export const recoveryCodeFromBytes = (bytes: Uint8Array): string => {
  let output = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes.subarray(0, RECOVERY_CODE_BYTES)) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += ALPHABET.charAt((buffer >>> bits) & 31)
    }
    buffer &= (1 << bits) - 1
  }
  return output
}

/** How a code is shown: four groups of four, joined by hyphens. */
export const formatRecoveryCode = (canonical: string): string =>
  (canonical.match(new RegExp(`.{1,${GROUP_LENGTH}}`, 'g')) ?? []).join('-')

/**
 * The canonical form of what a person typed, or `null` when it cannot be a recovery code.
 *
 * Uppercase, separators removed, confusables folded: `k7qm 2xtr-9phd-4vnb` and the same code
 * with an `O` typed for a `0` are one code. This is also the string that is hashed, so a code
 * must reach its digest through here and nowhere else.
 */
export const canonicalRecoveryCode = (input: string): string | null => {
  const folded = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .split('')
    .map((character) => CONFUSABLES[character] ?? character)
    .join('')
  return folded.length === CODE_LENGTH && [...folded].every((c) => ALPHABET.includes(c))
    ? folded
    : null
}
