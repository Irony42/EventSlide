/**
 * The disk guard of mode `open` (spec 31 section 3, `docs/costs.md` 4.4): a box that opens accounts by
 * itself keeps the room it promises. Pure; the use case reads the free space and the client count.
 */

/** What one client with a live album is counted for, and what the new one is promised: 5 GB. */
export const SIGNUP_DISK_PER_CLIENT_BYTES = 5_000_000_000

/**
 * The free space an `open` box must still have to open one more account: the minimum the box keeps
 * free anyway (`MIN_FREE_DISK_BYTES`), plus 5 GB for each client that has an event not yet purged,
 * plus 5 GB for the newcomer.
 */
export const signupDiskThreshold = (input: {
  readonly minFreeDiskBytes: number
  /** Clients with at least one event that is not purged. */
  readonly clientsWithEvents: number
}): number => input.minFreeDiskBytes + SIGNUP_DISK_PER_CLIENT_BYTES * (input.clientsWithEvents + 1)
