/**
 * The disk guard of mode `open` (spec 31 section 3, `docs/costs.md` 4.4): a box that opens accounts by
 * itself keeps the room it promises. Pure; the use case reads the free space and the client count.
 *
 * **The guard is not atomic**: two confirmations may both read the same free space and both pass. What
 * bounds that race is the day's ceiling (`SIGNUP_MAX_PER_DAY`), which caps how many can pass at once.
 */

/** What one client reserving room is counted for, and what the new one is promised: 5 GB. */
export const SIGNUP_DISK_PER_CLIENT_BYTES = 5_000_000_000

/** A client created this recently reserves its room even before its first event. */
export const SIGNUP_FRESH_CLIENT_DAYS = 30

/** The instant from which a client with no event yet still counts as reserving room. */
export const signupFreshClientsSince = (now: Date): Date =>
  new Date(now.getTime() - SIGNUP_FRESH_CLIENT_DAYS * 24 * 60 * 60 * 1000)

/**
 * The free space an `open` box must still have to open one more account: the minimum the box keeps
 * free anyway (`MIN_FREE_DISK_BYTES`), plus 5 GB for each client reserving room, plus 5 GB for the newcomer.
 */
export const signupDiskThreshold = (input: {
  readonly minFreeDiskBytes: number
  /** Clients with an event not yet purged, and clients created in the last 30 days with none yet. */
  readonly clientsReservingRoom: number
}): number =>
  input.minFreeDiskBytes + SIGNUP_DISK_PER_CLIENT_BYTES * (input.clientsReservingRoom + 1)
