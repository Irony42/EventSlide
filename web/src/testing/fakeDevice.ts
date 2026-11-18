import { vi } from 'vitest'

/**
 * A phone, a laptop or an Android, as far as the save button can tell (spec 24), for a jsdom
 * that has none of the three.
 *
 * jsdom has no `navigator.share`, no `navigator.canShare`, no `matchMedia` and no object
 * addresses, which is exactly the set `saveStrategy` and `usePhotoSave` read. This stands in
 * for them the way `FakeEventSource` stands in for the browser's stream: a double of the
 * platform at its edge, not of any application module. Everything is installed on the real
 * `navigator` and `window` as own, configurable properties, and `restore` removes them again,
 * so a test file that forgets neither leaks into the next.
 *
 * Playwright's WebKit does not emulate iOS's share sheet, so this is also all the share path
 * has below a real iPhone (docs/TESTING.md, "Appareils réels").
 */

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export type DeviceKind = 'iphone' | 'android' | 'desktop'

export interface FakeDeviceOptions {
  readonly kind: DeviceKind
  /** `navigator.canShare({ files })`. Defaults to what the kind's real browser answers: true. */
  readonly canShareFiles?: boolean
  /** What `navigator.share` does. Defaults to resolving at once. */
  readonly share?: (data: ShareData) => Promise<void>
}

export interface FakeDevice {
  /** Every `navigator.share` call, in order. */
  readonly shared: ShareData[]
  /** Every file handed to the download manager: its address and the name it was given. */
  readonly downloads: { readonly href: string; readonly name: string }[]
  readonly share: ReturnType<typeof vi.fn>
  readonly restore: () => void
}

const FACTS: Readonly<
  Record<
    DeviceKind,
    { userAgent: string; platform: string; maxTouchPoints: number; coarse: boolean }
  >
> = {
  iphone: { userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5, coarse: true },
  android: { userAgent: ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5, coarse: true },
  desktop: { userAgent: DESKTOP_UA, platform: 'Win32', maxTouchPoints: 0, coarse: false },
}

/** An `AbortError` or a `NotAllowedError`, as the browser raises them from `share()`. */
export const domError = (name: string): DOMException => new DOMException(name, name)

export const useFakeDevice = (options: FakeDeviceOptions): FakeDevice => {
  const facts = FACTS[options.kind]
  const shared: ShareData[] = []
  const downloads: { href: string; name: string }[] = []

  const share = vi.fn(async (data: ShareData) => {
    shared.push(data)
    await (options.share?.(data) ?? Promise.resolve())
  })

  /** What each key held before, as its own property, so that `restore` puts back what the test setup installed. */
  const before: [object, string, PropertyDescriptor | undefined][] = []
  const define = (target: object, key: string, value: unknown): void => {
    before.push([target, key, Object.getOwnPropertyDescriptor(target, key)])
    Object.defineProperty(target, key, { configurable: true, writable: true, value })
  }

  define(navigator, 'userAgent', facts.userAgent)
  define(navigator, 'platform', facts.platform)
  define(navigator, 'maxTouchPoints', facts.maxTouchPoints)
  define(navigator, 'share', share)
  define(navigator, 'canShare', () => options.canShareFiles ?? true)
  define(window, 'matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' && facts.coarse,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))

  let counter = 0
  define(URL, 'createObjectURL', () => `blob:fake/${(counter += 1)}`)
  define(URL, 'revokeObjectURL', () => undefined)

  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, name: this.download })
  })

  return {
    shared,
    downloads,
    share,
    restore: () => {
      click.mockRestore()
      for (const [target, key, descriptor] of before.reverse()) {
        if (descriptor === undefined) Reflect.deleteProperty(target, key)
        else Object.defineProperty(target, key, descriptor)
      }
    },
  }
}
