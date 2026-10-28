import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApi } from '../../../app/useApi'
import { forgetGuestSession, rememberGuestSession } from '../../../lib/guestSession'
import { ApiError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { PublicEventDto } from '../../../lib/api/dto'

/**
 * Resolving a join code, as view-state.
 *
 * No rule about what a valid code looks like lives here. The server normalises case,
 * separators and the confusable characters (docs/API.md section 2) because a guest is
 * reading a printed card in a dark room; re-implementing half of that in the browser
 * would only produce a client that rejects codes the server accepts.
 */

export interface JoinInput {
  readonly code: string
  readonly displayName: string | null
  /** `true` goes straight to the upload screen; `false` stops on the welcome step. */
  readonly advance: boolean
}

export interface JoinState {
  readonly phase: 'idle' | 'joining' | 'resolved'
  /** The event, once a code has resolved. `null` while the guest still has to type one. */
  readonly event: PublicEventDto | null
  /** A sentence in the guest's language, ready to render. `null` when nothing failed. */
  readonly error: string | null
  /** The server's code for that failure, so a screen can add what the sentence cannot say. */
  readonly errorCode: string | null
  readonly join: (input: JoinInput) => void
  /** Goes where the guest was heading: the feed if they came from it, else the upload screen. */
  readonly continueToUpload: (slug: string) => void
  /**
   * "Ce n'est pas votre soirée ?": forgets the event the code resolved to, in this tab and on
   * this device, and goes back to an empty code entry.
   */
  readonly leave: (slug: string) => void
}

/**
 * Where a guest goes once the code is accepted.
 *
 * A guest screen that had no session sends the guest here with the address they wanted
 * (router state, not a query string, so there is nothing to forge from outside the app). It
 * is honoured only for the feed **of the event the code resolved to**: a forwarded link to
 * one event followed by the code of another must not land on the first one's address, and an
 * arbitrary `from` must never become a redirect.
 */
export const destinationAfterJoin = (slug: string, from: unknown): string => {
  const base = `/e/${encodeURIComponent(slug)}`
  return from === `${base}/photos` ? `${base}/photos` : `${base}/upload`
}

export const fromOf = (state: unknown): unknown =>
  typeof state === 'object' && state !== null ? Reflect.get(state, 'from') : undefined

export const useJoin = (): JoinState => {
  const text = useTranslations()
  const api = useApi()
  const navigate = useNavigate()
  const from = fromOf(useLocation().state)
  const [state, setState] = useState<Omit<JoinState, 'join' | 'continueToUpload' | 'leave'>>({
    phase: 'idle',
    event: null,
    error: null,
    errorCode: null,
  })

  const alive = useRef(true)
  const inFlight = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const continueToUpload = useCallback(
    (slug: string) => {
      // `replace`, so Back does not land on `/join/:code` and re-run the automatic
      // submit, which would bounce the guest straight forward again.
      navigate(destinationAfterJoin(slug, from), { replace: true })
    },
    [navigate, from],
  )

  const leave = useCallback(
    (slug: string) => {
      forgetGuestSession(slug)
      setState({ phase: 'idle', event: null, error: null, errorCode: null })
      // The path loses its code, or a reload would resolve it again.
      navigate('/join', { replace: true })
    },
    [navigate],
  )

  const join = useCallback(
    (input: JoinInput) => {
      // A double-tapped "Rejoindre" on a slow connection would otherwise create two
      // guests for one person, and the second cookie would orphan the first.
      if (inFlight.current) return
      inFlight.current = true
      setState((previous) => ({ ...previous, phase: 'joining', error: null, errorCode: null }))

      api.join(input.code.trim(), input.displayName).then(
        (response) => {
          inFlight.current = false
          // Written before the liveness check: the upload screen needs this even when
          // this component is already gone, which is the normal case on success.
          rememberGuestSession({
            event: response.event,
            displayName: response.displayName,
            privacyNotice: response.privacyNotice,
          })
          if (!alive.current) return
          if (input.advance) {
            continueToUpload(response.event.slug)
            return
          }
          setState({ phase: 'resolved', event: response.event, error: null, errorCode: null })
        },
        (cause: unknown) => {
          inFlight.current = false
          if (!alive.current) return
          // The event is kept: a failure while adding a name must not throw the guest
          // back to typing the code they already got right.
          setState((previous) => ({
            phase: previous.event === null ? 'idle' : 'resolved',
            event: previous.event,
            error: messageForError(cause, text),
            errorCode: cause instanceof ApiError ? cause.code : null,
          }))
        },
      )
    },
    [api, continueToUpload, text],
  )

  return { ...state, join, continueToUpload, leave }
}
