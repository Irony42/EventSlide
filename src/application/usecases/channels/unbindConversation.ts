import { renderReply } from '../../../domain/channels/channelReplies'
import { DomainError } from '../../../domain/shared/errors'
import type { ChannelBindingId, EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ChannelBindingRepository } from '../../ports/channelBindingRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MessagingChannel } from '../../ports/messagingChannel'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole } from '../shared/eventRole'

/**
 * "Délier": the host stops a group from sending its photographs (spec 27 §3).
 *
 * **Owner only**, like rotating the code: the people who may take a group off the event are the ones who
 * may put it on. The bot says so in the group and **stays in it**: removing it from a group is the group's
 * business, and nothing here can or should do it. A binding that is already over, or another event's, is the
 * one `channel.bindingNotFound`, so an owner cannot probe another event's links.
 *
 * What has been received stays: unlinking stops what comes next, and a photograph already on the wall
 * is the host's to moderate like any other. The jobs still waiting in the queue are dropped by the worker
 * (`drainChannelMedia` refuses a binding that is over).
 */

export interface UnbindConversationInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly bindingId: ChannelBindingId
}

export interface UnbindConversationDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly bindings: ChannelBindingRepository
  readonly channels: ReadonlyMap<MessagingChannel['kind'], MessagingChannel>
  readonly clock: Clock
  readonly bus: EventBus
}

export type UnbindConversation = (
  input: UnbindConversationInput,
) => Promise<Result<void, DomainError>>

export const makeUnbindConversation =
  ({
    events,
    memberships,
    bindings,
    channels,
    clock,
    bus,
  }: UnbindConversationDeps): UnbindConversation =>
  async ({ eventId, actorId, bindingId }) => {
    const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
    if (!allowed.ok) return allowed

    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const binding = await bindings.findById(eventId, bindingId)
    if (binding === null || !binding.isActive()) {
      return err(DomainError.notFound('channel.bindingNotFound'))
    }

    const saved = await bindings.save(binding.unbind(clock.now()))
    if (!saved.ok) return saved
    bus.publish({ type: 'channel.bindingChanged', eventId })

    // Not awaited: the host's request must not wait up to twenty seconds for a group that muted the bot. `reply` never
    // rejects (the port's promise), so there is nothing to catch.
    void channels
      .get(binding.channel)
      ?.reply(
        binding.conversationRef,
        renderReply(
          { reason: 'unbound', eventName: event.name.value },
          event.settings.wallLanguage,
        ),
      )
    return ok(undefined)
  }
