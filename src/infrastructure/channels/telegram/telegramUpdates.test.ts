import { describe, expect, it } from 'vitest'
import { translateUpdate, updateIdOf } from './telegramUpdates'

const BOT = 'EventSlideBot'
const ALICE = { id: 42, is_bot: false, first_name: 'Léa', last_name: 'Martin' }
const GROUP = { id: -1001, type: 'supergroup', title: 'Mariage Léa & Tom' }

const message = (extra: Record<string, unknown>, from: unknown = ALICE) => ({
  update_id: 7,
  message: { message_id: 99, chat: GROUP, from, ...extra },
})

describe('translateUpdate: commands', () => {
  it('reads /soiree with its code, and who sent it from which conversation', () => {
    expect(translateUpdate(message({ text: '/soiree H7K2-QM' }), BOT)).toEqual({
      type: 'command',
      channel: 'telegram',
      conversationRef: '-1001',
      conversationTitle: 'Mariage Léa & Tom',
      messageRef: '99',
      sender: { ref: '42', displayName: 'Léa Martin', isBot: false, isAnonymous: false },
      command: 'bind',
      argument: 'H7K2-QM',
    })
  })

  it('ignores a command addressed to another bot, and any text that is not a command, keeping none of it', () => {
    expect(translateUpdate(message({ text: '/soiree@OtherBot ABCD' }), BOT)).toEqual({
      type: 'ignored',
    })
    const chat = translateUpdate(
      message({ text: 'rendez-vous à 20h chez Tom, mon numéro 0612345678' }),
      BOT,
    )
    expect(chat).toEqual({ type: 'ignored' })
    expect(JSON.stringify(chat)).not.toContain('0612')
  })

  it('ignores a command typed by another bot', () => {
    const bot = { ...ALICE, is_bot: true }
    expect(translateUpdate(message({ text: '/oublier' }, bot), BOT).type).toBe('ignored')
  })

  it('names a private chat after the person, since it has no title', () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 5,
        chat: { id: 42, type: 'private', first_name: 'Léa', last_name: 'Martin' },
        from: ALICE,
        text: '/oublier',
      },
    }
    expect(translateUpdate(update, BOT)).toMatchObject({
      command: 'forget',
      conversationTitle: 'Léa Martin',
    })
  })
})

describe('translateUpdate: media', () => {
  it('takes the largest size of a photograph', () => {
    const photo = [
      { file_id: 'small', width: 90, height: 60, file_size: 1_000 },
      { file_id: 'big', width: 1280, height: 960, file_size: 150_000 },
      { file_id: 'mid', width: 320, height: 240, file_size: 20_000 },
    ]
    expect(translateUpdate(message({ photo }), BOT)).toMatchObject({
      type: 'media',
      kind: 'photo',
      fileRef: 'big',
      declaredBytes: 150_000,
      declaredMimeType: 'image/jpeg',
      declaredName: 'photo-99.jpg',
      durationMs: null,
    })
  })

  it('falls back on the pixel count when sizes carry no byte length', () => {
    const photo = [
      { file_id: 'a', width: 100, height: 100 },
      { file_id: 'b', width: 800, height: 600 },
    ]
    expect(translateUpdate(message({ photo }), BOT)).toMatchObject({ fileRef: 'b' })
  })

  it('reads a video with its duration in milliseconds', () => {
    const video = { file_id: 'v1', file_size: 5_000_000, duration: 12, mime_type: 'video/mp4' }
    expect(translateUpdate(message({ video }), BOT)).toMatchObject({
      kind: 'video',
      fileRef: 'v1',
      durationMs: 12_000,
      declaredName: 'video-99.mp4',
      declaredMimeType: 'video/mp4',
    })
  })

  it('reads a document with its declared type, and a name without any path in it', () => {
    const document = { file_id: 'd1', file_name: '../../etc/IMG_01.heic', mime_type: 'image/heic' }
    const translated = translateUpdate(message({ document }), BOT)
    expect(translated).toMatchObject({
      kind: 'document',
      declaredMimeType: 'image/heic',
      declaredName: '....etcIMG_01.heic',
    })
  })

  it('names a nameless document after its message', () => {
    expect(
      translateUpdate(message({ document: { file_id: 'd', mime_type: 'image/png' } }), BOT),
    ).toMatchObject({ declaredName: 'file-99' })
  })

  it('ignores the media of another bot, and what is neither a picture nor a film nor a file', () => {
    const photo = [{ file_id: 'x', width: 10, height: 10 }]
    expect(translateUpdate(message({ photo }, { ...ALICE, is_bot: true }), BOT).type).toBe(
      'ignored',
    )
    expect(translateUpdate(message({ sticker: { file_id: 's' } }), BOT).type).toBe('ignored')
    expect(translateUpdate(message({ photo: [] }), BOT).type).toBe('ignored')
  })
})

describe('translateUpdate: who is behind a message', () => {
  it('makes an administrator writing as the group an anonymous sender, the group being its own reference', () => {
    const update = message(
      { sender_chat: GROUP, photo: [{ file_id: 'p', width: 1, height: 1 }] },
      {
        id: 1087968824,
        is_bot: true,
        first_name: 'Group',
      },
    )
    expect(translateUpdate(update, BOT)).toMatchObject({
      type: 'media',
      sender: { ref: '-1001', displayName: null, isAnonymous: true, isBot: false },
    })
  })

  it('ignores a post made as another chat, such as a linked channel', () => {
    const update = message({
      sender_chat: { id: -2002, type: 'channel', title: 'Canal' },
      photo: [{ file_id: 'p', width: 1, height: 1 }],
    })
    expect(translateUpdate(update, BOT).type).toBe('ignored')
  })

  it('ignores a message with nobody behind it', () => {
    const update = { update_id: 1, message: { message_id: 1, chat: GROUP, text: '/oublier' } }
    expect(translateUpdate(update, BOT).type).toBe('ignored')
  })
})

describe('translateUpdate: the conversation itself', () => {
  it('sees a group becoming a supergroup as the same conversation under a new identifier', () => {
    const update = {
      update_id: 3,
      message: { message_id: 1, chat: { id: -1001, type: 'group' }, migrate_to_chat_id: -1009 },
    }
    expect(translateUpdate(update, BOT)).toEqual({
      type: 'conversationMoved',
      channel: 'telegram',
      fromRef: '-1001',
      toRef: '-1009',
    })
  })

  it.each(['left', 'kicked'])('sees the bot %s as removed', (status) => {
    const update = { update_id: 4, my_chat_member: { chat: GROUP, new_chat_member: { status } } }
    expect(translateUpdate(update, BOT)).toEqual({
      type: 'botRemoved',
      channel: 'telegram',
      conversationRef: '-1001',
    })
  })

  it('ignores the bot being promoted or added', () => {
    const update = {
      update_id: 4,
      my_chat_member: { chat: GROUP, new_chat_member: { status: 'administrator' } },
    }
    expect(translateUpdate(update, BOT).type).toBe('ignored')
  })

  it.each([null, 'x', 5, [], {}, { update_id: 'a' }, { update_id: 1 }])(
    'ignores what is not an update at all (%j)',
    (raw) => {
      expect(translateUpdate(raw, BOT).type).toBe('ignored')
    },
  )
})

describe('updateIdOf', () => {
  it('reads the id of an update, and nothing from anything else', () => {
    expect(updateIdOf({ update_id: 12, anything: 1 })).toBe(12)
    expect(updateIdOf({ update_id: 'x' })).toBeNull()
    expect(updateIdOf(null)).toBeNull()
  })
})
