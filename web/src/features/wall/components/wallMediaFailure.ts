import { createContext } from 'react'

/**
 * Called when a photograph of the wall could not be loaded: the wall asks its playlist to be
 * read again (a rendition removed since the last read, a proxy blip, a signature that lapsed).
 * It is the page's own `refresh`, so there is no second read policy; a layout, an ambiance
 * preview or a test that provides nothing gets a no-op.
 */
export const WallMediaFailureContext = createContext<() => void>(() => undefined)
