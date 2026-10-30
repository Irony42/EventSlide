import { DEFAULT_EVENT_THEME, readEventTheme } from '../design-system/eventTheme'
import type {
  EventThemeDto,
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
 *
 * **One copy outlives the tab: the last event, in `localStorage`** (navigation pass,
 * finding A1). The installed app opens `/join`, a tab that has no session, and without a
 * memory it asks for a code printed on a card the guest no longer holds. The copy is the
 * very object the tab stores, so it carries nothing the session did not already hold: the
 * event's public settings, the display name the guest chose to give, and the privacy
 * notice's state. It is **one** entry, replaced by the next join and never a list of
 * events visited, and it expires with the guest's cookie ({@link REMEMBERED_FOR_MS}). It is cleared by {@link forgetGuestSession} ("Ce n'est pas votre
 * soirée ?"), and by the upload screen when the server says the guest's access is gone.
 * It never holds the device token: that is an `HttpOnly` cookie this code cannot read.
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
 * `readEventTheme` drops a key an older entry still carries — the retired `material` of a tab
 * that joined before 3.3 — and `isPublicEvent` calls it only for its verdict, throwing the
 * value away. So the stored object would keep reaching `GuestUploadPage` with a key
 * `PublicEventDto` no longer declares: harmless for the one reader there is today, and a
 * surprise the first time somebody spreads or compares a copy of it.
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
  guestFeed: true,
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
  const operator = field(notice, 'operator')

  if (typeof revision !== 'string' || !isOneOf(PUBLICATIONS, publication)) return null
  if (!Array.isArray(audiences)) return null
  const known = audiences.filter((audience): audience is NoticeAudience =>
    isOneOf(AUDIENCES, audience),
  )
  if (known.length !== audiences.length) return null
  if (!isCountOrNull(retentionDays) || !isCountOrNull(selfRemovalSeconds)) return null
  // Absent on every notice that names nobody, so absence is fine. Present, it is the operator's
  // name and must be text worth printing: a notice that names something unreadable is
  // refetched rather than shown with a host line that says nothing (roadmap G2-17).
  if (operator !== undefined && (typeof operator !== 'string' || operator.trim() === '')) {
    return null
  }

  return {
    notice: {
      revision,
      publication,
      audiences: known,
      retentionDays,
      selfRemovalSeconds,
      ...(operator === undefined ? {} : { operator }),
    },
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

const REMEMBERED_KEY = 'eventslide.guest.last'

/**
 * Writes are best effort, each on its own: Safari in private browsing throws on
 * `sessionStorage` writes, a browser with site data blocked throws on both, and one failing
 * must not stop the other from landing.
 */
const tryWrite = (storage: () => Storage, key: string, value: string): void => {
  try {
    storage().setItem(key, value)
  } catch {
    // Losing the reload resilience is survivable; failing the join over it is not, and a QR
    // code scanned from a messaging app opens in exactly that kind of browser.
  }
}

const tryRemove = (storage: () => Storage, key: string): void => {
  try {
    storage().removeItem(key)
  } catch {
    // Nothing to clean up in a browser that will not let us write.
  }
}

const tryRead = (storage: () => Storage, key: string): string | null => {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

const parseSession = (raw: string | null): GuestSession | null => {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return readSession(parsed)
}

const inTab = (): Storage => sessionStorage
const onDevice = (): Storage => localStorage

/**
 * How long the device keeps its memory of the last event: as long as the guest's cookie lives
 * (`GUEST_COOKIE_MAX_AGE_MS` in the server's `publicRoutes.ts`, 36 hours).
 *
 * Past that the server no longer knows this phone, so resuming would open an upload screen only
 * to be told so, and the guest's name and the event's settings would sit in `localStorage` on a
 * possibly shared phone for as long as nobody cleared them. An older entry is **deleted when it
 * is read**, so it does not outlive its usefulness by more than the next launch.
 */
export const REMEMBERED_FOR_MS = 36 * 60 * 60 * 1000

interface Remembered {
  readonly session: GuestSession
  /** When the guest joined, in ms since the epoch: the one value added to what the session holds. */
  readonly rememberedAt: number
}

const readRemembered = (now: number): Remembered | null => {
  const raw = tryRead(onDevice, REMEMBERED_KEY)
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  const session = readSession(parsed)
  const rememberedAt: unknown =
    typeof parsed === 'object' && parsed !== null ? field(parsed, 'rememberedAt') : undefined
  if (
    session === null ||
    typeof rememberedAt !== 'number' ||
    !Number.isFinite(rememberedAt) ||
    now - rememberedAt >= REMEMBERED_FOR_MS
  ) {
    tryRemove(onDevice, REMEMBERED_KEY)
    return null
  }
  return { session, rememberedAt }
}

/** The remembered last event, narrowed like every stored entry, or `null` (and gone when stale). */
export const readRememberedGuestSession = (now: number = Date.now()): GuestSession | null =>
  readRemembered(now)?.session ?? null

export const rememberGuestSession = (session: GuestSession, now: number = Date.now()): void => {
  tryWrite(inTab, keyFor(session.event.slug), JSON.stringify(session))
  tryWrite(onDevice, REMEMBERED_KEY, JSON.stringify({ ...session, rememberedAt: now }))
}

/**
 * Replace the stored notice with the server's latest answer, keeping the rest.
 *
 * The upload screen re-reads the notice while it is open, and a reload should render
 * what it last learned rather than what the join said hours ago. A tab with no session
 * has nothing to update: it is on its way back to the join screen anyway.
 *
 * The device's "last event" is refreshed only when it is **this** event: a tab left open on
 * an earlier evening must not take the memory back from the one the guest joined since. And its
 * date stays the join's: reading a notice does not renew a cookie.
 */
export const rememberPrivacyNotice = (
  slug: string,
  privacyNotice: PrivacyNoticeState,
  now: number = Date.now(),
): void => {
  amendGuestSession(slug, now, (session) => ({ ...session, privacyNotice }))
}

/**
 * Replace the stored theme with the one the server answered with, keeping the rest.
 *
 * The join's copy of the theme is a snapshot, and a host who changes the colour at 21:00 has
 * not changed what a guest who joined at 19:00 sees until something tells that guest's phone.
 * The upload screen's own-photos read and the feed's wall read both carry the current theme;
 * this is where what they learn is written back, so the **next** open of the screen paints the
 * right colour on its first frame instead of the old one for a round trip.
 *
 * It follows the same three rules {@link rememberPrivacyNotice} does, and for the same
 * reasons: a tab with no session has nothing to update, the device's "last event" follows
 * only when it is **this** event, and reading does not renew the cookie's date. The tab's
 * copy and the device's therefore always hold the same theme: both are refreshed, or the
 * device's is a different event's and is left alone.
 *
 * The caller narrows the theme (`readEventTheme`) before handing it over: this writes what it
 * is given, and a stored entry that fails `isPublicEvent` would log the guest out of the screen.
 */
export const rememberEventTheme = (
  slug: string,
  theme: EventThemeDto,
  now: number = Date.now(),
): void => {
  amendGuestSession(slug, now, (session) => ({ ...session, event: { ...session.event, theme } }))
}

/**
 * Rewrites the stored session for `slug` through `change`, in the tab and on the device.
 *
 * The device's "last event" is rewritten only when it is **this** event: a tab left open on an
 * earlier evening must not take the memory back from the one the guest joined since. And its
 * date stays the join's: nothing amended here renews a cookie.
 */
const amendGuestSession = (
  slug: string,
  now: number,
  change: (session: GuestSession) => GuestSession,
): void => {
  const session = readGuestSession(slug, now)
  if (session === null) return
  tryWrite(inTab, keyFor(slug), JSON.stringify(change(session)))
  const remembered = readRemembered(now)
  if (remembered?.session.event.slug === slug) {
    // Amended from **the device's own copy**, not from the tab's: a tab left open can hold an
    // older name or notice than a join made since in another tab or the installed app, and
    // copying the tab's over it would take that join back.
    tryWrite(
      onDevice,
      REMEMBERED_KEY,
      JSON.stringify({ ...change(remembered.session), rememberedAt: remembered.rememberedAt }),
    )
  }
}

/**
 * What this device knows about `slug`: this tab's own entry, else the remembered last event
 * if it is that very event.
 *
 * The fallback is what turns a reopened tab, a bookmark or the installed app's icon into the
 * upload screen instead of a request for a code. It is matched on the slug, never handed out
 * for another event: the address is what the guest asked for.
 */
export const readGuestSession = (slug: string, now: number = Date.now()): GuestSession | null => {
  // The key already contains the slug, so a mismatch means the entry was hand-edited
  // or written by another build. Refusing it sends the guest through the join screen
  // instead of showing them somebody else's event name — the 1.0 QR bug in miniature.
  const own = parseSession(tryRead(inTab, keyFor(slug)))
  if (own !== null && own.event.slug === slug) return own
  const remembered = readRememberedGuestSession(now)
  return remembered !== null && remembered.event.slug === slug ? remembered : null
}

/**
 * "Ce n'est pas votre soirée ?": this device stops treating `slug` as the guest's event, and
 * forgets whichever event it remembered.
 *
 * Clears the tab's entry **and the device's, whichever event that names**: a guest saying "not
 * mine" on a screen the device did not remember would otherwise be carried straight back to the
 * one it did. The guest's `HttpOnly` cookie is the server's and stays: the next join replaces
 * it, and it opens nothing outside the event that issued it.
 */
export const forgetGuestSession = (slug: string): void => {
  tryRemove(inTab, keyFor(slug))
  tryRemove(onDevice, REMEMBERED_KEY)
}
