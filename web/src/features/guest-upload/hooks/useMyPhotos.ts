import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { readEventTheme } from '../../../design-system/eventTheme'
import { rememberEventTheme } from '../../../lib/guestSession'
import { ApiError, isAbortError } from '../../../lib/http'
import { messageForCode } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { EventBrandDto, EventThemeDto, GuestPhotoDto, PhotoStatus } from '../../../lib/api/dto'
import { POLL_SLOW_AFTER_MS, pollDelayMs } from './pollCadence'

/**
 * The guest's own photos, from `GET /api/events/:slug/photos/mine`.
 *
 * It exists because silence after an upload is indistinguishable from a failure, and a
 * guest who cannot tell sends the photo again. The list carries whatever the host
 * decided, including a refusal — being told beats wondering.
 *
 * `canDelete` is never recomputed here. The server derives it from the grace window
 * and the current status, and 1.0's client-side version of the same rule is why it
 * offered a delete button that answered 403.
 */

/**
 * A photo of the guest's has just gone from waiting to on the wall.
 *
 * `whileAway` is the guest having left the tab and come back to find it: the moment
 * "look up" is true has passed, so the screen says it **went** to the screen rather than
 * that it is about to.
 */
export interface Arrival {
  readonly whileAway: boolean
}

export interface MyPhotosState {
  readonly photos: readonly GuestPhotoDto[]
  /**
   * The host has just published one of these. Set for a few seconds, and it is what the
   * list announces ("Validée ! … levez les yeux"), politely, to a screen reader as well.
   * `null` the rest of the time.
   */
  readonly arrival: Arrival | null
  /**
   * Whether the event still takes photos, as the server last said. `true` until it says
   * otherwise, and for a server that does not say: the form is the default and the server's own
   * refusal stays the backstop.
   */
  readonly acceptingUploads: boolean
  /**
   * The event's look as the server last said it, or `null` while it has not said (the first read
   * is in the air, or failed, or the server predates the field). The screen paints the theme the
   * join stored until this is set, so the first frame is never blank, and one repaint is what
   * a host's change costs a guest who joined before it.
   *
   * Narrowed here with `readEventTheme`: it is untrusted input, and a hue of `"rose"` would
   * reach `--accent-hue` as a string the browser cannot parse. A malformed answer is `null`,
   * not a refusal, so the theme the guest already has stands.
   */
  readonly theme: EventThemeDto | null
  /** The host's welcome message as the server last said it, or `null` until it has (spec 03). */
  readonly brand: EventBrandDto | null
  /**
   * The server no longer serves this gallery to this guest (`404 event.notFound`): the
   * event is gone, or its account is suspended. Sending is pointless and every upload would
   * fail, so the screen says so instead of offering the form.
   */
  readonly unavailable: boolean
  /**
   * The guest's access is not recognised (`401`): no cookie, or one that expired. The
   * screen sends them to the code entry rather than on to uploads that cannot succeed.
   */
  readonly signedOut: boolean
  /**
   * The host removed this guest (`403 guest.revoked`). Nothing can be sent any more, but the guest
   * still may erase what they sent, so the screen says so and offers only that.
   */
  readonly revoked: boolean
  readonly loading: boolean
  /**
   * A sentence in the guest's current language, ready to render. `null` when nothing
   * has failed.
   */
  readonly error: string | null
  readonly refresh: () => void
  readonly remove: (photoId: string) => Promise<void>
}

/**
 * What went wrong, kept as a fact rather than as a sentence.
 *
 * The sentence is composed at render, from {@link Failure} and the active table, and
 * that is the whole reason this type exists: storing the finished French put the copy
 * table into the read effect's dependencies, so changing language re-read the list. On
 * venue Wi-Fi that is a round trip for a word — and when it failed, the guest was told
 * their list could not be updated, for no reason except that they had tapped the
 * language picker.
 *
 * `code` is the server's own, so a refused deletion still says *why* it was refused,
 * in whichever language the guest is reading when they look at it.
 */
