import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CapturingLogger } from '../../../application/testing/capturingLogger'
import { TelegramBotApi } from './telegramBotApi'
import { TelegramInbox, TelegramMessagingChannel } from './telegramChannel'
import { FakeBotApiServer } from './testing/fakeBotApiServer'

const TOKEN = '123456789:AAEhBP0av28dHx_2TaQ-9mPzK3l0QbCdEfG'
const signal = new AbortController().signal

let server: FakeBotApiServer
let api: TelegramBotApi
let logger: CapturingLogger

beforeEach(async () => {
  server = new FakeBotApiServer({ token: TOKEN })
  const baseUrl = await server.start()
  api = new TelegramBotApi({ token: TOKEN, baseUrl, timeoutMs: 2_000 })
  logger = new CapturingLogger()
})

afterEach(async () => {
  await server.stop()
})

const ALICE = { id: 42, is_bot: false, first_name: 'Léa' }
const GROUP = { id: -1001, type: 'supergroup', title: 'Mariage' }

describe('TelegramBotApi', () => {
  it('asks for the bot identity', async () => {
    expect(await api.getMe(signal)).toMatchObject({
      ok: true,
      value: { username: 'EventSlideBot' },
    })
  })

  it('rebuilds a rejection as a code and numbers, and never repeats what the service said', async () => {
    server.failNext('getUpdates', 409, {
      ok: false,
      error_code: 409,
      description: `Conflict: terminated by other getUpdates request, bot${TOKEN}`,
    })

    const result = await api.getUpdates(null, 0, signal)

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'telegram.rejected',
        status: 409,
        errorCode: 409,
        retryAfterSeconds: null,
        fileTooBig: false,
        aborted: false,
      },
    })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('keeps the token out of every error when the service cannot be reached', async () => {
    const dead = new TelegramBotApi({
      token: TOKEN,
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 500,
    })

    const results = [
      await dead.getMe(signal),
      await dead.getUpdates(null, 0, signal),
      await dead.getFilePath('f', signal),
      await dead.downloadFile('files/f', 10, signal),
      await dead.sendMessage('1', 'x', undefined, signal),
      await dead.setReaction('1', '2', '👍', signal),
    ]

    for (const result of results) {
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain(TOKEN)
      expect(JSON.stringify(result)).not.toContain('127.0.0.1')
    }
    expect(results[0]).toMatchObject({ error: { code: 'telegram.unreachable', status: null } })
  })

  it('reports an abort as the caller own doing, not as a network fault', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await api.getMe(controller.signal)

    expect(result).toMatchObject({ ok: false, error: { aborted: true } })
  })

  it('reads the wait Telegram asks for on a 429', async () => {
    server.failNext('getUpdates', 429, {
      ok: false,
      error_code: 429,
      parameters: { retry_after: 7 },
    })

    const result = await api.getUpdates(null, 0, signal)

    expect(result).toMatchObject({ ok: false, error: { errorCode: 429, retryAfterSeconds: 7 } })
  })

  it('answers a body that is not the envelope as a rejection', async () => {
    server.failNext('getMe', 200, 'not json at all')

    const result = await api.getMe(signal)

    expect(result).toMatchObject({ ok: false, error: { code: 'telegram.rejected' } })
  })

  it('downloads a file up to the limit and no further', async () => {
    server.hold('f1', Buffer.alloc(100, 1))
    const located = await api.getFilePath('f1', signal)
    if (!located.ok) throw new Error('getFile failed')

    const whole = await api.downloadFile(located.value, 100, signal)
    expect(whole.ok && whole.value.length).toBe(100)

    const cut = await api.downloadFile(located.value, 99, signal)
    expect(cut).toEqual({ ok: false, error: 'tooLarge' })
  })

  it('cuts a download whose length was not declared as soon as it passes the limit', async () => {
    server.hold('f1', Buffer.alloc(50_000, 1))
    const fetched: typeof fetch = async (input, init) => {
      const real = await fetch(input, init)
      // A chunked body with no content-length: the lie the limit exists for.
      return new Response(real.body, { status: real.status })
    }
    const lying = new TelegramBotApi({
      token: TOKEN,
      baseUrl: server.baseUrl,
      fetch: fetched,
    })

    expect(await lying.downloadFile('files/f1', 1_000, signal)).toEqual({
      ok: false,
      error: 'tooLarge',
    })
  })

  it('sends a message as a reply, and a reaction, to numeric identifiers', async () => {
    await api.sendMessage('-1001', 'bonjour', '99', signal)
    await api.setReaction('-1001', '99', '👍', signal)

    expect(server.said()).toEqual([{ chat_id: -1001, text: 'bonjour', reply_to: 99 }])
    expect(server.reactions()).toEqual([{ chat_id: -1001, message_id: 99, emoji: '👍' }])
  })

  it('uses its own token in the path, so a wrong one is refused', async () => {
    const wrong = new TelegramBotApi({
      token: '999:WRONGWRONGWRONGWRONGWRONGWRONG',
      baseUrl: server.baseUrl,
    })

    expect(await wrong.getMe(signal)).toMatchObject({ ok: false, error: { status: 401 } })
  })
})

