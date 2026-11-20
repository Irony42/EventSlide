import type { ChannelKind } from './channelKind'

/**
 * What a messaging adapter hands to the application, once it has translated its own updates
 * (spec 27 §4.2). The domain never learns what a Telegram update looks like: an adapter turns each
 * one into exactly one of these five, and anything it does not understand into `ignored`.
 *
 * Nothing here carries the text of a message. A message that is not a command is dropped by the
 * adapter before it becomes one of these, so that the words people say in their group can never
 * reach a log, a queue or a table (docs/SECURITY.md, "Messaging channels").
 */

/**
 * The person (or the group) behind a message.
 *
 * `ref` is the channel's own identifier for them. It is **hashed before it is stored** and never
 * kept in clear. `displayName` is what the channel shows for them, `null` when it shows nothing.
 *
 * `isBot`: another bot wrote it; its media are ignored. `isAnonymous`: an administrator posting "as
 * the group" — no person is behind it, so `ref` is the conversation's own, the media belong to one
 * anonymous guest of the group, and `/forget` is refused (there is nobody to forget).
 */
export interface ChannelSender {
  readonly ref: string
  readonly displayName: string | null
  readonly isBot: boolean
  readonly isAnonymous: boolean
}

export const CHANNEL_COMMANDS = ['bind', 'forget', 'privacy'] as const

export type ChannelCommandName = (typeof CHANNEL_COMMANDS)[number]

/** Where a message came from, and which message it was: the pair a replayed update is recognised by. */
interface MessageOrigin {
  readonly channel: ChannelKind
  readonly conversationRef: string
  /** The conversation's title (a private chat has none, so the adapter gives the person's name). */
  readonly conversationTitle: string | null
  readonly messageRef: string
  readonly sender: ChannelSender
}

/** `/soiree CODE`, `/oublier`, `/confidentialite`. `argument` is the rest of the line, trimmed. */
export interface ChannelCommand extends MessageOrigin {
  readonly type: 'command'
  readonly command: ChannelCommandName
  readonly argument: string
}

/**
 * A picture or a film posted in the conversation. `document` is a file sent "without compression",
 * the only way to send an original: what it really is is decided by its bytes once downloaded, and
 * `declaredMimeType` only decides whether it is worth downloading at all.
 */
export interface ChannelMedia extends MessageOrigin {
  readonly type: 'media'
  readonly kind: 'photo' | 'video' | 'document'
  readonly fileRef: string
  readonly declaredBytes: number | null
  readonly durationMs: number | null
  readonly declaredName: string
  readonly declaredMimeType: string | null
}

/** A Telegram group that became a supergroup: it is the same conversation under another identifier. */
export interface ConversationMoved {
  readonly type: 'conversationMoved'
  readonly channel: ChannelKind
  readonly fromRef: string
  readonly toRef: string
}

/** The bot was removed from, or banned in, the conversation. */
export interface BotRemoved {
  readonly type: 'botRemoved'
  readonly channel: ChannelKind
  readonly conversationRef: string
}

/** The bot became an administrator of the conversation: it may now see what the group posts. */
export interface BotPromoted {
  readonly type: 'botPromoted'
  readonly channel: ChannelKind
  readonly conversationRef: string
}

export interface Ignored {
  readonly type: 'ignored'
}

export type InboundMessage =
  ChannelCommand | ChannelMedia | ConversationMoved | BotRemoved | BotPromoted | Ignored

/**
 * Read a command out of a message's text, or `null` when the text is not one of ours.
 *
 * Accepted: `/soiree`, `/soirée`, `/SOIREE`, `/soiree@TheBot`, with the argument after a space. A
 * command addressed to **another** bot (`/soiree@OtherBot`) is not ours, and in a group with two
 * bots that is the difference between answering once and answering twice. Only the first line counts:
 * a pasted paragraph that starts with a slash is not a command with a paragraph for an argument.
 */
export const parseCommand = (
  text: string,
  botUsername: string,
): { command: ChannelCommandName; argument: string } | null => {
  // Groups 1 and 3 always take part (3 may be empty); only the addressee is optional.
  // An `@` must be followed by an addressee: `/soiree@` is nobody's command.
  const match = /^[ \t]*\/([^\s@]+)(?:@(\S+)|(?=\s|$))[ \t]*([^\r\n]*)/u.exec(text)
  if (match === null) return null

  const [, rawName, addressee, rawArgument] = match as unknown as [
    string,
    string,
    string | undefined,
    string,
  ]
  if (addressee !== undefined && addressee.toLowerCase() !== botUsername.toLowerCase()) return null

  const command = COMMAND_NAMES.get(rawName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())
  if (command === undefined) return null

  return { command, argument: rawArgument.trim() }
}

/** A Map, not an object: `/constructor` must not find `Object.prototype.constructor`. */
const COMMAND_NAMES: ReadonlyMap<string, ChannelCommandName> = new Map([
  ['soiree', 'bind'],
  ['oublier', 'forget'],
  ['confidentialite', 'privacy'],
])
