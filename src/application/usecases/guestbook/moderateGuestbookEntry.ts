import {
  targetStatusFor,
  type ModerationDecision,
} from '../../../domain/moderation/moderationDecision'
import type { PhotoActor, Reviewer } from '../../../domain/photos/photo'
import type { EntryStatus } from '../../../domain/guestbook/guestbookEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestbookEntryId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * One decision on one guestbook message (spec 01): publish, hide or refuse it.
 *
 * `moderatePhoto`'s rules, delegated the same way: `targetStatusFor` is the only bridge from the
 * host's verb to a status, `GuestbookEntry.transitionTo` is the only judge of the move, and the
 * role is the photo's `moderate`. A guest is refused outright, and a message of another event, or
 * one the operator took down, is `404 guestbook.notFound` (the repository never returns it).
 *
 * Nothing is announced unless something changed: a `guestbook.changed` signal makes the wall and
 * the panel re-read, and an illegal move must not look like a success on screen.
 */

export interface ModerateGuestbookEntryInput {
  readonly eventId: EventId
  readonly entryId: GuestbookEntryId
  readonly decision: ModerationDecision
  readonly actor: PhotoActor
}

export interface ModerateGuestbookEntryDeps {
  readonly events: EventRepository
  readonly guestbook: GuestbookRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export interface ModeratedGuestbookEntry {
  readonly entryId: GuestbookEntryId
  readonly status: EntryStatus
}

export type ModerateGuestbookEntry = (
  input: ModerateGuestbookEntryInput,
) => Promise<Result<ModeratedGuestbookEntry, DomainError>>

export const makeModerateGuestbookEntry =
  ({
    events,
    guestbook,
    memberships,
    bus,
    clock,
  }: ModerateGuestbookEntryDeps): ModerateGuestbookEntry =>
  async ({ eventId, entryId, decision, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    if (actor.kind === 'guest') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'moderator' }))
    }

    const allowed = await requireEventRole(memberships, eventId, actor.userId, 'moderate')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    if (!event.allowsModeration()) {
      return err(DomainError.conflict('event.notModeratable', { status: event.status }))
    }

    const entry = await guestbook.findById(eventId, entryId)
    if (entry === null) return err(DomainError.notFound('guestbook.notFound'))

    const reviewer: Reviewer = { kind: 'host', userId: actor.userId }
    const moved = entry.transitionTo(targetStatusFor(decision), reviewer, clock.now())
    if (!moved.ok) return moved

    await guestbook.save(moved.value)
    bus.publish({ type: 'guestbook.changed', eventId })

    return ok({ entryId, status: moved.value.status })
  }
