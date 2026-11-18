import { createContext } from 'react'

/**
 * Whether this wall shows its photographs with the film look (spec 23, `reveal.film` of the wall
 * response). A context and not a prop, because every layout draws its photographs through
 * `WallMedia` and passing a flag down seven layouts would be seven places to forget it.
 */
export const FilmLookContext = createContext(false)
