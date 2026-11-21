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
  /** The instant the page on screen was read (epoch ms): what "the hour has come" is measured against. */
  readonly readAt: number
  readonly retry: () => void
}

type Answer =
  | { readonly phase: 'ready'; readonly page: GuestInvitePageDto; readonly readAt: number }
  | { readonly phase: 'unavailable' | 'failed' }

const isNotAvailable = (cause: unknown): boolean =>
  cause instanceof ApiError && cause.code === 'guestInvite.notAvailable'

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

    const read = () => {
      if (reading) return
      reading = true
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
          if (shown.current === null) setAnswer({ token, value: { phase: 'failed' } })
        },
      )
    }

    shown.current = null
    read()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') read()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', read)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', read)
      stop.abort()
    }
  }, [api, token, attempt])

  const retry = useCallback(() => {
    setAnswer(null)
    setAttempt((n) => n + 1)
  }, [])

  const current = answer !== null && answer.token === token ? answer.value : null
  if (current === null) return { phase: 'loading', page: null, readAt: 0, retry }
  return current.phase === 'ready'
    ? { phase: 'ready', page: current.page, readAt: current.readAt, retry }
    : { phase: current.phase, page: null, readAt: 0, retry }
}
