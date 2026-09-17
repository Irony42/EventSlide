import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLocale, readStoredLocale, storeLocale } from './localePreference'

/**
 * Where the guest's language comes from, and what happens when the browser refuses to
 * help.
 *
 * `localStorage` is cleared between tests by `web/src/testing/setup.ts`; the browser's
 * own preference list is stubbed per test, because a suite whose result depends on the
 * language the developer's machine is set to is a suite that passes here and fails in
 * CI.
 */

const browserSpeaks = (...languages: readonly string[]): void => {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(languages[0] ?? '')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('detectLocale', () => {
  it('follows the browser when the guest has never chosen', () => {
    // The default signal. A German phone scanning a QR code at a French wedding gets
    // German without touching anything, which is the entire feature.
    browserSpeaks('de-DE', 'en-GB')

    expect(detectLocale()).toBe('de')
  })

  it('prefers what the guest chose over what their browser asks for', () => {
    // A guest who picked English on a phone whose system language is Spanish meant it.
    // Re-deciding for them on the next screen is the bug this order prevents.
    browserSpeaks('es-ES')
    storeLocale('en')

    expect(detectLocale()).toBe('en')
  })

  it('falls back to French when the browser asks for nothing this build has', () => {
    browserSpeaks('ja-JP')

    expect(detectLocale()).toBe('fr')
  })

  it('falls back to French when the browser reports no preference at all', () => {
    browserSpeaks()

    expect(detectLocale()).toBe('fr')
  })
})

describe('the stored preference', () => {
  it('survives being written and read back', () => {
    storeLocale('it')

    expect(readStoredLocale()).toBe('it')
  })

  it('is nothing until something is stored', () => {
    expect(readStoredLocale()).toBeNull()
  })

  it('refuses a value an older build or another tab left behind', () => {
    // The key is a string in somebody else's browser, and this build is not the only
    // thing that has ever written to it. A locale with no table would render nothing.
    localStorage.setItem('eventslide.locale', 'pt-BR')

    expect(readStoredLocale()).toBeNull()
  })

  it('reads as no preference when the browser refuses to open storage', () => {
    // Safari in private browsing, and any browser with site data blocked. A QR code
    // scanned from a messaging app opens in exactly that kind of browser, so this is
    // the common case and not the exotic one.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    browserSpeaks('it-IT')

    expect(readStoredLocale()).toBeNull()
    // And detection still answers, from the browser, rather than failing the render.
    expect(detectLocale()).toBe('it')
  })

  it('swallows a refused write rather than failing the screen the guest is on', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    expect(() => storeLocale('es')).not.toThrow()
  })
})
