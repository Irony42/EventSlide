import { createContext, useContext } from 'react'
import type { Locale } from './locale'

/**
 * The channel a surface uses to say what language it turned out to be in.
 *
 * Its own file, beside `localeContext.ts`, for the reason that one gives: a `.tsx` that
 * exports both a component and a value breaks fast refresh, and the lint rule that says
 * so is right.
 *
 * ## The problem this exists for
 *
 * Every other surface knows its language before it renders anything. A guest's and a
 * host's come from `localStorage` and `navigator.languages`, which are readable
 * synchronously in `LocaleProvider`'s `useState` initialiser — that placement is
 * deliberate, because an effect would paint the join screen in French and repaint it in
 * German.
 *
 * The **wall** cannot do that. Its language is a setting on the event
 * (`src/domain/events/eventLanguage.ts` says why), so it arrives on the wall response,
 * one network round trip after the projector has already rendered its shell. And the
 * shell is exactly what has to be told: `AppShell` owns `<html lang>` and it sits *above*
 * the page that does the fetching, so the page has to announce upward.
 *
 * ## Why not lift the fetch instead
 *
 * The obvious React answer is to move `useWallPlaylist` into the layout and pass the
 * response down. It was not taken: that hook opens the SSE subscription, owns the
 * refetch-on-signal loop and the offline flag, and hoisting it would put the projector's
 * whole data spine in the route table — where `WallPage.test.tsx` cannot reach it, and
 * where a second surface under the same layout would silently share one subscription.
 * One setter crossing one boundary is the smaller change, and it is the only thing
 * crossing it.
 *
 * ## What the default means
 *
 * A no-op, and it is not a swallowed error. A wall rendered outside `DeferredLocale` — a
 * component test mounting `WallPage` on its own — has no shell above it to tell, and
 * there is nothing for the announcement to do. `DeferredLocale` is in the route table, so
 * the running app always has one.
 */
export const announceLocaleContext = createContext<(locale: Locale) => void>(() => {})

/**
 * Report the language this surface has resolved to, so the shell above it can follow.
 *
 * Idempotent and safe to call on every render with the same value: the provider stores it
 * in state, and React bails out of a re-render when the value has not changed.
 */
export const useAnnounceLocale = (): ((locale: Locale) => void) => useContext(announceLocaleContext)
