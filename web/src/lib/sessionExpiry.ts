/**
 * "Your session has expired", as an event any screen can hear (navigation pass, finding H2).
 *
 * The transport (`http.ts`) says it when the server answers `401 auth.required`; `SessionProvider`
 * listens and shows it to the screens under it (`useSessionExpired`). A window event rather than
 * a callback handed down, because the transport is a module and not a component: it has no
 * context to read and must not import React.
 *
 * Nothing here signs anybody out. The page keeps its state, which is the whole point: a
 * moderator mid-evening, or a host half-way through a form, is told and is not thrown away.
 */

/** The `window` event name. Exported for a test that wants to raise one without a request. */
export const SESSION_EXPIRED_EVENT = 'eventslide:session-expired'

/** The code the server answers a request with no valid session (or a disabled account) with. */
export const AUTH_REQUIRED_CODE = 'auth.required'

/** Says the session has expired. Safe to call outside a browser: it does nothing there. */
export const announceSessionExpired = (): void => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
}

/** Listens for the announcement. Returns the function that stops listening. */
export const onSessionExpired = (listener: () => void): (() => void) => {
  window.addEventListener(SESSION_EXPIRED_EVENT, listener)
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, listener)
}
