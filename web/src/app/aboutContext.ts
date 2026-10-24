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