type Failure =
  | { readonly kind: 'load' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'signedOut' }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'action'; readonly code: string | null }

/**
 * The poll's cadence lives in `pollCadence.ts`. It is **not** a push notification (ROADMAP §2.1
 * rules those out) and not a stream: the guests' public stream is capped per IP, and a room
 * behind one address would take the projector's own feed away.
 */

/**
 * A poll that has not answered by then is given up as a silent failure. A half-dead connection
 * on flapping venue Wi-Fi can hold a request open for minutes, and while it is the only read in
 * flight every later poll waits for it.
 */
const POLL_TIMEOUT_MS = 15_000

/**
 * A read still in flight this long when the guest comes back to the tab is presumed dead (the
 * phone was in a pocket, the radio slept) and is replaced by a fresh one. Shorter than that, it
 * is a read that is merely slow, and replacing it would only abort an answer on its way.
 */
const RETURN_REPLACES_AFTER_MS = 3_000

/** How long the announcement stays on screen. Long enough to be read twice. */
const ARRIVAL_SHOWN_MS = 15_000

/** The 200 ms buzz of a phone that knows its guest's photo is about to be on the wall. */
const VIBRATE_MS = 200

/**
 * What a failed read means. Only these two answers are about the guest's standing and not the
 * network, so only they stop the screen offering uploads; everything else stays "try again".
 */
const classifyRead = (cause: unknown): Failure => {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return { kind: 'signedOut' }
    if (cause.status === 403 && cause.code === 'guest.revoked') return { kind: 'revoked' }
    if (cause.status === 404 && cause.code === 'event.notFound') return { kind: 'gone' }
  }
  return { kind: 'load' }
}

interface Loaded {
  readonly photos: readonly GuestPhotoDto[]
  readonly arrival: Arrival | null
  readonly acceptingUploads: boolean
  readonly theme: EventThemeDto | null
  readonly brand: EventBrandDto | null
  readonly loading: boolean
  readonly failure: Failure | null
}

