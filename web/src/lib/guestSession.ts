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
    typeof field(value, 'maxFilesPerUpload') === 'number' &&
    // The two clip **limits** are narrowed like everything else, because the upload
    // screen reads them without asking again: a stored session carrying a garbage
    // `maxClipBytes` would put "NaN Mo maximum" in the picker's hint and refuse nothing
    // at all on size. Only their presence is forgiven, by `withClipDefaults` below, and
    // only when the whole clip half is absent.
    hasClipFields(value) &&
    typeof field(value, 'maxClipBytes') === 'number' &&
    typeof field(value, 'maxClipSeconds') === 'number' &&
    typeof field(value, 'allowClips') === 'boolean'
  )
}

/**
 * Whether this entry was written by a build that knew about video at all.
 *
 * The one field that decides it is `allowClips`: a session from before the feature has
 * none of the three, and one from after has all three. Keying on the boolean rather than
 * on "any of them is missing" is what keeps a **partially** written entry — a hand-edited
 * one, or a build that grew the fields in two steps — on the refusal path rather than
 * silently defaulted.
 */
const hasClipFields = (value: object): boolean => field(value, 'allowClips') !== undefined

/**
 * What the clip half of the event is, for a session that predates it.
 *
 * **Not a rejection, and that is the whole point of this function.** Adding the three
 * clip fields to `isPublicEvent` would have been the consistent-looking move, and it
 * would log every guest already in the room out of the upload screen at the moment the
 * new build is deployed — on an event that is live, mid-evening, with photos in their
 * queue. Refusing a session is for an entry that would render *wrongly*; an entry that is
 * merely older than video is not one.
 *
 * So the missing half is filled in as "this gallery has no video", which is exactly what
 * the guest's own session knew when it was written. Video appears for them the next time
 * they scan the code, which is a join away and costs them nothing.
 *
 * The zeroes are never read: `allowClips: false` is what the composer keys off, and the
 * limits are only consulted inside it. They are zero rather than a plausible-looking
 * 80 MB precisely so that a build which ever did read them refuses everything loudly
 * instead of enforcing a number no deployment chose.
 */
const withClipDefaults = (event: object): PublicEventDto | null => {
  if (hasClipFields(event)) return isPublicEvent(event) ? event : null
  // Older than video, and complete in every other respect: filled in as "this gallery
  // has no video", which is what that session knew when it was written.
  const older = { ...event, allowClips: false, maxClipBytes: 0, maxClipSeconds: 0 }
  return isPublicEvent(older) ? older : null
}

/**
 * The stored entry, narrowed to what the upload screen may read.
 *
 * The event goes through {@link withClipDefaults} rather than straight through
 * {@link isPublicEvent}, so that the one case worth forgiving — a session written before
 * video shipped — is forgiven and every other malformed shape is still refused.
 */
const readSession = (value: unknown): GuestSession | null => {
  if (typeof value !== 'object' || value === null) return null
  const displayName = field(value, 'displayName')
  if (displayName !== null && typeof displayName !== 'string') return null

  const stored = field(value, 'event')
  if (typeof stored !== 'object' || stored === null) return null
  const event = withClipDefaults(stored)
  if (event === null) return null

  return { event, displayName: displayName ?? null }
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
  const session = readSession(parsed)
  if (session === null) return null
  // The key already contains the slug, so a mismatch means the entry was hand-edited
  // or written by another build. Refusing it sends the guest through the join screen
  // instead of showing them somebody else's event name — the 1.0 QR bug in miniature.
  if (session.event.slug !== slug) return null
  return session
}
