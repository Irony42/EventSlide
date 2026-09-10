import { useCallback, useEffect, useState } from 'react'
import { useApi } from './ApiProvider'
import type { SessionResponse } from '../lib/api/dto'

export interface SessionState {
  /** `null` until the first answer arrives. Absence is not "logged out". */
  readonly session: SessionResponse | null
  readonly loading: boolean
  readonly error: Error | null
  readonly refresh: () => void
}

/**
 * The current session, from `GET /api/auth/me`.
 *
 * The endpoint answers 200 with `{ authenticated: false }` rather than 401, so a first
 * visit is an ordinary answer and not an error. That distinction is the whole point:
 * "not logged in" sends the host to the login page, while "could not ask" must not —
 * a dropped Wi-Fi connection at a venue would otherwise log the host out mid-event.
 */
export const useSession = (): SessionState => {
  const api = useApi()
  const [state, setState] = useState<Omit<SessionState, 'refresh'>>({
    session: null,
    loading: true,
    error: null,
  })
  const [attempt, setAttempt] = useState(0)

  const refresh = useCallback(() => setAttempt((current) => current + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let current = true

    setState((previous) => ({ ...previous, loading: true, error: null }))

    api.session(controller.signal).then(
      (session) => {
        if (current) setState({ session, loading: false, error: null })
      },
      (cause: unknown) => {
        if (!current) return
        // The abort came from this effect's own cleanup — StrictMode mounts twice —
        // and is not a failure to report to the host.
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setState({
          session: null,
          loading: false,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        })
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [api, attempt])

  return { ...state, refresh }
}
