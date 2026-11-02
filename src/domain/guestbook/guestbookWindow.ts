import type { EventStatus } from '../events/eventStatus'

/**
 * When a guest may still write a message (spec 01, decision Q4).
 *
 * A guestbook is the one contribution people make the next morning, so unlike a photograph a
 * message is accepted for a while **after** the party: while the event is `live`, and on a
 * `closed` one for seven days from the moment it was closed. A draft has no guests yet and an
 * archived one is a record. The window is measured from `closedAt`, which a reopening clears, so
 * a reopened event is simply live again and a re-closed one starts a new window.
 *
 * The event's other gates (taken down by the operator, client suspended) are asked by the caller
 * through `Event`, which owns them; this is only the part of the rule that is about the status.
 */

export const GUESTBOOK_CLOSED_WINDOW_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1_000

export const acceptsGuestbookEntries = (
  event: { readonly status: EventStatus; readonly closedAt: Date | null },
  now: Date,
): boolean => {
  if (event.status === 'live') return true
  if (event.status !== 'closed' || event.closedAt === null) return false
  return now.getTime() - event.closedAt.getTime() < GUESTBOOK_CLOSED_WINDOW_DAYS * DAY_MS
}
