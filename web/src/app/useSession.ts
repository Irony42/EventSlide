import { useContext, useEffect } from 'react'
import { SessionContext, type SessionStore } from './sessionContext'
import type { SessionResponse } from '../lib/api/dto'

export interface SessionState {
  /** `null` until the first answer arrives. Absence is not "logged out". */
  readonly session: SessionResponse | null
  readonly loading: boolean
  readonly error: Error | null
  readonly refresh: () => void
}

const useStore = (): SessionStore => {
  const store = useContext(SessionContext)
  if (store === null) {
    throw new Error(
      'useSession must be used inside a <SessionProvider>. HostLayout mounts it; use renderWithProviders in a test.',
    )
  }
  return store
}

/**
 * The current session, from `GET /api/auth/me`, shared by every reader under the provider.
 *
 * The endpoint answers 200 with `{ authenticated: false }` rather than 401, so a first
 * visit is an ordinary answer and not an error. That distinction is the whole point:
 * "not logged in" sends the host to the login page, while "could not ask" must not —
 * a dropped Wi-Fi connection at a venue would otherwise log the host out mid-event.
 *
 * Mounting is what asks: the provider reads nothing until some reader needs the answer, and
 * reads it again if it was forgotten while a reader was still mounted.
 */
export const useSession = (): SessionState => {
  const { data, requested, request, refresh } = useStore()

  useEffect(() => {
    if (!requested) request()
  }, [requested, request])

  return { ...data, refresh }
}

/**
 * Says the shared answer may be wrong now: somebody signed in or out, or changed what the
 * session must do. Does not subscribe, so a sign-in form that calls it still asks nothing.
 */
export const useForgetSession = (): (() => void) => useStore().forget