export const useMyPhotos = (slug: string): MyPhotosState => {
  const t = useTranslations()
  const api = useApi()
  const [state, setState] = useState<Loaded>({
    photos: [],
    arrival: null,
    acceptingUploads: true,
    theme: null,
    brand: null,
    loading: true,
    failure: null,
  })
  const [attempt, setAttempt] = useState(0)

  /**
   * Marks the refetch as pending here rather than in the effect body: setting state
   * inside an effect causes a cascading render and lint rejects it. The first load
   * already starts from `loading: true`.
   */
  const refresh = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, failure: null }))
    setAttempt((current) => current + 1)
  }, [])

  /**
   * The list as the last read left it, and the state a read starts from: what tells a
   * transition from a first sight, kept outside React state so deciding it, and buzzing the
   * phone, are not done inside a state updater (StrictMode runs those twice).
   */
  const knownRef = useRef<ReadonlyMap<string, PhotoStatus> | null>(null)
  /**
   * A read is in the air, since when, and whether it is the poll's. A poll never aborts it to
   * start another: on slow Wi-Fi it would never finish. Only the timeout below, and the guest's
   * return to the tab, give a quiet read up.
   */
  const inFlightRef = useRef<{ readonly since: number; readonly quiet: boolean } | null>(null)
  /** The next answer is the one the guest finds on coming back to the tab. */
  const returnedRef = useRef(false)
  /** The next read is the poll's, not the guest's: it fails in silence. */
  const quietRef = useRef(false)

  /**
   * A read nobody asked for with a button: no spinner, no cleared error, and nothing when one
   * is already on its way — unless that one is dead. A quiet read is dead once it has been in
   * the air for `replaceAfterMs` (the guest's return) or, failing that, for the poll's own
   * timeout. A read the guest asked for (the first, a refresh, a deletion's re-read) has no
   * timeout of its own, so it is only presumed dead after `POLL_TIMEOUT_MS`, and it is then
   * replaced by a read that keeps its standing: the spinner stays until it answers and a
   * failure is still shown. Without that a request the network swallowed would hold the flight
   * for ever, and the poll that tells the guest their photo is on the wall would never run.
   */
  const readQuietly = useCallback((replaceAfterMs?: number) => {
    const flight = inFlightRef.current
    let quiet = true
    if (flight !== null) {
      const age = Date.now() - flight.since
      const after = flight.quiet ? (replaceAfterMs ?? POLL_TIMEOUT_MS) : POLL_TIMEOUT_MS
      if (age < after) return
      quiet = flight.quiet
    }
    quietRef.current = quiet
    setAttempt((current) => current + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    const quiet = quietRef.current
    quietRef.current = false
    inFlightRef.current = { since: Date.now(), quiet }
    // Only the poll gives up: a read the guest asked for has a spinner and a retry button.
    const timeout = quiet
      ? window.setTimeout(() => {
          current = false
          inFlightRef.current = null
          // The abort is for a transport that listens; `current` is for one that does not.
          controller.abort()
        }, POLL_TIMEOUT_MS)
      : undefined

    api.myPhotos(slug, controller.signal).then(
      (response) => {
        if (!current) return
        window.clearTimeout(timeout)
        inFlightRef.current = null
        const before = knownRef.current
        knownRef.current = new Map(response.items.map((photo) => [photo.id, photo.status]))
        // Only a photo this screen has seen waiting counts: a first read, and a photo that
        // arrives already published (an event that publishes by itself), are not a moment.
        const published =
          before !== null &&
          response.items.some(
            (photo) => photo.status === 'published' && before.get(photo.id) === 'pending',
          )
        const whileAway = returnedRef.current
        returnedRef.current = false
        // A phone in a pocket buzzes in the room; one that is being looked at has no need, and
        // a tab in the background is refused the buzz anyway.
        if (published && !whileAway) navigator.vibrate?.(VIBRATE_MS)
        // Written back so the next open of the screen paints it first. Only a theme this build
        // can read: `null` (absent from an older server, or malformed) leaves the stored one.
        const theme = readEventTheme(response.theme)
        if (theme !== null) rememberEventTheme(slug, theme)
        setState((previous) => ({
          photos: response.items,
          arrival: published ? { whileAway } : previous.arrival,
          acceptingUploads: response.acceptingUploads ?? true,
          // A later read that carries none does not take the theme back: what was learned stands.
          theme: theme ?? previous.theme,
          brand: response.brand ?? previous.brand,
          loading: false,
          failure: null,
        }))
      },
      (cause: unknown) => {
        if (!current) return
        // The abort is this effect's own cleanup — StrictMode mounts twice — and not
        // a failure to report to the guest.
        if (isAbortError(cause)) return
        window.clearTimeout(timeout)
        inFlightRef.current = null
        // The guest has not found anything on this read, so whoever comes next finds it as a
        // guest who was looking: left set, a later arrival would be told as one that went by
        // while they were away, and the phone would not buzz.
        returnedRef.current = false
        const failure = classifyRead(cause)
        // A poll that fails is a venue Wi-Fi blip in the middle of a party: the list the guest
        // can see is still true, and a red notice that comes and goes on its own is noise. Only
        // the answers about the guest's standing are news, whoever asked.
        if (quiet && failure.kind === 'load') return
        // The photos already on screen stay: a read that fails (a moment of bad Wi-Fi) is
        // news about the read, and this list is what tells the guest their uploads arrived.
        // Only the very first read has nothing to keep.
        setState((previous) => ({ ...previous, loading: false, failure }))
      },
    )

    return () => {
      current = false
      window.clearTimeout(timeout)
      inFlightRef.current = null
      controller.abort()
    }
  }, [api, slug, attempt])

  /**
   * The announcement leaves by itself. "Look up" is only true for a moment, and a line that
   * stayed under the list for an hour would be false.
   */
  const announced = state.arrival
  useEffect(() => {
    if (announced === null) return
    const timer = window.setTimeout(
      () => setState((previous) => ({ ...previous, arrival: null })),
      ARRIVAL_SHOWN_MS,
    )
    return () => window.clearTimeout(timer)
  }, [announced])

  /**
   * Waiting for the host is the one state that ends on its own, so it is the only one worth
   * re-reading for — and only while the guest is looking. A hidden tab asks nothing, and the
   * first thing it does on coming back is one read, which is how a photo published while the
   * phone was in a pocket is found.
   */
  // Not once the server has said the guest has no standing here: every read would be refused.
  const refused =
    state.failure?.kind === 'gone' ||
    state.failure?.kind === 'signedOut' ||
    state.failure?.kind === 'revoked'
  const pending = refused ? 0 : state.photos.filter((photo) => photo.status === 'pending').length
  /**
   * When the host was last given something new to look at, and how many photos waited then. The
   * slow-down is the host's silence since that moment: a photo uploaded after four silent
   * minutes is a new reason to look up quickly, not the thirty-second wait of the old one.
   */
  const waitingSinceRef = useRef(0)
  const waitingCountRef = useRef(0)
  useEffect(() => {
    if (pending > waitingCountRef.current) waitingSinceRef.current = Date.now()
    waitingCountRef.current = pending
    if (pending === 0) return

    let timer: number | undefined
    const disarm = () => window.clearTimeout(timer)
    const arm = () => {
      disarm()
      if (document.visibilityState !== 'visible') return
      const slow = Date.now() - waitingSinceRef.current >= POLL_SLOW_AFTER_MS
      timer = window.setTimeout(
        () => {
          readQuietly()
          arm()
        },
        pollDelayMs(slow, Math.random),
      )
    }
    const onVisibility = () => {
      disarm()
      if (document.visibilityState !== 'visible') return
      returnedRef.current = true
      readQuietly(RETURN_REPLACES_AFTER_MS)
      arm()
    }

    arm()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disarm()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pending, readQuietly])

  const remove = useCallback(
    async (photoId: string) => {
      try {
        await api.deleteMyPhoto(slug, photoId)
        // The photo leaves the list now and not when the re-read answers: the list is kept
        // when that read fails, and a deleted photograph still listed under a failure would
        // read as a deletion that did not happen.
        setState((previous) => ({
          ...previous,
          photos: previous.photos.filter((photo) => photo.id !== photoId),
          loading: true,
          failure: null,
        }))
        setAttempt((current) => current + 1)
      } catch (cause) {
        // The list is kept: a refused deletion is not a reason to blank the one screen
        // that tells the guest their photos arrived.
        setState((previous) => ({
          ...previous,
          failure: { kind: 'action', code: cause instanceof ApiError ? cause.code : null },
        }))
      }
    },
    [api, slug],
  )

  /**
   * The sentence, composed here rather than where the failure was caught.
   *
   * This is what lets the read effect above depend on nothing but the request, and it is
   * also the honest behaviour: a guest who changes language while a refusal is on screen
   * reads the refusal in the language they just chose.
   */
  const error = useMemo<string | null>(() => {
    if (state.failure === null) return null
    // Said by the screen as a whole, not as a line above "Vos envois".
    if (
      state.failure.kind === 'gone' ||
      state.failure.kind === 'signedOut' ||
      state.failure.kind === 'revoked'
    ) {
      return null
    }
    if (state.failure.kind === 'load') return t.upload.mineFailed
    return state.failure.code === null ? t.errors.unknown : messageForCode(state.failure.code, t)
  }, [state.failure, t])

  return {
    photos: state.photos,
    arrival: state.arrival,
    acceptingUploads: state.acceptingUploads,
    theme: state.theme,
    brand: state.brand,
    unavailable: state.failure?.kind === 'gone',
    signedOut: state.failure?.kind === 'signedOut',
    revoked: state.failure?.kind === 'revoked',
    loading: state.loading,
    error,
    refresh,
    remove,
  }
}
