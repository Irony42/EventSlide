import type { ChannelBinding } from '../../../domain/channels/channelBinding'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ChannelBindingRepository } from '../../ports/channelBindingRepository'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventRepository } from '../../ports/eventRepository'
import type { MessagingChannel } from '../../ports/messagingChannel'
import type { MembershipRepository } from '../../ports/userRepository'
import { ceilingsOf } from '../clients/clientContextOf'
import { requireEventRole } from '../shared/eventRole'

/**
 * What the host's "Groupe Telegram" panel reads (spec 27 §3, §5): whether this box has a bot at all, its
 * name (the host is told which bot to add to the group), whether the client's plan includes the channel, and the
 * groups that send to the event.
 *
 * **Moderators may read it**, since it names no secret and the host asks them to help with the evening; only
 * the owner may unlink (`unbindConversation`). An event the actor has no part in is `event.notFound`, as everywhere.
 * The bot's name is the public handle every person can type into Telegram: it is not the token and nothing derived from it.
 */

export interface ChannelsView {
  /** Whether this box has a bot for the channel: without a token, none of this exists. */
  readonly available: boolean
  /** The bot's handle, `null` when `available` is `false`. */
  readonly botUsername: string | null
  /** The client's plan includes messaging channels (an event with no client always does). */
  readonly allowed: boolean
  readonly bindings: readonly ChannelBinding[]
}

export interface ListBindingsDeps {
  readonly events: EventRepository
  readonly clients: ClientRepository
  readonly memberships: MembershipRepository
  readonly bindings: ChannelBindingRepository
  readonly channels: ReadonlyMap<MessagingChannel['kind'], MessagingChannel>
}

export type ListBindings = (input: {
  readonly eventId: EventId
  readonly actorId: UserId
}) => Promise<Result<ChannelsView, DomainError>>

export const makeListBindings =
  ({ events, clients, memberships, bindings, channels }: ListBindingsDeps): ListBindings =>
  async ({ eventId, actorId }) => {
    const allowed = await requireEventRole(memberships, eventId, actorId, 'moderate')
    if (!allowed.ok) return allowed

    const event = await events.findById(eventId)
    // An event the operator took down is not there for anyone who held it; a suspended client's members still read
    // (this lists a configuration, not photographs).
    if (event === null || event.isTakenDown()) return err(DomainError.notFound('event.notFound'))

    const ceilings = await ceilingsOf(clients, event)
    const telegram = channels.get('telegram')
    return ok({
      available: telegram !== undefined,
      botUsername: telegram === undefined ? null : telegram.identity().username,
      allowed: ceilings === null || ceilings.channelsAllowed,
      bindings: await bindings.listActiveForEvent(eventId),
    })
  }
