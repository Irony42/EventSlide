import { DEFAULT_EVENT_THEME, readEventTheme } from '../design-system/eventTheme'
import type {
  NoticeAcknowledgementStatus,
  NoticeAudience,
  NoticePublication,
  PrivacyNoticeState,
  PublicEventDto,
} from './api/dto'

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
  /**
   * The privacy notice and this device's standing with it, as the server last answered
   * (roadmap §5.1). It mirrors the server and nothing else: a tap whose request did not
   * land is not written here, so a reload asks again rather than claiming a record the
   * server does not hold.
   *
   * `null` for a session written before notices existed, or one whose notice could not
   * be read back — see {@link readNoticeState} for why that is forgiven rather than
   * refused.
   */
  readonly privacyNotice: PrivacyNoticeState | null
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
    typeof field(value, 'allowClips') === 'boolean' &&
    // Narrowed like everything else: a stored theme with a hue of `"rose"` would reach
    // `--accent-hue` as a string the browser cannot parse, and the whole accent — every
    // primary button on the screen — would fall back to an invalid value.
    readEventTheme(field(value, 'theme')) !== null
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
 * What the theme is, for a session written before events had one.
 *
 * The same forgiveness {@link withClipDefaults} makes and for the same reason: refusing
 * the entry would send every guest already in the room back to the join screen the
 * moment the new build is deployed, mid-evening, with photos in their queue.
 *
 * The filled-in value is different in kind, though. `allowClips: false` is a *narrower*
 * answer than the truth, chosen because switching on an upload path nobody consented to
 * is worse than a missing feature. Here the fill-in is the product's own look, which is
 * exactly what that session was already rendering — so a guest who reloads sees no
 * change at all, and the host's colour arrives for them on their next join, which is one
 * QR scan away.
 *
 * An entry that carries a theme and gets it *wrong* is still refused, by `isPublicEvent`.
 *
 * **It hands on the narrowed theme rather than the stored one, and that is not tidying.**
 * `readEventTheme` fills in a field an older entry is missing — `material`, for a tab that
 * joined between roadmap 2.2 and 11.5 — and `isPublicEvent` calls it only for its verdict,
 * throwing the value away. So the stored object was reaching `GuestUploadPage` with three
 * keys where `PublicEventDto` promises four: harmless for the one reader there is today,
 * and `undefined` the first time somebody indexes a copy table by it.
 */
const withNarrowedTheme = (event: object): object => {
  const stored = field(event, 'theme')
  if (stored === undefined) return { ...event, theme: DEFAULT_EVENT_THEME }

  const theme = readEventTheme(stored)
  // `null` is left alone rather than defaulted: deciding whether a malformed entry
  // survives is `isPublicEvent`'s job, and it refuses this one.
  return theme === null ? event : { ...event, theme }
}

const PUBLICATIONS: readonly NoticePublication[] = ['afterReview', 'immediate']
/**
 * Every audience this build has a sentence for, as a record so that a member added to
 * `NoticeAudience` fails to compile here rather than being quietly left out. Left out, it
 * would make every notice that names it unreadable (see {@link readNoticeState}), and an
 * unreadable notice is one the upload screen does not show.
 */
const WORDED_AUDIENCES = {
  wall: true,
  organisers: true,
  sharedGallery: true,
} as const satisfies Record<NoticeAudience, true>
const AUDIENCES = Object.keys(WORDED_AUDIENCES) as readonly NoticeAudience[]
const ACKNOWLEDGEMENTS: readonly NoticeAcknowledgementStatus[] = ['none', 'current', 'outdated']

const isOneOf = <T extends string>(members: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (members as readonly string[]).includes(value)

const isCountOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value))

/**
 * The stored notice, or `null` when there is none this build can word.
 *
 * **`null` rather than a refused session**, and the asymmetry with `isPublicEvent` is
 * deliberate. Refusing the entry would send a guest back to the join screen mid-evening
 * the moment this build is deployed — the argument {@link withClipDefaults} makes. A
 * missing notice is instead *fetched*: the upload screen asks the server on open, and
 * offers the picker only while it has no notice to show, which is exactly what that
 * session was doing before notices existed.
 *
 * Every field is narrowed, and an audience this build has no sentence for makes the
 * whole notice unreadable rather than silently shorter: a notice that dropped the line
 * saying who else sees a photo would tell a guest less than the truth.
 *
 * Exported because the same question is asked of the server's own answers, not only of
 * what a tab stored: a bundle cached by the service worker can be older than the server
 * it talks to, and the shared gallery of roadmap §4.1 was the first audience such a bundle
 * had no sentence for.
 */
export const readNoticeState = (value: unknown): PrivacyNoticeState | null => {
  if (typeof value !== 'object' || value === null) return null
  const notice = field(value, 'notice')
  const acknowledgement = field(value, 'acknowledgement')
  if (typeof notice !== 'object' || notice === null) return null
  if (!isOneOf(ACKNOWLEDGEMENTS, acknowledgement)) return null

  const revision = field(notice, 'revision')
  const publication = field(notice, 'publication')
  const audiences = field(notice, 'audiences')
  const retentionDays = field(notice, 'retentionDays')
  const selfRemovalSeconds = field(notice, 'selfRemovalSeconds')

  if (typeof revision !== 'string' || !isOneOf(PUBLICATIONS, publication)) return null
  if (!Array.isArray(audiences)) return null
  const known = audiences.filter((audience): audience is NoticeAudience =>
    isOneOf(AUDIENCES, audience),
  )
  if (known.length !== audiences.length) return null
  if (!isCountOrNull(retentionDays) || !isCountOrNull(selfRemovalSeconds)) return null

  return {
    notice: { revision, publication, audiences: known, retentionDays, selfRemovalSeconds },
    acknowledgement,
  }
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
  const event = withClipDefaults(withNarrowedTheme(stored))
  if (event === null) return null

  return {
    event,
    displayName: displayName ?? null,
    privacyNotice: readNoticeState(field(value, 'privacyNotice')),
  }
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

/**
 * Replace the stored notice with the server's latest answer, keeping the rest.
 *
 * The upload screen re-reads the notice while it is open, and a reload should render
 * what it last learned rather than what the join said hours ago. A tab with no session
 * has nothing to update: it is on its way back to the join screen anyway.
 */
export const rememberPrivacyNotice = (slug: string, privacyNotice: PrivacyNoticeState): void => {
  const session = readGuestSession(slug)
  if (session === null) return
  rememberGuestSession({ ...session, privacyNotice })
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
