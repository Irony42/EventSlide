import type { Event } from '../events/event'
import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { Client } from './client'

/**
 * Whether a member of an event may take its album out (spec 22, rule 8): one function, asked by
 * every path that hands the album over (today `exportAlbum`, tomorrow the prepared archive), so
 * that two of them cannot come to different answers.
 *
 * - **An event the operator took down is `404 event.notFound`**, whatever else is true. The
 *   host may be the person concerned, and nobody holding it is told anything but "not there".
 * - **A suspended client's members do not read photographs** (`403 client.suspended`), with one
 *   exception: **a client that is being offboarded** (`purge_after` is set). Offboarding suspends
 *   the client *and* tells it that it has `graceDays` to export; before this rule that window was a
 *   countdown with no door out, because the suspension that comes with it refused the export.
 * - A suspension **without** an offboarding is an abuse measure and keeps the refusal. What an
 *   operator cuts for an abuse is the event itself (the take-down), never the suspension.
 *
 * Pure, and the role is not its business: it is asked after `requireEventRole`, like every other
 * rule about an event's state, so that a stranger is still told what a stranger is told.
 */
export const exportAllowed = (event: Event, client: Client | null): Result<void, DomainError> => {
  if (event.isTakenDown()) return err(DomainError.notFound('event.notFound'))
  if (!event.isClientSuspended()) return ok(undefined)
  if (client !== null && client.isOffboarding()) return ok(undefined)
  return err(DomainError.forbidden('client.suspended'))
}
