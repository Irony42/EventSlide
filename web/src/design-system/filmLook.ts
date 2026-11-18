/**
 * The class of the film look (spec 23), defined once in `base.css`.
 *
 * A global class and not a CSS Module's: four features show a photograph and a feature never
 * imports another, so the one recipe lives in the shared sheet and each surface only asks for its
 * name, with `cx(..., filmLook(film))` on the **image element** (never a caption, a QR or a text).
 * `film` is the server's word (`reveal.film`, true only with the mode on): a surface that reads
 * `false`, or no reveal block at all (an older server), gets no class and is the evening it always was.
 */
export const FILM_LOOK_CLASS = 'filmLook'

export const filmLook = (film: boolean | undefined): string | false =>
  film === true && FILM_LOOK_CLASS
