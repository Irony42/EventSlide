import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { readEventTheme } from '../../../design-system/eventTheme'
import { rememberEventTheme } from '../../../lib/guestSession'
import { ApiError, isAbortError } from '../../../lib/http'
import { messageForCode } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { EventThemeDto, GuestPhotoDto } from '../../../lib/api/dto'

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

export interface MyPhotosState {
  readonly photos: readonly GuestPhotoDto[]
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
  readonly acceptingUploads: boolean
  readonly theme: EventThemeDto | null
  readonly loading: boolean
  readonly failure: Failure | null
}

export const useMyPhotos = (slug: string): MyPhotosState => {
  const t = useTranslations()
  const api = useApi()
  const [state, setState] = useState<Loaded>({
    photos: [],
    acceptingUploads: true,
    theme: null,
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

  useEffect(() => {
    const controller = new AbortController()
    let current = true

    api.myPhotos(slug, controller.signal).then(
      (response) => {
        if (!current) return
        // Written back so the next open of the screen paints it first. Only a theme this build
        // can read: `null` (absent from an older server, or malformed) leaves the stored one.
        const theme = readEventTheme(response.theme)
        if (theme !== null) rememberEventTheme(slug, theme)
        setState((previous) => ({
          photos: response.items,
          acceptingUploads: response.acceptingUploads ?? true,
          // A later read that carries none does not take the theme back: what was learned stands.
          theme: theme ?? previous.theme,
          loading: false,
          failure: null,
        }))
      },
      (cause: unknown) => {
        if (!current) return
        // The abort is this effect's own cleanup — StrictMode mounts twice — and not
        // a failure to report to the guest.
        if (isAbortError(cause)) return
        // The photos already on screen stay: a read that fails (a moment of bad Wi-Fi) is
        // news about the read, and this list is what tells the guest their uploads arrived.
        // Only the very first read has nothing to keep.
        setState((previous) => ({ ...previous, loading: false, failure: classifyRead(cause) }))
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [api, slug, attempt])

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
    acceptingUploads: state.acceptingUploads,
    theme: state.theme,
    unavailable: state.failure?.kind === 'gone',
    signedOut: state.failure?.kind === 'signedOut',
    revoked: state.failure?.kind === 'revoked',
    loading: state.loading,
    error,
    refresh,
    remove,
  }
}
