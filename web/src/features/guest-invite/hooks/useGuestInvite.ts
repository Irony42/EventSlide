import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../../lib/http'
import type { GuestInvitePageDto } from '../../../lib/api/dto'
import { useApi } from '../../../lib/useApi'

/**
 * The invitation a guest opened, as view-state (spec 29).
 *
 * **No rule lives here.** Which of the four screens this is, whether the host's address and word
 * are still served, whether the way into the wall is open: all the server's, in one answer, and the
 * page draws it. This only tells the answers apart (the invitation, "not available", a failure
 * worth a retry) and **reads again when the page comes back to the front**: a tab left open
 * through the opening of the party (the button for the wall appears) or through a change of the
 * join code (the old button would lead nowhere), or through the host switching the link off.
 *
 * A re-read keeps what is on screen until it has an answer, so the page does not flash a
 * spinner over an invitation somebody is reading. A re-read that fails for the network leaves the
 * last invitation as it was; one that answers "not available" replaces it.
 */

export type GuestInvitePhase = 'loading' | 'ready' | 'unavailable' | 'failed'

export interface GuestInviteState {
  readonly phase: GuestInvitePhase
  /** Present once `ready`. */
  readonly page: GuestInvitePageDto | null
  /**
   * The failure was the box asking to slow down (`429`), not the connection: the page says so,
   * because "check your connection" would send a guest in a crowded room to look at the wrong thing.
   */
  readonly busy: boolean
  /** The instant the page on screen was read (epoch ms): what "the hour has come" is measured against. */
  readonly readAt: number
  readonly retry: () => void
  /** Reads again **without** clearing the page: what a guest is typing on it stays. */
  readonly refresh: () => void
}

type Answer =
  | { readonly phase: 'ready'; readonly page: GuestInvitePageDto; readonly readAt: number }
  | { readonly phase: 'unavailable' }
  | { readonly phase: 'failed'; readonly busy: boolean }

const isNotAvailable = (cause: unknown): boolean =>
  cause instanceof ApiError && cause.code === 'guestInvite.notAvailable'

/**
 * Two re-reads are never closer than this. A tab switch fires `visibilitychange` and `focus`
 * together, and every read spends the per-address budget the whole room shares (the page and its
 * logo, 200 a minute): one tap should cost one request.
 */
export const REREAD_MIN_INTERVAL_MS = 15_000

const isBusy = (cause: unknown): boolean => cause instanceof ApiError && cause.status === 429

export const useGuestInvite = (token: string): GuestInviteState => {
  const api = useApi()
  const [attempt, setAttempt] = useState(0)
  /** Tagged with the link that produced it: an answer about one link is never shown under another. */
  const [answer, setAnswer] = useState<{ readonly token: string; readonly value: Answer } | null>(
    null,
  )
  const shown = useRef<GuestInvitePageDto | null>(null)

  useEffect(() => {
    const stop = new AbortController()
    let reading = false

    let lastStarted = Number.NEGATIVE_INFINITY

    const read = () => {
      if (reading) return
      reading = true
      lastStarted = Date.now()
      api.guestInvitePage(token, stop.signal).then(
        (page) => {
          reading = false
          if (stop.signal.aborted) return
          shown.current = page
          setAnswer({ token, value: { phase: 'ready', page, readAt: Date.now() } })
        },
        (cause: unknown) => {
          reading = false
          if (stop.signal.aborted) return
          if (isNotAvailable(cause)) {
            shown.current = null
            setAnswer({ token, value: { phase: 'unavailable' } })
            return
          }
          // A failed re-read leaves the invitation that is on screen: only a first read fails the page.
          if (shown.current === null) {
            setAnswer({ token, value: { phase: 'failed', busy: isBusy(cause) } })
          }
        },
      )
    }

    // The page coming back to the front: at most one read per interval, however many events say so.
    const reread = () => {
      if (Date.now() - lastStarted >= REREAD_MIN_INTERVAL_MS) read()
    }

    shown.current = null
    read()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reread()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', reread)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', reread)
      stop.abort()
    }
  }, [api, token, attempt])

  const retry = useCallback(() => {
    setAnswer(null)
    setAttempt((n) => n + 1)
  }, [])

  const refresh = useCallback(() => setAttempt((n) => n + 1), [])

  const current = answer !== null && answer.token === token ? answer.value : null
  if (current === null)
    return { phase: 'loading', page: null, busy: false, readAt: 0, retry, refresh }
  return current.phase === 'ready'
    ? { phase: 'ready', page: current.page, busy: false, readAt: current.readAt, retry, refresh }
    : {
        phase: current.phase,
        page: null,
        busy: current.phase === 'failed' && current.busy,
        readAt: 0,
        retry,
        refresh,
      }
}
