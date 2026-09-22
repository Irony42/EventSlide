import { createContext, useContext } from 'react'
import type { Locale } from './locale'

/**
 * The channel a surface uses to say what language it turned out to be in.
 *
 * Every other surface knows its language before it renders: `localStorage` and
 * `navigator.languages` are readable synchronously. The **wall** cannot, because its
 * language is a setting on the event and arrives on the wall response — one round trip
 * after the projector has rendered its shell, and the shell is what has to be told, since
 * `AppShell` owns `<html lang>` and sits above the page that fetches.
 *
 * **Lifting `useWallPlaylist` into the layout instead was rejected**: it owns the SSE
 * subscription, the refetch-on-signal loop and the offline flag, so hoisting it puts the
 * projector's whole data spine in the route table, where `WallPage.test.tsx` cannot reach
 * it. One setter crossing one boundary is the smaller change.
 *
 * Its own file beside `localeContext.ts` because a `.tsx` exporting both a component and
 * a value breaks fast refresh. The default is a no-op rather than a swallowed error: a
 * `WallPage` mounted alone in a test has no shell above it to tell.
 */
export const announceLocaleContext = createContext<(locale: Locale) => void>(() => {})

/**
 * Report the language this surface has resolved to, so the shell above it can follow.
 * Idempotent: the provider stores it in state and React bails out on an unchanged value.
 */
export const useAnnounceLocale = (): ((locale: Locale) => void) => useContext(announceLocaleContext)
