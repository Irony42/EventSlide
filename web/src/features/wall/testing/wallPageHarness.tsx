import { act } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { ApiError } from '../../../lib/http'
import { de } from '../../../lib/i18n/de'
import { en } from '../../../lib/i18n/en'
import { es } from '../../../lib/i18n/es'
import { fr } from '../../../lib/i18n/fr'
import { it as italian } from '../../../lib/i18n/it'
import type { Locale } from '../../../lib/i18n/locale'
import type { UiText } from '../../../lib/i18n/translations'
import type { WallItemDto, WallResponse } from '../../../lib/api/dto'
import { aWallItem, aWallResponse } from '../../../testing/renderWithProviders'
import { FakeEventSource } from '../../../testing/fakeEventSource'

/**
 * The projected surface: a screen nobody touches for eight hours.
 *
 * Every state below is one a room actually sees. The two that 1.0 shipped as a black
 * screen — nothing published yet, and a failed load — are the first ones here.
 */

/** Every language the wall speaks: a shortcut missing from one of them is a host who never learns it. */
export const LOCALE_TABLES: readonly (readonly [Locale, UiText])[] = [
  ['fr', fr],
  ['en', en],
  ['de', de],
  ['es', es],
  ['it', italian],
]

export const ROUTE = '/e/camille-et-sacha/display'
export const PATH = '/e/:slug/display'

/**
 * The wall's whole resilience story is about the stream opening, dropping and delivering,
 * so a test drives those three through the shared `EventSource` stand-in
 * (`web/src/testing/fakeEventSource.ts`); `useEventStream` under it is the real one.
 */
export const theStream = (): FakeEventSource => FakeEventSource.latest('the wall')

/**
 * The wall element, which names the layout the room is looking at.
 *
 * It has no accessible identity — a projector has no user to announce anything to — so
 * the attribute is the only handle, and it is the same one the end-to-end visual suite
 * uses to prove it photographed the layout it asked for.
 */
export const theWall = (): HTMLElement => {
  const wall = document.querySelector('[data-wall-layout]')
  if (!(wall instanceof HTMLElement)) throw new Error('the wall named no layout')
  return wall
}

export const streamOpens = async (): Promise<void> => {
  const stream = theStream()
  await act(async () => {
    stream.dispatchEvent(new Event('open'))
  })
}

/** The browser reports an error on the connection: the network dropped, or the server ended it. */
export const streamDrops = async (): Promise<void> => {
  const stream = theStream()
  await act(async () => {
    stream.dispatchEvent(new Event('error'))
  })
}

export const streamSignals = async (type: string): Promise<void> => {
  const stream = theStream()
  await act(async () => {
    stream.dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ type }) }))
  })
}

export const aPopulatedWall = (overrides: Partial<WallResponse> = {}): WallResponse =>
  aWallResponse({ items: [aWallItem()], ...overrides })

export const anEmptyWall = (): WallResponse => aWallResponse({ items: [] })

/**
 * The same wall, as a server build that does not present the code answers it.
 *
 * The key has to be absent rather than `undefined`: `exactOptionalPropertyTypes`
 * distinguishes the two, and the DTO declares `joinCode` optional rather than nullable,
 * so `aWallResponse({ joinCode: undefined })` does not compile. Deleting it here rather
 * than leaving it out of the fixture keeps the code on `aWallResponse` for everyone
 * else — including the enumeration in `useWallPlaylist.settings.test.ts`, which walks
 * the keys the fixture actually has and cannot guard a field that is not on it.
 */
export const withoutJoinCode = (wall: WallResponse): WallResponse => {
  const { joinCode: _absent, ...rest } = wall
  return rest
}

/**
 * And the same for the link, which is the other half of the invitation.
 *
 * Deleted the same way and for the same `exactOptionalPropertyTypes` reason. The wall
 * needs both to print a join block: the code alone would mean rebuilding the URL in the
 * browser from `window.location.origin`, which is the address the projector was opened on
 * rather than the one a guest's phone can reach.
 */
export const withoutJoinUrl = (wall: WallResponse): WallResponse => {
  const { joinUrl: _absent, ...rest } = wall
  return rest
}

export const somePhotos = (count: number): readonly WallItemDto[] =>
  Array.from({ length: count }, (_unused, at) =>
    aWallItem({ id: `photo-${at}`, caption: `Photo ${at}`, authorName: 'Léa' }),
  )

/** Answers with each response in turn, then repeats the last one. */
export const wallSequence = (...responses: readonly WallResponse[]) => {
  let call = -1
  return vi.fn(async (): Promise<WallResponse> => {
    call += 1
    const response = responses[Math.min(call, responses.length - 1)]
    if (response === undefined) throw new Error('wallSequence needs at least one response')
    return response
  })
}

/** Answers the first read, then fails every one after it: a network that went away. */
export const wallThenNetworkDown = (response: WallResponse) => {
  let call = 0
  return vi.fn(async (): Promise<WallResponse> => {
    call += 1
    if (call > 1) throw ApiError.network()
    return response
  })
}

/** Fails the given number of reads, then answers. */
export const wallAfterFailures = (failures: number, response: WallResponse) => {
  let call = 0
  return vi.fn(async (): Promise<WallResponse> => {
    call += 1
    if (call <= failures) throw ApiError.network()
    return response
  })
}

export interface Pending {
  readonly promise: Promise<WallResponse>
  readonly arrives: (response: WallResponse) => void
}

/** A read the test decides the moment of, for the states that exist only while waiting. */
export const pendingWall = (): Pending => {
  let arrives: (response: WallResponse) => void = () => undefined
  const promise = new Promise<WallResponse>((resolve) => {
    arrives = resolve
  })
  return { promise, arrives }
}

/**
 * Reduced motion, as the browser reports it.
 *
 * The design system also handles the query in CSS, but the Ken Burns duration and the
 * reaction floaters are created in JavaScript and have to be withheld rather than
 * merely shortened.
 */
export const prefersReducedMotion = (): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
        // A hand-written stub cannot satisfy a whole DOM interface, which is the one
        // place the web app allows a structural cast.
      }) as unknown as MediaQueryList,
  )
}

/**
 * What every WallPage file needs around its tests: the `EventSource` stand-in installed
 * and restored, and the fullscreen API put back as the test found it. Call it first in the
 * file's `describe('WallPage', ...)`.
 */
export const useWallPageEnvironment = (): void => {
  const nativeEventSource = window.EventSource
  /**
   * The fullscreen API is stood in for by `web/src/testing/setup.ts`, so the originals
   * are captured per test rather than at collection time — and restored, because one
   * test has to describe a browser that implements none of it.
   */
  let nativeRequestFullscreen: () => Promise<void>
  let nativeExitFullscreen: () => Promise<void>

  beforeEach(() => {
    FakeEventSource.reset()
    window.EventSource = FakeEventSource as unknown as typeof window.EventSource
    nativeRequestFullscreen = document.documentElement.requestFullscreen
    nativeExitFullscreen = document.exitFullscreen
  })

  afterEach(() => {
    window.EventSource = nativeEventSource
    document.documentElement.requestFullscreen = nativeRequestFullscreen
    document.exitFullscreen = nativeExitFullscreen
    Reflect.deleteProperty(document, 'fullscreenElement')
    vi.useRealTimers()
  })
}

/** jsdom tracks no fullscreen state, so the projector's is described here. */
export const alreadyFullscreen = (): void => {
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => document.documentElement,
  })
}
