import { DomainError } from '../../../domain/shared/errors'
import { JoinCode } from '../../../domain/shared/joinCode'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'

/**
 * What `/join/:code` answers to a phone that has not joined yet.
 *
 * Everything a guest needs to decide "yes, this is the wedding I am at" and to reach
 * the upload page — and nothing else. No owner, no quota, no counts, no id: this is the
 * one lookup an attacker can enumerate, so every field here is a field they get too.
 */
export interface JoinTarget {
  /** Where the guest goes next. Only ever an event that is open to them. */
  readonly slug: string
  readonly name: string
  /**
   * True whenever this resolves at all. Stated rather than implied, so the join page
   * shows its form because the server said the doors are open, not because no error
   * came back.
   */
  readonly acceptsGuests: boolean
  readonly allowCaptions: boolean
  readonly allowReactions: boolean
}

export interface ResolveJoinCodeInput {
  readonly code: string
}

export interface ResolveJoinCodeDeps {
  readonly events: EventRepository
}

export type ResolveJoinCode = (
  input: ResolveJoinCodeInput,
) => Promise<Result<JoinTarget, DomainError>>

export const makeResolveJoinCode =
  ({ events }: ResolveJoinCodeDeps): ResolveJoinCode =>
  async ({ code }) => {
    // Normalising is the value object's job, and it is what lets a guest reading a
    // printed card in a dark room type an `O` for a zero and still get in.
    const parsed = JoinCode.create(code)
    if (!parsed.ok) return parsed

    const event = await events.findByJoinCode(parsed.value)

    // One answer for "no such code" and for "that event is not open to guests". A
    // distinguishable "not started yet" would confirm which codes exist, which is
    // exactly the oracle a printed six-character credential cannot afford.
    if (event === null || !event.acceptsGuests()) {
      return err(DomainError.notFound('event.notFound'))
    }

    return ok({
      slug: event.slug.value,
      name: event.name.value,
      acceptsGuests: event.acceptsGuests(),
      allowCaptions: event.settings.allowCaptions,
      allowReactions: event.settings.allowReactions,
    })
  }
