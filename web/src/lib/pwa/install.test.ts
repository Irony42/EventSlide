import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isInstalled, needsManualInstructions, rememberDismissal, wasDismissed } from './install'

/**
 * Three browser families that disagree about everything here, reduced to two questions:
 * is it already installed, and is a sentence the only thing we can offer?
 *
 * Every case below sets up a browser rather than a user agent string. That is the point:
 * a UA check would be wrong within a year, and these properties are what the platforms
 * actually differ on.
 */

const asIos = (standalone: boolean): void => {
  Object.defineProperty(navigator, 'standalone', {
    value: standalone,
    configurable: true,
  })
}

const notIos = (): void => {
  Reflect.deleteProperty(navigator, 'standalone')
}

const displayMode = (standalone: boolean): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('standalone') && standalone,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

beforeEach(() => {
  notIos()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  notIos()
  localStorage.clear()
})

describe('isInstalled', () => {
  it('is false in an ordinary browser tab', () => {
    displayMode(false)

    expect(isInstalled()).toBe(false)
  })

  it('is true when the app was launched from the home screen', () => {
    displayMode(true)

    expect(isInstalled()).toBe(true)
  })

  it('is true on iOS, which answers with its own property rather than the media query', () => {
    // Safari sets `navigator.standalone` and does not reliably answer
    // `display-mode: standalone`, so trusting the standard check alone offers an
    // installed app the chance to install itself.
    displayMode(false)
    asIos(true)

    expect(isInstalled()).toBe(true)
  })

  it('says not installed when the browser cannot answer the question', () => {
    // A stubbed `matchMedia` that does not understand the query. Offering to install
    // something already installed is a far better failure than throwing on a guest's
    // upload screen.
    vi.spyOn(window, 'matchMedia').mockImplementation(() => {
      throw new Error('unsupported query')
    })

    expect(isInstalled()).toBe(false)
  })
})

describe('needsManualInstructions', () => {
  it('is true on iOS Safari, where there is no prompt to raise', () => {
    asIos(false)

    expect(needsManualInstructions()).toBe(true)
  })

  it('is false once the iOS app is on the home screen', () => {
    asIos(true)

    expect(needsManualInstructions()).toBe(false)
  })

  it('is false anywhere that is not iOS', () => {
    // Detected by the presence of Safari's own property rather than by a user-agent
    // string, so it does not rot the next time a browser changes how it introduces
    // itself.
    expect(needsManualInstructions()).toBe(false)
  })
})

describe('dismissal', () => {
  it('is not remembered until the guest says no', () => {
    expect(wasDismissed()).toBe(false)
  })

  it('outlives the tab, because "no" was an answer about the app and not about today', () => {
    // A guest who dismissed this at 21:00 must not be asked again when they reopen the
    // gallery at midnight — which is exactly when the second half of the photos happen.
    rememberDismissal()

    expect(wasDismissed()).toBe(true)
  })

  it('treats a storage area that throws as "not yet asked"', () => {
    // Safari in private browsing. Asking once per session beats never offering at all.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(wasDismissed()).toBe(false)
  })

  it('does not fail the screen when the answer cannot be written down', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(() => rememberDismissal()).not.toThrow()
  })
})
