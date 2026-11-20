import { admitByRate, queueHasRoom } from '../../../domain/channels/channelAdmission'
import { replyReasonOfCode, type BotReply } from '../../../domain/channels/channelReplies'
import { senderKeyMaterial } from '../../../domain/channels/channelSender'
import type {
  ChannelCommand,
  ChannelMedia,
  ConversationMoved,
  BotRemoved,
  InboundMessage,
} from '../../../domain/channels/inboundMessage'
import type { ChannelKind } from '../../../domain/channels/channelKind'
import type { Event } from '../../../domain/events/event'
import type { EventLanguage } from '../../../domain/events/eventLanguage'
import type { ChannelBindingRepository } from '../../ports/channelBindingRepository'
import type { ChannelMediaJobRepository } from '../../ports/channelMediaJobRepository'
import type { ChannelSenderKeyer } from '../../ports/channelSenderKeyer'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventRepository } from '../../ports/eventRepository'
import { ceilingsOf } from '../clients/clientContextOf'
import type { GuestRepository } from '../../ports/guestRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { Logger } from '../../ports/logger'
import type { MessagingChannel } from '../../ports/messagingChannel'
import type { BindConversation } from './bindConversation'
import type { ChannelReplier } from './channelReplier'
import type { ForgetChannelSender } from './forgetChannelSender'

/**
 * One message from a messaging channel, taken in (spec 27 §4.2, §5): the switchboard between the inbox and
 * everything else. **It downloads nothing**: a media becomes a queued job and the worker does the rest, so
 * this is fast and replayable, and the cursor of the inbox can safely move once it returns.
 *
 * - a **command** (`/soiree CODE`, `/oublier`, `/confidentialite`) is answered in the conversation;
 * - a **media** in a bound conversation is queued, unless its sender is a bot, a revoked guest, too fast, or the
 *   event's queue is full (then dropped, and told once an hour);
 * - a conversation that **moved** (a group that became a supergroup) keeps its link under the new identifier;
 * - a bot that was **removed** unlinks the conversation;
 * - anything else is ignored.
 *
 * It never throws for what a stranger's message can do, and returns an outcome the poller counts. Nothing of
 * a message that is not a command reaches this function (the adapter drops the words of a group before they
 * become a value), so nothing here can store or log them.
 *
 * What lives in memory: each sender's recent media (the rate) and when the bot last said something (the
 * once-an-hour rule). Both are lost at a restart, which only lets the bot speak once more or a sender go a
 * little faster for a minute.
 */

export type ReceiveOutcome =
  'ignored' | 'answered' | 'queued' | 'duplicate' | 'dropped' | 'moved' | 'unbound'

export interface ReceiveChannelMessageLimits {
  /** `UPLOAD_RATE_LIMIT_PER_MINUTE`: media a sender may post per minute. */
  readonly mediaPerMinute: number
  /** `MAX_QUEUED_CHANNEL_MEDIA_PER_EVENT`. */
  readonly maxQueuedPerEvent: number
}

export interface ReceiveChannelMessageDeps {
  readonly events: EventRepository
  readonly clients: ClientRepository
  readonly guests: GuestRepository
  readonly bindings: ChannelBindingRepository
  readonly jobs: ChannelMediaJobRepository
  readonly channels: ReadonlyMap<ChannelKind, MessagingChannel>
  readonly keyer: ChannelSenderKeyer
  readonly bindConversation: BindConversation
  readonly forgetChannelSender: ForgetChannelSender
  /** Shared with the worker, so a refusal is told once an hour however it was reached. */
  readonly replier: ChannelReplier
  readonly ids: IdGenerator
  readonly clock: Clock
  readonly bus: EventBus
  readonly logger: Logger
  /** Where the notice is read: the address the bot sends into the group. */
  readonly noticeUrlOf: (event: Event) => string
  readonly limits: ReceiveChannelMessageLimits
}

export type ReceiveChannelMessage = (message: InboundMessage) => Promise<ReceiveOutcome>

