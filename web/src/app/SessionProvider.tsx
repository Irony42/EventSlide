import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { asError, isAbortError } from '../lib/http'
import { onSessionExpired } from '../lib/sessionExpiry'
import { SessionContext, type SessionData } from './sessionContext'
import { useApi } from './useApi'

export interface SessionProviderProps {
  /**
   * What the answer is kept for. A different value is a different session as far as the
   * readers are concerned: the answer is dropped and read again when somebody needs it.
   */
  readonly scope: string
  readonly children: ReactNode
}

/** Nothing known, and a reader waiting for it: what every reader sees on its first render. */
const UNKNOWN: SessionData = { session: null, loading: true, error: null }

/**
 * Reads `GET /api/auth/me` once and shares the answer with the header menu, `RequireAuth`, the
 * must-change-password gate and every page that shows the account.
 *
 * They used to ask for themselves: a load of any `/admin/**` page sent the request three times,
 * the last only once `RequireAuth` had answered, so a host sat through two waits in a row.
 *
 * **Lazy, and that is on purpose.** Nothing is asked until a reader mounts (`useSession`), so
 * the sign-in page, which has no use for the answer, still costs no request.
 *
 * **Shared state must be told when it went stale, and three things do.**
 *
 * - **The `scope`.** An answer is kept for one scope and dropped the moment the scope changes,
 *   *before* anything under it renders. The host's layout gives it "inside `/admin`" or not, so
 *   crossing that border (which is all signing in and signing out are) starts a new read: an
 *   answer of "nobody" read on the invitation page is not served to the console it has just
 *   opened, and the account that left is not served to the next one.
 * - **`useForgetSession`**, for a change that does not cross the border: signing in from the
 *   invitation's own link (`/invite` to `/login` and back is all outside `/admin`), and
 *   choosing a password, which the gate reads.
 * - **`refresh`**, for a page that is waiting on the new answer (`SecurityPage`, the
 *   invitation page).
 *
 * **It also hears the session end** (`lib/sessionExpiry.ts`): a `401 auth.required` from any
 * request raises `expired`, which `useSessionExpired` reads. The cached answer is deliberately
 * not dropped then: `RequireAuth` would redirect to the sign-in form and the page, and whatever
 * the host had typed into it, would be gone. Crossing the scope or `forget` clears the flag.
 *
 * Mounted by `HostLayout`: every reader is on the host's screens (`/login`, `/invite/:token` and
 * `/admin/**`), and the guest and the wall have no account to ask about.
 */
export function SessionProvider({ scope, children }: SessionProviderProps) {
  const api = useApi()
  const [data, setData] = useState<SessionData>(UNKNOWN)
  const [requested, setRequested] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [seenScope, setSeenScope] = useState(scope)
  const [expired, setExpired] = useState(false)

  // Derived during render and not in an effect, on purpose: an effect would run after the
  // readers of the new scope had already rendered the old answer, and `RequireAuth` acts on
  // what it renders (a stale "nobody" is a redirect to the form). React re-renders this
  // component straight away with the reset state, before it renders anything below.
  if (seenScope !== scope) {
    setSeenScope(scope)
    setData(UNKNOWN)
    setRequested(false)
    setExpired(false)
  }

  const request = useCallback(() => setRequested(true), [])

  /**
   * Marks the new read as pending here rather than in the effect body: setting state
   * synchronously inside an effect causes a cascading render, and lint rejects it. The first
   * load already starts with `loading: true`, so the effect never needs to set it.
   */
  const refresh = useCallback(() => {
    setData((previous) => ({ ...previous, loading: true, error: null }))
    setAttempt((current) => current + 1)
    setRequested(true)
  }, [])

  const forget = useCallback(() => {
    setData(UNKNOWN)
    setRequested(false)
    setExpired(false)
  }, [])

  useEffect(() => onSessionExpired(() => setExpired(true)), [])

  useEffect(() => {
    if (!requested) return

    const controller = new AbortController()
    let current = true

    api.session(controller.signal).then(
      (session) => {
        if (current) setData({ session, loading: false, error: null })
      },
      (cause: unknown) => {
        if (!current) return
        // The abort came from this effect's own cleanup (StrictMode mounts twice, a `forget`
        // lands mid-flight) and is not a failure to report to the host.
        if (isAbortError(cause)) return
        setData({
          session: null,
          loading: false,
          error: asError(cause),
        })
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [api, attempt, requested])

  const store = useMemo(
    () => ({ data, requested, expired, request, refresh, forget }),
    [data, requested, expired, request, refresh, forget],
  )

  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>
}
