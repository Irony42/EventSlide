import type { PublicEventDto } from './api/dto'

/**
 * What the join step learned about the event, kept for the upload screen.
 *
 * `POST /api/join` is the only endpoint that answers with a `PublicEventDto`, and
 * docs/API.md deliberately has no public "get event by slug" — a readable one would
 * let anyone enumerate events. So the upload screen cannot refetch the event name or
 * whether captions are allowed: the join step has to hand them over.
 *
 * `sessionStorage` rather than a module variable, because a guest on a venue's Wi-Fi
 * reloads, and sending them back to the join screen for a reload would cost the photo.
 * Per tab, gone when the tab closes, and it holds nothing the guest could not already
 * read on the join card.
 */

export interface GuestSession {
  readonly event: PublicEventDto
  /** `null` for a guest who chose to stay anonymous. */
  readonly displayName: string | null
}

const keyFor = (slug: string): string => `eventslide.guest.${slug}`

/**
 * Reads one property of an object whose shape is not known yet.
 *
 * `Reflect.get` rather than an `as` cast: what comes back from `sessionStorage` is
 * whatever was in the tab last, including a build older than this one, so it is
 * narrowed rather than asserted.
 */
const field = (source: object, key: string): unknown => Reflect.get(source, key)

const isPublicEvent = (value: unknown): value is PublicEventDto => {
  if (typeof value !== 'object' || value === null) return false
  return (
    typeof field(value, 'slug') === 'string' &&
    typeof field(value, 'name') === 'string' &&
    typeof field(value, 'allowCaptions') === 'boolean' &&
    typeof field(value, 'allowReactions') === 'boolean' &&
    typeof field(value, 'maxUploadBytes') === 'number' &&
    typeof field(value, 'maxFilesPerUpload') === 'number'
  )
}

const isGuestSession = (value: unknown): value is GuestSession => {
  if (typeof value !== 'object' || value === null) return false
  const displayName = field(value, 'displayName')
  if (displayName !== null && typeof displayName !== 'string') return false
  return isPublicEvent(field(value, 'event'))
}

export const rememberGuestSession = (session: GuestSession): void => {
  try {
    sessionStorage.setItem(keyFor(session.event.slug), JSON.stringify(session))
  } catch {
    // Safari in private browsing throws on write. Losing the reload resilience is
    // survivable; failing the join over it is not, and a QR code scanned from a
    // messaging app opens in exactly that kind of browser.
  }
}

export const readGuestSession = (slug: string): GuestSession | null => {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(keyFor(slug))
  } catch {
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isGuestSession(parsed)) return null
  // The key already contains the slug, so a mismatch means the entry was hand-edited
  // or written by another build. Refusing it sends the guest through the join screen
  // instead of showing them somebody else's event name — the 1.0 QR bug in miniature.
  if (parsed.event.slug !== slug) return null
  return parsed
}
