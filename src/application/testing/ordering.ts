/**
 * `compareIds` lives in the domain now, where the playlist, the moderation queue and the
 * reaction ranking break their ties with it; the fakes that stand in for a database `ORDER BY`
 * import it from here as they always did. The tie direction is still written at each call site,
 * beside the sort it mirrors.
 */
export { compareIds } from '../../domain/shared/ordering'
