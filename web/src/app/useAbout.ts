import { useContext } from 'react'
import type { About } from '../lib/api/dto'
import { AboutContext } from './aboutContext'

/**
 * What `GET /api/about` says, once it has said it, and the build's own answer until then.
 * Read from `AboutProvider`; the request is made there, once, and not by each caller.
 */
export const useAbout = (): About => useContext(AboutContext)
