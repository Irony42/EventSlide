import {
  isThrottled,
  mayReply,
  renderReply,
  replyKey,
  type BotReply,
} from '../../../domain/channels/channelReplies'
import type { EventLanguage } from '../../../domain/events/eventLanguage'
import type { Clock } from '../../ports/clock'
import type { MessagingChannel } from '../../ports/messagingChannel'

/**
 * What the bot says in a conversation, and the rule that it does not say the same refusal twice in an
 * hour (spec 27 §4.6). One instance serves the receiving side and the worker, so a sender whose media
 * are refused at the door and then again at the queue is told once.
 *
 * **A command is always answered** (somebody typed it); **the refusals of a media are rationed** to one per
 * conversation, sender and reason per hour (`isThrottled` names which). The memory is the process's: a
 * restart forgets it, which only lets the bot speak once more.
 */
export interface ChannelReplier {
  say(
    channel: MessagingChannel,
    conversationRef: string,
    senderRef: string,
    reply: BotReply,
    language: EventLanguage | null,
    replyTo: string,
  ): Promise<void>
}

/** Past this many remembered replies, the ones that can no longer ration anything are dropped. */
const MEMORY_LIMIT = 1024

export const makeChannelReplier = (clock: Clock): ChannelReplier => {
  const lastSaid = new Map<string, Date>()

  return {
    async say(channel, conversationRef, senderRef, reply, language, replyTo) {
      if (isThrottled(reply.reason)) {
        const now = clock.now()
        const key = replyKey(conversationRef, senderRef, reply.reason)
        if (!mayReply(lastSaid.get(key) ?? null, now)) return
        lastSaid.set(key, now)

        if (lastSaid.size > MEMORY_LIMIT) {
          for (const [oldKey, at] of lastSaid) if (mayReply(at, now)) lastSaid.delete(oldKey)
        }
      }
      await channel.reply(conversationRef, renderReply(reply, language), replyTo)
    },
  }
}
