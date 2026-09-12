import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../../../app/useApi'
import { rememberGuestSession } from '../../../lib/guestSession'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
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
  /** A French sentence, ready to render. `null` when nothing has failed. */
  readonly error: string | null
  readonly join: (input: JoinInput) => void
  readonly continueToUpload: (slug: string) => void
}

const messageFor = (cause: unknown): string =>
  // `ApiError.message` is already the French sentence for the server's error code, so
  // there is nothing to look up here and nothing the server sent to render.
  cause instanceof ApiError ? cause.message : fr.errors.unknown

export const useJoin = (): JoinState => {
  const api = useApi()
  const navigate = useNavigate()
  const [state, setState] = useState<Omit<JoinState, 'join' | 'continueToUpload'>>({
    phase: 'idle',
    event: null,
    error: null,
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
      navigate(`/e/${encodeURIComponent(slug)}/upload`, { replace: true })
    },
    [navigate],
  )

  const join = useCallback(
    (input: JoinInput) => {
      // A double-tapped "Rejoindre" on a slow connection would otherwise create two
      // guests for one person, and the second cookie would orphan the first.
      if (inFlight.current) return
      inFlight.current = true
      setState((previous) => ({ ...previous, phase: 'joining', error: null }))

      api.join(input.code.trim(), input.displayName).then(
        (response) => {
          inFlight.current = false
          // Written before the liveness check: the upload screen needs this even when
          // this component is already gone, which is the normal case on success.
          rememberGuestSession({ event: response.event, displayName: response.displayName })
          if (!alive.current) return
          if (input.advance) {
            continueToUpload(response.event.slug)
            return
          }
          setState({ phase: 'resolved', event: response.event, error: null })
        },
        (cause: unknown) => {
          inFlight.current = false
          if (!alive.current) return
          // The event is kept: a failure while adding a name must not throw the guest
          // back to typing the code they already got right.
          setState((previous) => ({
            phase: previous.event === null ? 'idle' : 'resolved',
            event: previous.event,
            error: messageFor(cause),
          }))
        },
      )
    },
    [api, continueToUpload],
  )

  return { ...state, join, continueToUpload }
}
