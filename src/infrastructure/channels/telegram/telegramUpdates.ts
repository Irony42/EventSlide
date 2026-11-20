import { z } from 'zod'
import { toSingleLine } from '../../../domain/shared/plainText'
import {
  parseCommand,
  type ChannelSender,
  type InboundMessage,
} from '../../../domain/channels/inboundMessage'

/**
 * Telegram update -> `InboundMessage` (spec 27 §6). The only place that knows what an update looks like.
 *
 * An update is **untrusted input**: it is parsed with zod, loosely (a field Telegram adds tomorrow changes nothing),
 * and anything not understood is `ignored`, never an error. **The text of a message is read here for one thing, whether
 * it is one of our commands, and is then dropped**: nothing of it reaches a domain value, a queue, a table or a log.
 *
 * What is taken, and what is not:
 * - a photograph: the largest `PhotoSize`; a video; a document (an original sent without compression: its declared MIME
 *   type only decides whether it is worth downloading, the bytes decide for good). Video notes, animations and stickers
 *   are not ours.
 * - `/soiree`, `/oublier`, `/confidentialite` (also `/soiree@Bot`, only when addressed to this bot).
 * - `migrate_to_chat_id` (a group became a supergroup: same conversation, new identifier) and a `my_chat_member` that
 *   says the bot left or was banned.
 * - the media of another bot, and a post "as a channel" that is not the group itself, are ignored; an administrator
 *   posting "as the group" is anonymous (`isAnonymous`, the group's own identifier as `ref`).
 */

const idSchema = z.union([z.number(), z.string()]).transform((value) => String(value))

const userSchema = z
  .object({
    id: idSchema,
    is_bot: z.boolean().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  })
  .loose()

const chatSchema = z
  .object({
    id: idSchema,
    type: z.string().optional(),
    title: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  })
  .loose()

const photoSizeSchema = z
  .object({
    file_id: z.string().min(1),
    width: z.number().optional(),
    height: z.number().optional(),
    file_size: z.number().optional(),
  })
  .loose()

const videoSchema = z
  .object({
    file_id: z.string().min(1),
    file_size: z.number().optional(),
    duration: z.number().optional(),
    file_name: z.string().optional(),
    mime_type: z.string().optional(),
  })
  .loose()

const documentSchema = z
  .object({
    file_id: z.string().min(1),
    file_size: z.number().optional(),
    file_name: z.string().optional(),
    mime_type: z.string().optional(),
  })
  .loose()

const messageSchema = z
  .object({
    message_id: idSchema,
    chat: chatSchema,
    from: userSchema.optional(),
    sender_chat: chatSchema.optional(),
    text: z.string().optional(),
    photo: z.array(photoSizeSchema).optional(),
    video: videoSchema.optional(),
    document: documentSchema.optional(),
    migrate_to_chat_id: idSchema.optional(),
  })
  .loose()

const memberUpdateSchema = z
  .object({
    chat: chatSchema,
    new_chat_member: z.object({ status: z.string() }).loose(),
  })
  .loose()

const updateSchema = z
  .object({
    update_id: z.number(),
    message: messageSchema.optional(),
    my_chat_member: memberUpdateSchema.optional(),
  })
  .loose()

type Message = z.infer<typeof messageSchema>

const IGNORED: InboundMessage = { type: 'ignored' }
const MAX_NAME = 200

/** The id of an update, or `null` when it is not even that: used to move the cursor past it. */
export const updateIdOf = (raw: unknown): number | null => {
  const parsed = z.object({ update_id: z.number() }).loose().safeParse(raw)
  return parsed.success ? parsed.data.update_id : null
}

const fullName = (parts: {
  first_name?: string | undefined
  last_name?: string | undefined
}): string | null => {
  const joined = [parts.first_name, parts.last_name]
    .filter((part) => part !== undefined && part !== '')
    .join(' ')
  return joined === '' ? null : joined
}

