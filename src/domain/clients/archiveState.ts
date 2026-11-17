/**
 * What the box held for an album when it was purged (spec 22, section 8): the one word the
 * purge's log line carries as `archive=…`, so an operator can tell which albums left with an
 * archive the host had been sent and which left with nothing.
 *
 * - `served`: a prepared archive was sent in full to the host, and no photograph was removed since;
 * - `sealed`: prepared and verified, never downloaded in full;
 * - `incomplete`: prepared, but files were missing from the disk when it was made;
 * - `stale`: it had been withdrawn because the album changed under it;
 * - `none`: no archive was ever prepared (the host may still have downloaded the album directly,
 *   which the box cannot see).
 *
 * Only `served` is a purge nobody loses anything in; every other word is a `warn` in the log.
 */
export const ARCHIVE_STATES = ['served', 'sealed', 'incomplete', 'stale', 'none'] as const

export type ArchiveState = (typeof ARCHIVE_STATES)[number]

/** Whether an album left having been handed over: the only state that is not a warning. */
export const leftWithArchive = (state: ArchiveState): boolean => state === 'served'