describe('TelegramMessagingChannel', () => {
  const channel = () =>
    new TelegramMessagingChannel({
      api,
      username: 'EventSlideBot',
      botId: '1',
      readsAll: true,
      logger,
    })

  it('hands over the bytes of a file', async () => {
    server.hold('f1', Buffer.from('bytes'))

    const result = await channel().download('f1', 100, signal)

    expect(result.ok && Buffer.from(result.value).toString()).toBe('bytes')
  })

  it.each([['a file Telegram no longer knows', 'unknown', 'channel.fileGone', false]])(
    'says %s is final',
    async (_name, fileRef, code, retryable) => {
      const result = await channel().download(fileRef, 100, signal)

      expect(result).toEqual({ ok: false, error: { code, retryable } })
    },
  )

  it('says a file over the limit is too large, and final', async () => {
    server.hold('f1', Buffer.alloc(100))

    expect(await channel().download('f1', 10, signal)).toEqual({
      ok: false,
      error: { code: 'channel.mediaTooLarge', retryable: false },
    })
  })

  it('says a file Telegram itself calls too big is too large, and final', async () => {
    server.failNext('getFile', 400, {
      ok: false,
      error_code: 400,
      description: 'Bad Request: file is too big',
    })

    expect(await channel().download('f1', 10, signal)).toEqual({
      ok: false,
      error: { code: 'channel.mediaTooLarge', retryable: false },
    })
  })

  it.each([429, 500, 502])('says a %s from Telegram is a blink to try again', async (status) => {
    server.failNext('getFile', status, { ok: false, error_code: status })

    expect(await channel().download('f1', 10, signal)).toEqual({
      ok: false,
      error: { code: 'channel.downloadUnavailable', retryable: true },
    })
  })

  it('says an unreachable Telegram is a blink to try again', async () => {
    const dead = new TelegramBotApi({ token: TOKEN, baseUrl: 'http://127.0.0.1:1', timeoutMs: 300 })
    const unreachable = new TelegramMessagingChannel({
      api: dead,
      username: 'x',
      botId: '1',
      readsAll: true,
      logger,
    })

    expect(await unreachable.download('f1', 10, signal)).toEqual({
      ok: false,
      error: { code: 'channel.downloadUnavailable', retryable: true },
    })
  })

  it('never rejects when it cannot talk, logs a code and never the token or the url', async () => {
    server.failNext('sendMessage', 403, {
      ok: false,
      error_code: 403,
      description: `Forbidden: bot was kicked from the group chat bot${TOKEN}`,
    })
    server.failNext('setMessageReaction', 400, { ok: false, error_code: 400 })

    await expect(channel().reply('-1001', 'hello', '5')).resolves.toBeUndefined()
    await expect(channel().acknowledge('-1001', '5')).resolves.toBeUndefined()

    const logged = JSON.stringify(logger.lines)
    expect(logged).toContain('telegram.rejected')
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain('127.0.0.1')
  })

  it('says what it is called', () => {
    expect(channel().identity()).toEqual({ username: 'EventSlideBot' })
    expect(channel().kind).toBe('telegram')
  })
})

