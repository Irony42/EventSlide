import { decideBinding, ChannelBinding } from '../../../domain/channels/channelBinding'
import type { ChannelKind } from '../../../domain/channels/channelKind'
import type { EventLanguage } from '../../../domain/events/eventLanguage'
import type { Event } from '../../../domain/events/event'
import { DomainError } from '../../../domain/shared/errors'
import { JoinCode } from '../../../domain/shared/joinCode'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ChannelBindingRepository } from '../../ports/channelBindingRepository'
import type { Clock } from '../../ports/clock'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import { ceilingsOf } from '../clients/clientContextOf'

/**
 * `/soiree CODE` in a conversation: connect it to the event the code names (spec 27 §4.3).
 *
 * Whoever holds the code may do it: the code already gives the right to send photographs, so asking
 * for more (an administrator of the group) would only make it harder for the person who has the card
 * in their hand. **A refusal never says whether a code exists beyond what the answer to "unknown code" says:**
 * every malformed or unknown code is the one `channel.unknownCode`, so the command is no way to test codes
 * faster than the join page's own rate limit allows (the poller answers one message at a time).
 *
 * Order of the verdicts, from the domain (`decideBinding`): the plan or the host's switch first, then the
 * event's state, then what the conversation is already bound to. The binding keeps the **event's id**, never
 * the code, which rotates.
 */

export interface BindConversationInput {
  readonly channel: ChannelKind
  readonly conversationRef: string
  /** The group's title (the person's name in a private chat), or `null`. */
  readonly conversationTitle: string | null
  /** What came after the command: the code as the person typed it. */
  readonly code: string
}

export interface BoundConversation {
  readonly event: Event
  /** `false` when the conversation already sent to this very event: nothing changed. */
  readonly changed: boolean
}

/** A refusal, with the language the event speaks when the code reached one (`null`: it did not). */
export interface BindRefusal {
  readonly error: DomainError
  readonly language: EventLanguage | null
}

export interface BindConversationDeps {
  readonly events: EventRepository
  readonly clients: ClientRepository
  readonly bindings: ChannelBindingRepository
  readonly ids: IdGenerator
  readonly clock: Clock
  readonly bus: EventBus
}

export type BindConversation = (
  input: BindConversationInput,
) => Promise<Result<BoundConversation, BindRefusal>>

const unknownCode = (): BindRefusal => ({
  error: DomainError.notFound('channel.unknownCode'),
  language: null,
})

export const makeBindConversation =
  ({ events, clients, bindings, ids, clock, bus }: BindConversationDeps): BindConversation =>
  async ({ channel, conversationRef, conversationTitle, code }) => {
    const parsed = JoinCode.create(code)
    if (!parsed.ok) return err(unknownCode())

    const event = await events.findByJoinCode(parsed.value)
    if (event === null) return err(unknownCode())
    const language = event.settings.wallLanguage

    const existing = await bindings.findActive(channel, conversationRef)
    const previous = existing === null ? null : await events.findById(existing.eventId)

    const decision = decideBinding({
      eventId: event.id,
      eventAcceptsGuests: event.acceptsGuests(),
      channelAllowed: event.acceptsChannels(await ceilingsOf(clients, event)),
      existing:
        existing === null
          ? null
          : {
              id: existing.id,
              eventId: existing.eventId,
              // A binding whose event is gone is as good as one on an event that is over.
              eventIsLive: previous !== null && previous.status === 'live',
            },
    })
    if (!decision.ok) return err({ error: decision.error, language })
    if (decision.value.kind === 'unchanged') return ok({ event, changed: false })

    const now = clock.now()
    if (decision.value.kind === 'replace' && existing !== null) {
      await bindings.save(existing.unbind(now))
      bus.publish({ type: 'channel.bindingChanged', eventId: existing.eventId })
    }

    const created = ChannelBinding.create(
      { eventId: event.id, channel, conversationRef, conversationTitle },
      ids.channelBindingId(),
      now,
    )
    if (!created.ok) return err({ error: created.error, language })

    await bindings.save(created.value)
    bus.publish({ type: 'channel.bindingChanged', eventId: event.id })
    return ok({ event, changed: true })
  }
