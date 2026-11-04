import { createContext } from 'react'

/**
 * Whether captions print the time a photo was sent (spec 13). Set once by `WallLayouts` from the
 * event's `showTime`, so no layout has to carry a flag it never decides.
 */
export const SendTimeContext = createContext(false)
