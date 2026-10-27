import { createContext } from 'react'
import type { About } from '../lib/api/dto'
import { BUILD_ABOUT } from './aboutAnswer'

/**
 * What this box says about itself, shared by everything that shows it.
 *
 * **The default is the build's own answer, not `null`**, and that is the contract and not a
 * convenience: nothing waits on `/api/about` and nothing fails because of it, so a component
 * rendered with no provider above it (a test of one panel) reads exactly what the footer
 * reads before the server has answered. `AboutProvider` is what upgrades it.
 *
 * The context lives in its own module so that `AboutProvider.tsx` exports a component and
 * nothing else, which keeps Fast Refresh working for that file.
 */
export const AboutContext = createContext<About>(BUILD_ABOUT)

/**
 * Whether the server has answered `GET /api/about` yet — successfully or not.
 *
 * **Almost nothing should read it**: the contract above is that nothing waits on the box's
 * answer, and every reader renders the build's own meanwhile. The one exception is a screen
 * that exists only on a box that says so (the operator's console), whose address would otherwise
 * be answered "not found" for the moments before the box has said it has one — which is what a
 * reload of that very page used to look like. The default is `true`: a component rendered with
 * no provider above it has nothing to wait for.
 */
export const AboutAnsweredContext = createContext<boolean>(true)

/**
 * Whether the server has **really said** what it can do: an answer arrived and was one this build
 * can read. A request that failed, a proxy's empty page and a build that has not asked yet are all
 * `false`, because in each of them the value in {@link AboutContext} is the build's own guess.
 *
 * For the one reader that must not act on the guess in the *refusing* direction: a screen that
 * would take a way in away from somebody (the forgotten-password page) on the strength of
 * "this box cannot send mail" must have heard the box say it. The default is `false`: a component
 * rendered with no provider has heard nothing.
 */
export const AboutHeardContext = createContext<boolean>(false)