describe('TelegramInbox', () => {
  const inbox = () =>
    new TelegramInbox({ api, username: 'EventSlideBot', botId: '123456789', pollSeconds: 0 })

  it('translates what is queued, and moves the cursor one past the last update', async () => {
    server.push({ message: { message_id: 1, chat: GROUP, from: ALICE, text: '/soiree ABCD' } })
    server.push({ message: { message_id: 2, chat: GROUP, from: ALICE, text: 'just chatting' } })
    server.push({
      message: {
        message_id: 3,
        chat: GROUP,
        from: ALICE,
        photo: [{ file_id: 'p', width: 10, height: 10 }],
      },
    })

    const batch = await inbox().next(null, signal)

    expect(batch.ok && batch.value.messages.map((message) => message.type)).toEqual([
      'command',
      'media',
    ])
    expect(batch.ok && batch.value.cursor).toBe('123456789:4')
  })

  it('resumes from the cursor it is given, and keeps it when there is nothing', async () => {
    server.push({ message: { message_id: 1, chat: GROUP, from: ALICE, text: '/oublier' } })

    const empty = await inbox().next('123456789:2', signal)

    expect(empty).toEqual({ ok: true, value: { messages: [], cursor: null } })
  })

  it('moves past an update it does not understand instead of meeting it again', async () => {
    server.push({ edited_message: { whatever: true } })

    const batch = await inbox().next(null, signal)

    expect(batch).toEqual({ ok: true, value: { messages: [], cursor: '123456789:2' } })
  })

  it('names two instances on one token, in a code the poller can act on', async () => {
    server.failNext('getUpdates', 409, { ok: false, error_code: 409 })

    expect(await inbox().next(null, signal)).toEqual({
      ok: false,
      error: { code: 'telegram.conflict', retryable: true },
    })
  })

  it('carries the wait of a 429 in milliseconds', async () => {
    server.failNext('getUpdates', 429, {
      ok: false,
      error_code: 429,
      parameters: { retry_after: 3 },
    })

    expect(await inbox().next(null, signal)).toEqual({
      ok: false,
      error: { code: 'telegram.rateLimited', retryable: true, waitMs: 3_000 },
    })
  })

  it('says a refused token will not get better', async () => {
    server.failNext('getUpdates', 401, { ok: false, error_code: 401 })

    expect(await inbox().next(null, signal)).toEqual({
      ok: false,
      error: { code: 'telegram.unauthorized', retryable: false },
    })
  })

  it('treats the cursor of another bot as none, so a changed token does not drop new updates', async () => {
    server.push({ message: { message_id: 1, chat: GROUP, from: ALICE, text: '/oublier' } })

    const batch = await inbox().next('987654321:500', signal)

    expect(batch.ok && batch.value.messages).toHaveLength(1)
  })

  it('treats a garbled cursor as none', async () => {
    server.push({ message: { message_id: 1, chat: GROUP, from: ALICE, text: '/oublier' } })

    const batch = await inbox().next('not-a-number', signal)

    expect(batch.ok && batch.value.messages).toHaveLength(1)
  })

  it('reports a network fault as one to try again', async () => {
    const dead = new TelegramBotApi({ token: TOKEN, baseUrl: 'http://127.0.0.1:1', timeoutMs: 300 })
    const unreachable = new TelegramInbox({ api: dead, username: 'x', botId: '1', pollSeconds: 0 })

    expect(await unreachable.next(null, signal)).toEqual({
      ok: false,
      error: { code: 'telegram.unreachable', retryable: true },
    })
  })
})
