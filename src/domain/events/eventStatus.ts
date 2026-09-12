/**
 * The event lifecycle.
 *
 * An event is a thing that happens on a date and then is over, which 1.0's free-text
 * `partyId` column could not express: there was no way to stop accepting uploads, no
 * way to close an event, and no way to purge one. Each state below answers a real
 * question a host asks on the night.
 *
 * | Status | The host's words |
 * | --- | --- |
 * | `draft` | "I am setting this up tomorrow, do not let anyone in yet." |
 * | `live` | "We are open, the wall is up." |
 * | `closed` | "The party is over. Stop uploads, but keep the wall playing." |
 * | `archived` | "Done. Keep the album, take it out of my dashboard." |
 */

export const EVENT_STATUSES = ['draft', 'live', 'closed', 'archived'] as const

export type EventStatus = (typeof EVENT_STATUSES)[number]

const ALLOWED_TRANSITIONS: Readonly<Record<EventStatus, readonly EventStatus[]>> = {
  draft: ['live', 'archived'],
  // Closing is the normal end. Going back to draft is not offered: guests may already
  // hold the join link, so "not started yet" would be a lie.
  live: ['closed', 'archived'],
  // Reopening matters — the speeches run late and the party restarts.
  closed: ['live', 'archived'],
  // Terminal. Recovering an archived event is a restore-from-backup operation, not a
  // button, because it has to answer what happened to the media in between.
  archived: [],
}

export const isEventStatus = (value: unknown): value is EventStatus =>
  typeof value === 'string' && (EVENT_STATUSES as readonly string[]).includes(value)

/** A no-op transition is allowed, so a double-clicked "close" is idempotent. */
export const canTransition = (from: EventStatus, to: EventStatus): boolean =>
  from === to || ALLOWED_TRANSITIONS[from].includes(to)

export const allowedTransitionsFrom = (from: EventStatus): readonly EventStatus[] =>
  ALLOWED_TRANSITIONS[from]

/**
 * Whether a guest may send a photo.
 *
 * This is the check that makes the public upload endpoint safe. In 1.0 the endpoint
 * accepted any `partyname` and created a directory for it, so anyone who found the URL
 * could write to the disk forever. Here an upload requires an event that exists and is
 * `live`.
 */
export const acceptsUploads = (status: EventStatus): boolean => status === 'live'

/** Whether a guest may join and be issued a device token. */
export const acceptsGuests = (status: EventStatus): boolean => status === 'live'

/**
 * Whether the wall serves photos. A closed event keeps playing — the projector is
 * usually still on while people say goodbye — but an archived one does not.
 */
export const servesWall = (status: EventStatus): boolean => status === 'live' || status === 'closed'

/** Whether a host may still approve, hide or reject. Archived events are read-only. */
export const allowsModeration = (status: EventStatus): boolean => status !== 'archived'

/** Whether settings, name and join code may be changed. */
export const isMutable = (status: EventStatus): boolean => status !== 'archived'

/**
 * Whether the retention clock is running. It starts when the event closes, not when it
 * was created, so a wedding booked six months ahead is not purged before it happens.
 */
export const retentionApplies = (status: EventStatus): boolean =>
  status === 'closed' || status === 'archived'
