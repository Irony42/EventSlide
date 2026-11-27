import type { SignupListCursor } from '../../application/ports/signupRepository'
import { AUDIT_ID_PATTERN } from '../../domain/audit/auditEntry'

/**
 * The `before` / `next` of `GET /api/site/signups`: the port's `{ at, id }` position, written as
 * base64url JSON so a client treats it as a token and builds nothing from it. Opaque, not secret:
 * it names a position in a list only an operator may read.
 */
export const encodeSignupCursor = (cursor: SignupListCursor): string =>
  Buffer.from(JSON.stringify({ at: cursor.at.toISOString(), id: cursor.id }), 'utf8').toString(
    'base64url',
  )

/** The cursor a client sent back, or `null` for anything that `encodeSignupCursor` did not write. */
export const decodeSignupCursor = (raw: string): SignupListCursor | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { at, id } = parsed as { at?: unknown; id?: unknown }
    if (typeof at !== 'string' || typeof id !== 'string') return null
    const instant = new Date(at)
    if (Number.isNaN(instant.getTime()) || instant.toISOString() !== at) return null
    if (!AUDIT_ID_PATTERN.test(id)) return null
    return { at: instant, id }
  } catch {
    return null
  }
}
