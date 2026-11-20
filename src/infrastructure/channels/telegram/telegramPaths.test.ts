import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CapturingLogger } from '../../../application/testing/capturingLogger'
import { TelegramBotApi } from './telegramBotApi'
import { TelegramInbox, TelegramMessagingChannel } from './telegramChannel'
import { FakeBotApiServer } from './testing/fakeBotApiServer'
import { translateUpdate } from './telegramUpdates'

/**
 * The paths of the Telegram adapter that a healthy Bot API never takes: an answer that is not the envelope, a body that
 * breaks half way, a field that is missing. Each is a way the real service (or a proxy in front of it) can misbehave, and
 * each must come out as a code and never as an exception or a leaked address.
 */

const TOKEN = '123456789:AAEhBP0av28dHx_2TaQ-9mPzK3l0QbCdEfG'
const signal = new AbortController().signal
const GROUP = { id: -1001, type: 'supergroup', title: 'Mariage' }
const ALICE = { id: 42, is_bot: false, first_name: 'Léa' }

let server: FakeBotApiServer
let api: TelegramBotApi

beforeEach(async () => {
  server = new FakeBotApiServer({ token: TOKEN })
  await server.start()
  api = new TelegramBotApi({ token: TOKEN, baseUrl: server.baseUrl, timeoutMs: 2_000 })
})

afterEach(async () => {
  await server.stop()
})

/** A client whose `fetch` answers what the test builds, and nothing else. */
const answering = (build: () => Response): TelegramBotApi =>
  new TelegramBotApi({
    token: TOKEN,
    baseUrl: 'http://bot.test',
    fetch: async () => build(),
  })

const streamOf = (
  chunks: Uint8Array[],
  options: { failAfter?: boolean; cancelFails?: boolean; keepOpen?: boolean } = {},
) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      if (options.failAfter === true) controller.error(new Error('connection reset'))
      else if (options.keepOpen !== true) controller.close()
    },
    cancel() {
      if (options.cancelFails === true) throw new Error('cannot cancel')
    },
  })

describe('TelegramBotApi: an answer that is not what was asked', () => {
  it('rejects a getMe with no username, or with a result that is not an object', async () => {
    server.failNext('getMe', 200, { ok: true, result: {} })
    server.failNext('getMe', 200, { ok: true, result: 5 })

    expect(await api.getMe(signal)).toMatchObject({
      ok: false,
      error: { code: 'telegram.rejected' },
    })
    expect(await api.getMe(signal)).toMatchObject({
      ok: false,
      error: { code: 'telegram.rejected' },
    })
  })

  it('rejects updates that are not a list, and skips what is not an update in a list', async () => {
    server.failNext('getUpdates', 200, { ok: true, result: { not: 'a list' } })
    server.failNext('getUpdates', 200, { ok: true, result: [1, 'x', null, { update_id: 7 }] })

    expect(await api.getUpdates(null, 0, signal)).toMatchObject({ ok: false })
    expect(await api.getUpdates(null, 0, signal)).toEqual({ ok: true, value: [{ update_id: 7 }] })
  })

  it('rejects a file with no path, or with a result that is not an object', async () => {
    server.failNext('getFile', 200, { ok: true, result: {} })
    server.failNext('getFile', 200, { ok: true, result: 'x' })

    expect(await api.getFilePath('f', signal)).toMatchObject({ ok: false })
    expect(await api.getFilePath('f', signal)).toMatchObject({ ok: false })
  })

  it('reads a numeric code only when it is one', async () => {
    server.failNext('getMe', 400, {
      ok: false,
      error_code: 'oops',
      parameters: { retry_after: 'soon' },
    })

    expect(await api.getMe(signal)).toMatchObject({
      ok: false,
      error: { errorCode: null, retryAfterSeconds: null, status: 400 },
    })
  })

  it('answers a body that is not JSON as a rejection carrying the status', async () => {
    const broken = answering(() => new Response('<html>bad gateway</html>', { status: 502 }))

    expect(await broken.getMe(signal)).toMatchObject({
      ok: false,
      error: { code: 'telegram.rejected', status: 502 },
    })
  })

  it('sends a channel name as the string it is, and a number as a number', async () => {
    await api.sendMessage('@mychannel', 'x', undefined, signal)
    await api.sendMessage('-1001', 'y', undefined, signal)

    expect(server.calls.map((call) => call.body['chat_id'])).toEqual(['@mychannel', -1001])
  })
})

