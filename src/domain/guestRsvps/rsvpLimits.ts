/**
 * The ceilings on replies (spec 30), as arithmetic over plain numbers.
 *
 * Decided **twice** with the same function, like the guestbook's: by the use case against what it
 * read (the honeypot's read-only mirror), and inside the repository's write transaction (the
 * decision that holds when requests overlap). Two implementations of one comparison is how the
 * enforcing check and the advertised one drift apart.
 */

/** A thousand replies per event: the public form is a write nobody is signed in for. */
export const MAX_RSVPS_PER_EVENT = 1000

/** The most places an event may limit itself to (spec 30, section 4.1). */
export const CAPACITY_MIN = 1
export const CAPACITY_MAX = 2000

export type RsvpRefusal = 'tooMany' | 'full'

/** What the ceilings say of a reply: refused, put on the waiting list, or stored as it is. */
export type RsvpAdmissionDecision = RsvpRefusal | 'waitlist' | 'admit'

/**
 * - `tooMany`: a new reply when the event already holds 1 000 (nothing is stored);
 * - **a held `yes` whose people stay equal or shrink is always admitted**, even when the host has
 *   lowered the capacity under the people already coming: editing a diet note must never evict;
 * - `full`: a held `yes` that **grows** beyond the places left is refused, whole (no partial
 *   admission), and what is stored (the reply and its seats) is untouched;
 * - `waitlist` (places are limited): a new `yes`, or a `maybe`/`no` turned into a `yes`, is admitted
 *   when the people of the other `yes` replies plus its own stay within `capacity`, otherwise it
 *   becomes a waiting-list entry, which takes no place. **A reply already on the waiting list stays
 *   there when its guest says `yes` again**: the host promotes by hand, oldest first (the guest may
 *   still change to a maybe or a no). A `maybe` and a `no` take no place and are never held back;
 * - `admit` otherwise.
 *
 * The host's own additions and corrections are not judged here (they pass no capacity: the host decides).
 */
export const rsvpAdmissionFor = (input: {
  /** A new reply (not a change to one that exists). */
  readonly isNew: boolean
  readonly heldInEvent: number
  readonly answer: string
  /** What the stored reply being changed says, or `null` for a new one. */
  readonly heldAnswer: string | null
  /** The people the stored reply stands for (a `yes` that is being changed), or `0`. */
  readonly heldPeople: number
  /** The reply's people. */
  readonly people: number
  /** People in the `yes` replies **other than this one**. */
  readonly yesPeopleElsewhere: number
  readonly capacity: number | null
}): RsvpAdmissionDecision => {
  if (input.isNew && input.heldInEvent >= MAX_RSVPS_PER_EVENT) return 'tooMany'
  if (input.answer === 'yes' && input.capacity !== null) {
    if (input.heldAnswer === 'waitlist') return 'waitlist'
    if (input.heldAnswer === 'yes' && input.people <= input.heldPeople) return 'admit'
    if (input.yesPeopleElsewhere + input.people > input.capacity) {
      return input.heldAnswer === 'yes' ? 'full' : 'waitlist'
    }
  }
  return 'admit'
}
