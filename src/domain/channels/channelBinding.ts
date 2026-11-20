import { DomainError } from '../shared/errors'
import type { ChannelBindingId, EventId } from '../shared/ids'
import { toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'
import type { ChannelKind } from './channelKind'

/**
 * The link between one messaging conversation and one event (spec 27 §4.3).
 *
 * It keeps the **event id**, never the join code: the code rotates (`rotateJoinCode`) and the old one
 * stops working at once, so a link that stored it would break the evening the host rotates it.
 *
 * At most one active binding exists per conversation (a unique index holds it), and a conversation
 * points to one event. Immutable like the other entities: every change returns a new binding.
 */

/** The title is shown to the host in a list and is a group's name, so it is bounded and single-line. */
const MAX_TITLE_LENGTH = 80

export interface ChannelBindingProps {
  readonly id: ChannelBindingId
  readonly eventId: EventId
  readonly channel: ChannelKind
  readonly conversationRef: string
  readonly conversationTitle: string
  readonly boundAt: Date
  readonly unboundAt: Date | null
}

export interface NewChannelBinding {
  readonly eventId: EventId
  readonly channel: ChannelKind
  readonly conversationRef: string
  readonly conversationTitle: string | null
}

/** What the conversation is called in the host's list when the channel did not give a title. */
const UNTITLED = ''

export const cleanConversationTitle = (raw: string | null): string =>
  raw === null ? UNTITLED : [...toSingleLine(raw)].slice(0, MAX_TITLE_LENGTH).join('')

export class ChannelBinding {
  private constructor(private readonly props: ChannelBindingProps) {}

  static create(
    input: NewChannelBinding,
    id: ChannelBindingId,
    now: Date,
  ): Result<ChannelBinding, DomainError> {
    if (input.conversationRef.trim() === '') {
      return err(DomainError.invalid('channel.conversationMissing'))
    }
    return ok(
      new ChannelBinding({
        id,
        eventId: input.eventId,
        channel: input.channel,
        conversationRef: input.conversationRef,
        conversationTitle: cleanConversationTitle(input.conversationTitle),
        boundAt: now,
        unboundAt: null,
      }),
    )
  }

  static restore(props: ChannelBindingProps): ChannelBinding {
    return new ChannelBinding(props)
  }

  static readonly maxTitleLength = MAX_TITLE_LENGTH

  get id(): ChannelBindingId {
    return this.props.id
  }
  get eventId(): EventId {
    return this.props.eventId
  }
  get channel(): ChannelKind {
    return this.props.channel
  }
  get conversationRef(): string {
    return this.props.conversationRef
  }
  get conversationTitle(): string {
    return this.props.conversationTitle
  }
  get boundAt(): Date {
    return this.props.boundAt
  }
  get unboundAt(): Date | null {
    return this.props.unboundAt
  }

  isActive(): boolean {
    return this.props.unboundAt === null
  }

  /** The conversation stops sending its photographs. Unbinding twice keeps the first instant. */
  unbind(at: Date): ChannelBinding {
    if (!this.isActive()) return this
    return new ChannelBinding({ ...this.props, unboundAt: at })
  }

  /** The conversation changed identifier (a Telegram group became a supergroup): the link follows. */
  moveTo(conversationRef: string): Result<ChannelBinding, DomainError> {
    if (!this.isActive()) return err(DomainError.conflict('channel.bindingNotActive'))
    if (conversationRef.trim() === '')
      return err(DomainError.invalid('channel.conversationMissing'))
    return ok(new ChannelBinding({ ...this.props, conversationRef }))
  }
}

/** The binding a conversation already has, as far as the decision needs to know it. */
export interface ExistingBinding {
  readonly id: ChannelBindingId
  readonly eventId: EventId
  /** Whether that event is still `live`: a closed one lets the conversation move on. */
  readonly eventIsLive: boolean
}

export interface BindRequest {
  /** The event the join code named: it accepts guests (live and reachable). */
  readonly eventAcceptsGuests: boolean
  readonly eventId: EventId
  /** The host's switch (`allowTelegram`) AND the client's ceiling (`channelsAllowed`). */
  readonly channelAllowed: boolean
  readonly existing: ExistingBinding | null
}

export type BindDecision =
  /** No active binding: create one. */
  | { readonly kind: 'bind' }
  /** An active one on a closed event: end it and create the new one. */
  | { readonly kind: 'replace'; readonly replacedId: ChannelBindingId }
  /** Already bound to this very event: nothing changes, the welcome is said again. */
  | { readonly kind: 'unchanged'; readonly bindingId: ChannelBindingId }

/**
 * What a `/soiree CODE` does. Order matters and is part of the contract:
 * the plan or the host's switch first (a conversation told "not included" learns nothing about the
 * event's state), then the event's state, then what the conversation is already bound to.
 */
export const decideBinding = (request: BindRequest): Result<BindDecision, DomainError> => {
  if (!request.channelAllowed) return err(DomainError.forbidden('channel.notAllowed'))
  if (!request.eventAcceptsGuests) return err(DomainError.conflict('channel.eventNotOpen'))

  const { existing } = request
  if (existing === null) return ok({ kind: 'bind' })
  if (existing.eventId === request.eventId) return ok({ kind: 'unchanged', bindingId: existing.id })
  if (existing.eventIsLive) return err(DomainError.conflict('channel.alreadyBound'))
  return ok({ kind: 'replace', replacedId: existing.id })
}
