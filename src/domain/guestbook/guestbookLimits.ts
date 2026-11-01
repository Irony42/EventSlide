/**
 * The two ceilings on written messages, as arithmetic over plain numbers (spec 01, section 4).
 *
 * Each is decided **twice** with the same function, like `events/quota.ts`: by the use case
 * against a count it read (a cheap early refusal), and inside the repository's write transaction
 * (the one that holds when requests overlap). Two implementations of one comparison is how the
 * enforcing check and the advertised one drift apart.
 *
 * No byte quota is involved: a message weighs about two kilobytes, 500 of them a megabyte, and the
 * hard ceilings here bound the abuse on their own.
 */

export const MAX_ENTRIES_PER_GUEST = 3
export const MAX_ENTRIES_PER_EVENT = 500

/**
 * Whether someone holding `already` rows may add one more under `max`.
 *
 * Strictly below: the `max`-th message is accepted and the next one is the first refused.
 */
export const allowsAnotherEntry = (max: number, already: number): boolean => already < max

/** What an admission is refused for, in the order it is asked. */
export type GuestbookRefusal = 'guestLimit' | 'eventFull'

/**
 * The decision, from the two counts.
 *
 * `heldByGuest` counts **every** row the guest ever wrote that still exists, refused and
 * operator-removed ones included, so refusing or removing a message does not hand its author a
 * fresh allowance. `openInEvent` counts only rows the host can still act on (`pending`,
 * `published`, `hidden`) and **not** refused ones: otherwise anybody holding the join link could
 * fill the book with text the host turns down, and the host would have no way to reopen it.
 */
export const guestbookRefusalFor = (counts: {
  readonly heldByGuest: number
  readonly openInEvent: number
}): GuestbookRefusal | null => {
  if (!allowsAnotherEntry(MAX_ENTRIES_PER_GUEST, counts.heldByGuest)) return 'guestLimit'
  if (!allowsAnotherEntry(MAX_ENTRIES_PER_EVENT, counts.openInEvent)) return 'eventFull'
  return null
}

/**
 * Two identical messages from one guest this close together are one message (a double tap, a retry
 * after a dropped connection). Later, the same words are a new message: a guest may say the same
 * thing twice.
 */
export const DUPLICATE_WINDOW_MS = 60_000
