import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { anEventSettings } from '../application/testing/builders'
import { loadConfig } from '../infrastructure/config/env'
import { FakeBotApiServer } from '../infrastructure/channels/telegram/testing/fakeBotApiServer'
import { createContainer, type Container } from './container'

/**
 * **A Telegram group through the real composition root** (spec 27, PR 4): the bot token turns the channel on, a
 * `/soiree CODE` in the group connects it, and a photograph posted there becomes a photograph of the event, with the
 * moderation, the quotas and the reaction of any other. The adapters, the use cases and the loops are proven apart;
 * what only the container can break is the wiring: no bot without a token, no poller for a refused token, the worker
 * handed the real pipelines, and the cursor saved.
 */

const TOKEN = '123456789:AAEhBP0av28dHx_2TaQ-9mPzK3l0QbCdEfG'
const GROUP = { id: -1001, type: 'supergroup', title: 'Mariage Léa & Tom' }
const LEA = { id: 42, is_bot: false, first_name: 'Léa', last_name: 'Martin' }

let workDir: string | null = null
let container: Container | null = null
let server: FakeBotApiServer | null = null

afterEach(async () => {
  await container?.dispose()
  container = null
  await server?.stop()
  server = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

const boot = async (source: Record<string, string>): Promise<Container> => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-channels-container-'))
  container = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      ...source,
    }),
  )
  return container
}

const seedEvent = (booted: Container): void => {
  const now = new Date().toISOString()
  booted.db
    .prepare(
      `INSERT INTO users (id, email, password_hash, created_at) VALUES ('user-host', 'host@example.test', 'hash:x', ?)`,
    )
    .run(now)
  booted.db
    .prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes, created_at)
       VALUES ('event-1', 'user-host', 'Mariage', 'mariage', 'H7K2QM', 'live', ?, 1000000000, ?)`,
    )
    .run(
      JSON.stringify(anEventSettings({ allowTelegram: true, moderation: 'auto' }).toProps()),
      now,
    )
}

const photoOf = async (name: string): Promise<Buffer> =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 30, b: 60 } } })
    .jpeg()
    .toBuffer()
    .then((buffer) => {
      void name
      return buffer
    })

const until = async (check: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 15_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const count = (booted: Container, sql: string): number =>
  (booted.db.prepare(sql).get() as { n: number }).n

describe('the Telegram channel in the composition root', () => {
  it('has no poller, no worker and no connection without a token', async () => {
    server = new FakeBotApiServer({ token: TOKEN })
    const baseUrl = await server.start()

    const booted = await boot({ TELEGRAM_API_BASE_URL: baseUrl })

    expect(booted.telegram).toBeNull()
    expect(server.paths).toEqual([])
  })

  it('turns the function off, with the server up, when Telegram refuses the token', async () => {
    server = new FakeBotApiServer({ token: TOKEN })
    const baseUrl = await server.start()
    const booted = await boot({
      TELEGRAM_BOT_TOKEN: '999999999:WRONGWRONGWRONGWRONGWRONGWRONG',
      TELEGRAM_API_BASE_URL: baseUrl,
    })

    booted.telegram?.start()
    await until(() => booted.telegram?.state === 'refused', 'the refusal')

    // Asked who it is, once; never polled, never worked on.
    expect(server.calls.map((call) => call.method)).toEqual(['getMe'])
  })

  it('does not wait for Telegram at boot, and keeps trying when it cannot be reached', async () => {
    const startedAt = Date.now()
    const booted = await boot({
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_API_BASE_URL: 'http://127.0.0.1:1',
    })
    expect(Date.now() - startedAt).toBeLessThan(10_000)

    booted.telegram?.start()
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Not refused: a network that blinked is no reason to stay off until the next restart.
    expect(booted.telegram?.state).toBe('identifying')
  })

  it('connects a group with /soiree and turns a photograph posted there into one of the event', async () => {
    server = new FakeBotApiServer({ token: TOKEN })
    const baseUrl = await server.start()
    server.hold('big', await photoOf('big'))
    const booted = await boot({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE_URL: baseUrl })
    seedEvent(booted)
    expect(booted.telegram).not.toBeNull()

    server.push({ message: { message_id: 1, chat: GROUP, from: LEA, text: '/soiree H7K2-QM' } })
    server.push({
      message: {
        message_id: 2,
        chat: GROUP,
        from: LEA,
        photo: [
          { file_id: 'big', width: 32, height: 32, file_size: 500 },
          { file_id: 'small', width: 8, height: 8, file_size: 50 },
        ],
      },
    })
    booted.telegram?.start()

    await until(() => count(booted, `SELECT COUNT(*) AS n FROM photos`) === 1, 'the photograph')

    // The group is connected, the bot said so, in French, once.
    expect(
      count(booted, `SELECT COUNT(*) AS n FROM channel_bindings WHERE unbound_at IS NULL`),
    ).toBe(1)
    expect(server.said()[0]?.text).toContain('Mariage')
    // The sender is a guest named by first name and initial, found by a fingerprint and never by the account number.
    const guest = booted.db
      .prepare(`SELECT display_name, channel, channel_sender_key FROM guests`)
      .get() as { display_name: string; channel: string; channel_sender_key: string }
    expect(guest).toMatchObject({ display_name: 'Léa M.', channel: 'telegram' })
    expect(guest.channel_sender_key).toMatch(/^[0-9a-f]{64}$/u)
    // Published at once (auto moderation), counted for the host, acknowledged with a reaction.
    expect(count(booted, `SELECT COUNT(*) AS n FROM photos WHERE status = 'published'`)).toBe(1)
    await until(() => server?.reactions().length === 1, 'the reaction')
    expect(server.reactions()).toEqual([{ chat_id: -1001, message_id: 2 }])
    expect(
      count(booted, `SELECT received_count AS n FROM channel_bindings WHERE unbound_at IS NULL`),
    ).toBe(1)
    // The cursor moved past both updates, so a restart does not replay them.
    await until(
      () =>
        (
          booted.db.prepare(`SELECT cursor FROM channel_cursors`).get() as
            { cursor: string } | undefined
        )?.cursor === '123456789:3',
      'the cursor',
    )
  })

  it('never writes the bot token into a table', async () => {
    server = new FakeBotApiServer({ token: TOKEN })
    const baseUrl = await server.start()
    server.hold('big', await photoOf('big'))
    const booted = await boot({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE_URL: baseUrl })
    seedEvent(booted)
    server.push({ message: { message_id: 1, chat: GROUP, from: LEA, text: '/soiree H7K2QM' } })
    server.push({
      message: {
        message_id: 2,
        chat: GROUP,
        from: LEA,
        photo: [{ file_id: 'big', width: 32, height: 32 }],
      },
    })
    booted.telegram?.start()
    await until(() => count(booted, `SELECT COUNT(*) AS n FROM photos`) === 1, 'the photograph')

    const tables = booted.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as { name: string }[]
    for (const { name } of tables) {
      const rows = JSON.stringify(booted.db.prepare(`SELECT * FROM "${name}"`).all())
      expect(rows, name).not.toContain(TOKEN)
      expect(rows, name).not.toContain('AAEhBP0av28dHx')
    }
  })
})
