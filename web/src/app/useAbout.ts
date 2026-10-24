import { useContext } from 'react'
import type { About } from '../lib/api/dto'
import { AboutAnsweredContext, AboutContext } from './aboutContext'

/**
 * What `GET /api/about` says, once it has said it, and the build's own answer until then.
 * Read from `AboutProvider`; the request is made there, once, and not by each caller.
 */
export const useAbout = (): About => useContext(AboutContext)

/**
 * Whether the server has answered yet, for the one screen that cannot be decided before it
 * has: see {@link AboutAnsweredContext}. Everything else reads {@link useAbout} and renders.
 */
export const useAboutAnswered = (): boolean => useContext(AboutAnsweredContext)