/** The sender, or `null` when no human or group account stands behind the message (the media is then ignored). */
const senderOf = (message: Message): ChannelSender | null => {
  const chat = message.chat
  const via = message.sender_chat
  if (via !== undefined) {
    // An administrator writing "as the group": the group is the author. A channel is not.
    if (via.id !== chat.id) return null
    return { ref: chat.id, displayName: null, isBot: false, isAnonymous: true }
  }
  const from = message.from
  if (from === undefined) return null
  return {
    ref: from.id,
    displayName: fullName(from),
    isBot: from.is_bot === true,
    isAnonymous: false,
  }
}

const conversationTitleOf = (chat: Message['chat']): string | null => chat.title ?? fullName(chat)

const nameOf = (declared: string | undefined, fallback: string): string => {
  const base = toSingleLine(declared ?? '').replace(/[\\/]/gu, '')
  return (base === '' ? fallback : base).slice(0, MAX_NAME)
}

const translateMessage = (message: Message, botUsername: string): InboundMessage => {
  if (message.migrate_to_chat_id !== undefined) {
    return {
      type: 'conversationMoved',
      channel: 'telegram',
      fromRef: message.chat.id,
      toRef: message.migrate_to_chat_id,
    }
  }

  const sender = senderOf(message)
  if (sender === null) return IGNORED

  const origin = {
    channel: 'telegram',
    conversationRef: message.chat.id,
    conversationTitle: conversationTitleOf(message.chat),
    messageRef: message.message_id,
    sender,
  } as const

  if (message.text !== undefined) {
    // Read for a command and thrown away: the words of the group are not ours.
    const command = parseCommand(message.text, botUsername)
    if (command === null || sender.isBot) return IGNORED
    return { type: 'command', ...origin, command: command.command, argument: command.argument }
  }

  if (sender.isBot) return IGNORED

  if (message.photo !== undefined && message.photo.length > 0) {
    const largest = [...message.photo].sort(
      (left, right) =>
        (right.file_size ?? (right.width ?? 0) * (right.height ?? 0)) -
        (left.file_size ?? (left.width ?? 0) * (left.height ?? 0)),
    )[0]
    if (largest === undefined) return IGNORED
    return {
      type: 'media',
      ...origin,
      kind: 'photo',
      fileRef: largest.file_id,
      declaredBytes: largest.file_size ?? null,
      durationMs: null,
      declaredName: `photo-${message.message_id}.jpg`,
      declaredMimeType: 'image/jpeg',
    }
  }

  if (message.video !== undefined) {
    const video = message.video
    return {
      type: 'media',
      ...origin,
      kind: 'video',
      fileRef: video.file_id,
      declaredBytes: video.file_size ?? null,
      durationMs: video.duration === undefined ? null : Math.round(video.duration * 1000),
      declaredName: nameOf(video.file_name, `video-${message.message_id}.mp4`),
      declaredMimeType: video.mime_type ?? null,
    }
  }

  if (message.document !== undefined) {
    const document = message.document
    return {
      type: 'media',
      ...origin,
      kind: 'document',
      fileRef: document.file_id,
      declaredBytes: document.file_size ?? null,
      durationMs: null,
      declaredName: nameOf(document.file_name, `file-${message.message_id}`),
      declaredMimeType: document.mime_type ?? null,
    }
  }

  return IGNORED
}

/** One raw update as the one `InboundMessage` it stands for (`ignored` when it stands for nothing of ours). */
export const translateUpdate = (raw: unknown, botUsername: string): InboundMessage => {
  const parsed = updateSchema.safeParse(raw)
  if (!parsed.success) return IGNORED
  const update = parsed.data

  if (update.message !== undefined) return translateMessage(update.message, botUsername)

  if (update.my_chat_member !== undefined) {
    const status = update.my_chat_member.new_chat_member.status
    if (status === 'left' || status === 'kicked') {
      return {
        type: 'botRemoved',
        channel: 'telegram',
        conversationRef: update.my_chat_member.chat.id,
      }
    }
  }
  return IGNORED
}