describe('TelegramBotApi: a file that does not arrive as it should', () => {
  it('rejects a download the service refuses, whatever it sent', async () => {
    const refused = answering(
      () => new Response(streamOf([new Uint8Array(3)], { cancelFails: true }), { status: 500 }),
    )

    expect(await refused.downloadFile('files/x', 100, signal)).toMatchObject({
      ok: false,
      error: { code: 'telegram.rejected', status: 500 },
    })
  })

  it('refuses at once a file whose declared length is over the limit, and drops its body', async () => {
    const declared = answering(
      () =>
        new Response(streamOf([new Uint8Array(3)], { cancelFails: true }), {
          status: 200,
          headers: { 'content-length': '5000' },
        }),
    )

    expect(await declared.downloadFile('files/x', 100, signal)).toEqual({
      ok: false,
      error: 'tooLarge',
    })
  })

  it('reads a declared length from the real server too', async () => {
    server.hold('big', Buffer.alloc(500))
    const located = await api.getFilePath('big', signal)
    if (!located.ok) throw new Error('getFile')

    expect(await api.downloadFile(located.value, 100, signal)).toEqual({
      ok: false,
      error: 'tooLarge',
    })
  })

  it('cuts a stream that passes the limit even when cancelling it fails', async () => {
    const lying = answering(
      () =>
        new Response(
          streamOf([new Uint8Array(60), new Uint8Array(60)], { cancelFails: true, keepOpen: true }),
        ),
    )

    expect(await lying.downloadFile('files/x', 100, signal)).toEqual({
      ok: false,
      error: 'tooLarge',
    })
  })

  it('takes a response with no body as an empty file', async () => {
    const empty = answering(() => new Response(null, { status: 200 }))

    expect(await empty.downloadFile('files/x', 100, signal)).toEqual({
      ok: true,
      value: new Uint8Array(0),
    })
  })

  it('reports a body that breaks half way as unreachable, not as an exception', async () => {
    const broken = answering(
      () => new Response(streamOf([new Uint8Array(10)], { failAfter: true })),
    )

    expect(await broken.downloadFile('files/x', 100, signal)).toMatchObject({
      ok: false,
      error: { code: 'telegram.unreachable', aborted: false },
    })
  })

  it('joins the chunks of a body in order', async () => {
    const chunked = answering(() => new Response(streamOf([Uint8Array.of(1, 2), Uint8Array.of(3)])))

    expect(await chunked.downloadFile('files/x', 100, signal)).toEqual({
      ok: true,
      value: Uint8Array.of(1, 2, 3),
    })
  })
})

describe('the Telegram channel and inbox on odd answers', () => {
  const channel = () =>
    new TelegramMessagingChannel({ api, username: 'Bot', logger: new CapturingLogger() })

  it('says a file with no path is gone for good, without a status to read', async () => {
    server.failNext('getFile', 200, { ok: true, result: {} })

    expect(await channel().download('f', 10, signal)).toEqual({
      ok: false,
      error: { code: 'channel.fileGone', retryable: false },
    })
  })

  it('replies and reacts without a word in the log when it works', async () => {
    const logger = new CapturingLogger()
    const quiet = new TelegramMessagingChannel({ api, username: 'Bot', logger })

    await quiet.reply('-1001', 'hello')
    await quiet.acknowledge('-1001', '5')

    expect(logger.lines).toEqual([])
    expect(server.said()).toHaveLength(1)
    expect(server.reactions()).toHaveLength(1)
  })

  it('polls for thirty seconds unless told otherwise, and waits five seconds when a 429 names no time', async () => {
    const inbox = new TelegramInbox({ api, username: 'Bot', botId: '123456789' })
    server.failNext('getUpdates', 429, { ok: false, error_code: 429 })

    const limited = await inbox.next(null, signal)

    expect(limited).toEqual({
      ok: false,
      error: { code: 'telegram.rateLimited', retryable: true, waitMs: 5_000 },
    })
    expect(server.calls.at(-1)?.body['timeout']).toBe(30)
  })

  it('moves the cursor over an update that carries no id of its own', async () => {
    const inbox = new TelegramInbox({ api, username: 'Bot', botId: '123456789', pollSeconds: 0 })
    server.failNext('getUpdates', 200, {
      ok: true,
      result: [{ nothing: 'here' }, { update_id: 9, edited_message: {} }, { update_id: 4 }],
    })

    const batch = await inbox.next(null, signal)

    expect(batch).toEqual({ ok: true, value: { messages: [], cursor: '123456789:10' } })
  })
})

describe('translateUpdate: messages that carry less than they might', () => {
  const message = (extra: Record<string, unknown>, from: unknown = ALICE) => ({
    update_id: 1,
    message: { message_id: 5, chat: GROUP, from, ...extra },
  })

  it('leaves a sender with no name nameless', () => {
    const translated = translateUpdate(message({ text: '/oublier' }, { id: 7 }), 'Bot')

    expect(translated).toMatchObject({ sender: { ref: '7', displayName: null } })
  })

  it('takes the biggest of sizes that declare a length or only their pixels, in any order', () => {
    const photo = [
      { file_id: 'by-pixels', width: 100, height: 100 },
      { file_id: 'by-bytes', file_size: 20_000 },
      { file_id: 'bare' },
    ]

    expect(translateUpdate(message({ photo }), 'Bot')).toMatchObject({ fileRef: 'by-bytes' })
    expect(translateUpdate(message({ photo: [...photo].reverse() }), 'Bot')).toMatchObject({
      fileRef: 'by-bytes',
    })
  })

  it('takes a photograph, a video and a document that declare nothing but their file', () => {
    expect(translateUpdate(message({ photo: [{ file_id: 'p' }] }), 'Bot')).toMatchObject({
      declaredBytes: null,
    })
    expect(translateUpdate(message({ video: { file_id: 'v' } }), 'Bot')).toMatchObject({
      kind: 'video',
      declaredBytes: null,
      durationMs: null,
      declaredMimeType: null,
    })
    expect(translateUpdate(message({ document: { file_id: 'd' } }), 'Bot')).toMatchObject({
      kind: 'document',
      declaredBytes: null,
      declaredMimeType: null,
    })
  })
})
