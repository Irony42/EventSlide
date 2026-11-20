import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTelegramBringUp, type TelegramBringUpDeps } from './telegramBringUp'
import type { ChannelPoller } from './channelPoller'
import type { MessagingChannel } from '../application/ports/messagingChannel'
import { CapturingLogger } from '../application/testing/capturingLogger'
import type { ChannelKind } from '../domain/channels/channelKind'
import { TelegramBotApi } from '../infrastructure/channels/telegram/telegramBotApi'
import { FakeBotApiServer } from '../infrastructure/channels/telegram/testing/fakeBotApiServer'

const TOKEN = '123456789:AAEhBP0av28dHx_2TaQ-9mPzK3l0QbCdEfG'

let server: FakeBotApiServer

beforeEach(async () => {
  server = new FakeBotApiServer({ token: TOKEN, username: 'EventSlideTestBot' })
  await server.start()
})

afterEach(async () => {
  await server.stop()
})

const build = (overrides: Partial<TelegramBringUpDeps> = {}) => {
  const channels = new Map<ChannelKind, MessagingChannel>()
  const logger = new CapturingLogger()
  const calls: string[] = []
  const waits: number[] = []
  const poller: ChannelPoller = {
    running: false,
    start: () => void calls.push('poller:start'),
    stop: () => void calls.push('poller:stop'),
  }
  const bringUp = createTelegramBringUp({
    api: new TelegramBotApi({ token: TOKEN, baseUrl: server.baseUrl, timeoutMs: 2_000 }),
    botId: '123456789',
    channels,
    createPoller: () => poller,
    startWorker: () => void calls.push('worker:start'),
    stopWorker: () => void calls.push('worker:stop'),
    logger,
    wait: async (ms) => {
      waits.push(ms)
    },
    ...overrides,
  })
  return { bringUp, channels, logger, calls, waits }
}

const until = async (check: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('telegramBringUp', () => {
  it('registers the channel, then starts the worker before the poller, once the bot answers', async () => {
    const { bringUp, channels, calls } = build()

    bringUp.start()
    await until(() => bringUp.state === 'ready')

    expect(channels.get('telegram')?.identity()).toEqual({ username: 'EventSlideTestBot' })
    expect(calls).toEqual(['worker:start', 'poller:start'])
  })

  it('registers the command menu in five languages once the bot answers', async () => {
    const { bringUp } = build()

    bringUp.start()
    await until(() => server.menus().length === 5)

    expect(server.menus().map((menu) => menu.language)).toEqual([null, 'fr', 'de', 'es', 'it'])
    expect(server.menus()[0]?.commands).toEqual(['event', 'forget', 'privacy'])
    expect(server.menus()[1]?.commands).toEqual(['soiree', 'oublier', 'confidentialite'])
  })

  it('only warns, with no token in the line, and stays ready when a menu cannot be registered', async () => {
    server.failNext('setMyCommands', 400, { ok: false, error_code: 400, description: TOKEN })
    const { bringUp, logger } = build()

    bringUp.start()
    await until(() =>
      logger.lines.some((line) => /menu could not be registered/u.test(line.message)),
    )

    expect(bringUp.state).toBe('ready')
    expect(JSON.stringify(logger.lines)).not.toContain(TOKEN)
    await until(() => server.menus().length === 5)
  })

  it('does not warn about a menu it was stopped in the middle of', async () => {
    const { bringUp, logger } = build()
    bringUp.start()
    await until(() => bringUp.state === 'ready')
    bringUp.stop()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(logger.lines.filter((line) => /menu could not/u.test(line.message))).toEqual([])
  })

  it('returns at once and registers nothing before the bot has answered', () => {
    const { bringUp, channels } = build()

    bringUp.start()

    expect(bringUp.state).toBe('identifying')
    expect(channels.size).toBe(0)
  })

  it('is off, with an error line and no retry, when Telegram refuses the token', async () => {
    const { bringUp, channels, logger, calls, waits } = build({
      api: new TelegramBotApi({
        token: '999999999:WRONGWRONGWRONGWRONGWRONGWRONG',
        baseUrl: server.baseUrl,
        timeoutMs: 2_000,
      }),
    })

    bringUp.start()
    await until(() => bringUp.state === 'refused')

    expect(channels.size).toBe(0)
    expect(calls).toEqual([])
    expect(waits).toEqual([])
    expect(logger.lines.some((line) => line.level === 'error')).toBe(true)
    expect(JSON.stringify(logger.lines)).not.toContain('WRONGWRONG')
  })

  it.each([
    ['unreachable', 0],
    ['rate limited', 429],
    ['unavailable', 502],
  ])(
    'keeps trying with a growing wait when Telegram is %s, and comes up when it answers',
    async (_name, status) => {
      if (status !== 0) {
        server.failNext('getMe', status, { ok: false, error_code: status })
        server.failNext('getMe', status, { ok: false, error_code: status })
      }
      const unreachable = new TelegramBotApi({
        token: TOKEN,
        baseUrl: 'http://127.0.0.1:1',
        timeoutMs: 300,
      })
      let tries = 0
      const real = new TelegramBotApi({ token: TOKEN, baseUrl: server.baseUrl, timeoutMs: 2_000 })
      const api = {
        getMe: async (signal: AbortSignal) => {
          tries += 1
          return status === 0 && tries < 3 ? unreachable.getMe(signal) : real.getMe(signal)
        },
        setMyCommands: real.setMyCommands.bind(real),
      } as unknown as TelegramBotApi
      const { bringUp, channels, waits } = build({ api })

      bringUp.start()
      await until(() => bringUp.state === 'ready')

      expect(channels.has('telegram')).toBe(true)
      expect(waits.slice(0, 2)).toEqual([1_000, 2_000])
    },
  )

  it('stops the attempts, the poller and the worker, and is idempotent', async () => {
    const { bringUp, calls } = build()
    bringUp.start()
    bringUp.start()
    await until(() => bringUp.state === 'ready')

    bringUp.stop()
    bringUp.stop()

    expect(bringUp.state).toBe('stopped')
    expect(calls.filter((call) => call === 'poller:stop')).toHaveLength(2)
    expect(calls.filter((call) => call === 'worker:start')).toHaveLength(1)
  })

  it('does not come up if it is stopped while it is still asking', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const real = new TelegramBotApi({ token: TOKEN, baseUrl: server.baseUrl, timeoutMs: 2_000 })
    const api = {
      getMe: async (signal: AbortSignal) => {
        await gate
        return real.getMe(signal)
      },
      setMyCommands: real.setMyCommands.bind(real),
    } as unknown as TelegramBotApi
    const { bringUp, channels } = build({ api })

    bringUp.start()
    bringUp.stop()
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(channels.size).toBe(0)
    expect(bringUp.state).toBe('stopped')
  })

  it('keeps a refusal as the state after stopping', async () => {
    const { bringUp } = build({
      api: new TelegramBotApi({
        token: '999999999:WRONGWRONGWRONGWRONGWRONGWRONG',
        baseUrl: server.baseUrl,
        timeoutMs: 2_000,
      }),
    })
    bringUp.start()
    await until(() => bringUp.state === 'refused')

    bringUp.stop()

    expect(bringUp.state).toBe('refused')
  })
})
