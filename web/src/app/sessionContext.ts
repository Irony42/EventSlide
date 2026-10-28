import { createContext } from 'react'
import type { SessionResponse } from '../lib/api/dto'

/** What is known about the session right now. */
export interface SessionData {
  /** `null` until the first answer arrives. Absence is not "logged out". */
  readonly session: SessionResponse | null
  readonly loading: boolean
  readonly error: Error | null
}

/** What `SessionProvider` shares: the answer, and the three things a reader may ask of it. */
export interface SessionStore {
  readonly data: SessionData
  /** Whether anybody has asked yet. The provider reads nothing until somebody does. */
  readonly requested: boolean
  /**
   * The server answered a request with "no valid session" (`401 auth.required`) while this
   * provider was mounted. The shared answer is left alone on purpose: signing the host out
   * client-side would swap the page for the sign-in form and lose whatever they were doing.
   * Cleared when the scope changes or the session is forgotten, which is what signing in again is.
   */
  readonly expired: boolean
  /** Somebody needs the answer. Idempotent: the first call starts the one request. */
  readonly request: () => void
  /** The answer is stale and a reader is waiting for the new one: ask again now. */
  readonly refresh: () => void
  /** The answer is stale and nobody is waiting: drop it, and ask when somebody next needs it. */
  readonly forget: () => void
}

/**
 * The context lives in its own module so that `SessionProvider.tsx` exports a component and
 * nothing else, which keeps Fast Refresh working for that file.
 */
export const SessionContext = createContext<SessionStore | null>(null)