/** Past this many remembered senders, the entries that cannot matter any more are dropped. */
const MEMORY_LIMIT = 1024
const MINUTE_MS = 60_000

const languageOf = (event: Event | null): EventLanguage | null =>
  event === null ? null : event.settings.wallLanguage

export const makeReceiveChannelMessage = (
  deps: ReceiveChannelMessageDeps,
): ReceiveChannelMessage => {
  const {
    events,
    clients,
    guests,
    bindings,
    jobs,
    channels,
    keyer,
    replier,
    clock,
    bus,
    logger,
    limits,
  } = deps

  /** Each sender's recent media, for the rate: lost at a restart, which only lets a sender go faster for a minute. */
  const recentMedia = new Map<string, readonly Date[]>()

  const forgetOldWindows = (now: Date): void => {
    if (recentMedia.size <= MEMORY_LIMIT) return
    for (const [key, window] of recentMedia) {
      if (window.every((at) => now.getTime() - at.getTime() >= MINUTE_MS)) recentMedia.delete(key)
    }
  }

  const onCommand = async (
    message: ChannelCommand,
    channel: MessagingChannel,
  ): Promise<ReceiveOutcome> => {
    const { conversationRef, messageRef, sender } = message
    const reply = (r: BotReply, language: EventLanguage | null): Promise<void> =>
      replier.say(channel, conversationRef, sender.ref, r, language, messageRef)

    if (message.command === 'bind') {
      if (message.argument === '') {
        await reply({ reason: 'noCode' }, null)
        return 'answered'
      }
      const bound = await deps.bindConversation({
        channel: message.channel,
        conversationRef,
        conversationTitle: message.conversationTitle,
        code: message.argument,
      })
      if (!bound.ok) {
        const reason = replyReasonOfCode(bound.error.error.code)
        if (reason === null) {
          logger.warn('channel.bindUnanswered', { code: bound.error.error.code })
          return 'ignored'
        }
        await reply({ reason }, bound.error.language)
        return 'answered'
      }
      const { event } = bound.value
      await reply(
        {
          reason: 'bound',
          eventName: event.name.value,
          moderated: event.settings.moderation === 'manual',
          noticeUrl: deps.noticeUrlOf(event),
        },
        event.settings.wallLanguage,
      )
      return 'answered'
    }

    const binding = await bindings.findActive(message.channel, conversationRef)
    if (binding === null) {
      await reply({ reason: 'notBound' }, null)
      return 'answered'
    }
    const event = await events.findById(binding.eventId)
    const language = languageOf(event)

    if (message.command === 'privacy') {
      // An event that is gone has no notice to point at; the binding went with it (cascade).
      if (event === null) return 'ignored'
      await reply({ reason: 'privacy', noticeUrl: deps.noticeUrlOf(event) }, language)
      return 'answered'
    }

    if (sender.isAnonymous) {
      await reply({ reason: 'forgetAnonymous' }, language)
      return 'answered'
    }
    const forgotten = await deps.forgetChannelSender({
      eventId: binding.eventId,
      channel: message.channel,
      sender,
    })
    if (!forgotten.ok) {
      // Said as it is, not as done: a sender who thinks their photos are gone when they are not is the worse answer.
      logger.warn('channel.forgetFailed', { code: forgotten.error.code })
      await reply({ reason: 'forgetFailed' }, language)
      return 'answered'
    }
    await reply({ reason: 'forgotten' }, language)
    return 'answered'
  }

  const onMedia = async (
    message: ChannelMedia,
    channel: MessagingChannel,
  ): Promise<ReceiveOutcome> => {
    const { conversationRef, messageRef, sender } = message
    const binding = await bindings.findActive(message.channel, conversationRef)
    if (binding === null) return 'ignored'

    const senderKey = keyer.keyOf(senderKeyMaterial(message.channel, binding.eventId, sender))
    const guest = await guests.findByChannelSender(binding.eventId, message.channel, senderKey)
    if (guest !== null && guest.isRevoked()) return 'dropped'

    // The switch and the plan are read now: a group still linked after the host turned Telegram off, or after a plan
    // change, is told once an hour and nothing is queued.
    const event = await events.findById(binding.eventId)
    if (event !== null && !event.acceptsChannels(await ceilingsOf(clients, event))) {
      await replier.say(
        channel,
        conversationRef,
        senderKey,
        { reason: 'channelOff' },
        languageOf(event),
        messageRef,
      )
      return 'dropped'
    }

    const now = clock.now()
    const rateKey = `${conversationRef}\n${senderKey}`
    const verdict = admitByRate(recentMedia.get(rateKey) ?? [], now, limits.mediaPerMinute)
    recentMedia.set(rateKey, verdict.window)
    forgetOldWindows(now)

    const pending = verdict.allowed ? await jobs.countPending(binding.eventId) : 0
    if (!verdict.allowed || !queueHasRoom(pending, limits.maxQueuedPerEvent)) {
      await replier.say(
        channel,
        conversationRef,
        senderKey,
        { reason: 'tooFast' },
        languageOf(event),
        messageRef,
      )
      return 'dropped'
    }

    const queued = await jobs.enqueue({
      id: deps.ids.channelMediaJobId(),
      eventId: binding.eventId,
      bindingId: binding.id,
      channel: message.channel,
      conversationRef,
      messageRef,
      senderKey,
      senderName: sender.displayName,
      kind: message.kind,
      fileRef: message.fileRef,
      declaredBytes: message.declaredBytes,
      durationMs: message.durationMs,
      declaredName: message.declaredName,
      declaredMimeType: message.declaredMimeType,
      createdAt: now,
    })
    if (queued === 'duplicate') return 'duplicate'

    bus.publish({ type: 'channel.mediaQueued', eventId: binding.eventId })
    return 'queued'
  }

  const onMoved = async (message: ConversationMoved): Promise<ReceiveOutcome> => {
    const binding = await bindings.findActive(message.channel, message.fromRef)
    if (binding === null) return 'ignored'
    // The new identifier is already linked to something: the unique index would refuse, and silently
    // choosing between two events is not ours to do.
    if ((await bindings.findActive(message.channel, message.toRef)) !== null) {
      logger.warn('channel.moveRefused', { reason: 'target already bound' })
      return 'ignored'
    }
    const moved = binding.moveTo(message.toRef)
    if (!moved.ok) return 'ignored'

    const saved = await bindings.save(moved.value)
    if (!saved.ok) {
      // Lost a race for the new identifier: nothing moved, and nothing is announced.
      logger.warn('channel.moveRefused', { code: saved.error.code })
      return 'ignored'
    }
    bus.publish({ type: 'channel.bindingChanged', eventId: binding.eventId })
    return 'moved'
  }

  const onRemoved = async (message: BotRemoved): Promise<ReceiveOutcome> => {
    const binding = await bindings.findActive(message.channel, message.conversationRef)
    if (binding === null) return 'ignored'

    const saved = await bindings.save(binding.unbind(clock.now()))
    if (!saved.ok) {
      logger.warn('channel.unbindFailed', { code: saved.error.code })
      return 'ignored'
    }
    bus.publish({ type: 'channel.bindingChanged', eventId: binding.eventId })
    return 'unbound'
  }

  return async (message) => {
    switch (message.type) {
      case 'ignored':
        return 'ignored'
      case 'conversationMoved':
        return onMoved(message)
      case 'botRemoved':
        return onRemoved(message)
      case 'command':
      case 'media': {
        // Another bot's words and pictures are not a guest's, and a bot answering a bot is how two of them
        // talk to each other all night.
        if (message.sender.isBot) return 'ignored'
        const channel = channels.get(message.channel)
        if (channel === undefined) return 'ignored'
        return message.type === 'command' ? onCommand(message, channel) : onMedia(message, channel)
      }
    }
  }
}
