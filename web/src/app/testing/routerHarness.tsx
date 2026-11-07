import { vi } from 'vitest'
import { AppRoutes } from '../router'
import { aSessionUser, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { SessionResponse } from '../../lib/api/dto'

export const at = (route: string) => renderWithProviders(<AppRoutes />, { route })

/** A host with a resolved session, which is what every `/admin/**` address needs. */
export const asHost = (route: string) => {
  const api = fakeApi({
    session: vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser(),
    })),
  })
  return renderWithProviders(<AppRoutes />, { api, route })
}

/**
 * The value of `<html lang>` at the moment `text` first reaches the DOM.
 *
 * Not "once `findByText` resolves", which is a later moment by an amount nobody controls:
 * whether React's passive effects have run by then depends on the order of two timers
 * that Node does not fix, and `main` went red on exactly that once, green on a re-run.
 * A MutationObserver callback is a microtask queued by the commit itself, so it reads the
 * attribute before anything scheduled after that commit has had a turn — a screen reader
 * arriving on the first frame hears what this sees.
 *
 * It gives up after `timeoutMs` with the text it was waiting for, rather than hanging to
 * the test's own timeout with a message that names nothing, and it disconnects either way
 * so an abandoned observer cannot resolve on a later test's DOM.
 */
export const langWhenShown = (text: string, timeoutMs = 3_000): Promise<string> =>
  new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!document.body.textContent?.includes(text)) return
      stop()
      resolve(document.documentElement.lang)
    })
    const timer = setTimeout(() => {
      stop()
      reject(new Error(`"${text}" never reached the DOM within ${timeoutMs} ms`))
    }, timeoutMs)
    const stop = (): void => {
      observer.disconnect()
      clearTimeout(timer)
    }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  })
