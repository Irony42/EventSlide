/**
 * The ceilings on replies (spec 30), as arithmetic over plain numbers.
 *
 * Decided **twice** with the same function, like the guestbook's: by the use case against what it
 * read (a cheap early refusal), and inside the repository's write transaction (the decision that
 * holds when requests overlap). Two implementations of one comparison is how the enforcing check
 * and the advertised one drift apart.
 */

/** A thousand replies per event: the public form is a write nobody is signed in for. */
export const MAX_RSVPS_PER_EVENT = 1000

export type RsvpRefusal = 'tooMany' | 'full'

export const rsvpRefusalFor = (input: {
  /** A new reply (not a change to one that exists). */
  readonly isNew: boolean
  readonly heldInEvent: number
  readonly answer: string
  /** The reply's people. */
  readonly people: number
  /** People in the `yes` replies **other than this one**. */
  readonly yesPeopleElsewhere: number
  readonly capacity: number | null
}): RsvpRefusal | null => {
  if (input.isNew && input.heldInEvent >= MAX_RSVPS_PER_EVENT) return 'tooMany'
  if (
    input.answer === 'yes' &&
    input.capacity !== null &&
    input.yesPeopleElsewhere + input.people > input.capacity
  ) {
    return 'full'
  }
  return null
}
