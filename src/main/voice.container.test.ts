import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from '../interface/http/testing/request'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { anEventSettings } from '../application/testing/builders'
import { asEventId, asGuestId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { probeFfmpegCapability } from '../infrastructure/media/ffmpegBinaries'
import { minimalChildEnv, runProcess } from '../infrastructure/media/runProcess'
import { createContainer, type Container } from './container'

/**
 * **Voice messages through the real composition root** (spec 25, PR 2): which encoder the box
 * ends up with, what a box without one still serves, and a recording that goes all the way, from
 * a staged WebM through the worker to a `ready` voice with a real AAC file behind it.
 *
 * The unit and adapter suites prove each piece; what only the container can break is the wiring:
 * the Null Object on a box with no ffmpeg, the operator's switch, the worker being handed the
 * voice step, and the real adapter being the one the use case calls.
 */

const EVENT = asEventId('event-1')
const GUEST = asGuestId('guest-lea')

let workDir: string | null = null
let container: Container | null = null

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

// A test file, where `process.env` may be read: what is under test is the resolution that
// consumes these values, and the ffmpeg the machine has is the one the generated fixtures use.
const MACHINE_PATH = process.env['PATH'] ?? ''
const MACHINE_PATHEXT = process.env['PATHEXT'] ?? ''
const MACHINE_ENV = minimalChildEnv({
  path: MACHINE_PATH,
  pathExt: MACHINE_PATHEXT,
  systemRoot: process.env['SYSTEMROOT'] ?? '',
  winDir: process.env['WINDIR'] ?? '',
  temp: process.env['TEMP'] ?? '',
  tmp: process.env['TMP'] ?? '',
})

/** A configuration that finds the machine's own ffmpeg, which `boot` below blanks out by default. */
const WITH_FFMPEG = { FFMPEG_PATH: '', FFPROBE_PATH: '' }

const boot = async (source: Record<string, string>): Promise<Container> => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-voice-container-'))
  container = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      // A configured path that does not exist is a refusal rather than a search, so the boot
      // answers "no encoder" without spawning anything.
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      ...source,
    }),
  )
  return container
}

/** The host's event with voice switched on, and the guest who will leave a message. */
const seedEventAndGuest = (booted: Container): void => {
  const now = new Date().toISOString()
  const { db } = booted
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES ('user-host', 'host@example.test', 'hash:x', ?)`,
  ).run(now)
  db.prepare(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes, created_at)
          VALUES ('event-1', 'user-host', 'Test', 'mariage', 'H7K2QM', 'live', ?, 1000000000, ?)`,
  ).run(
    JSON.stringify(
      anEventSettings({ allowGuestbook: true, guestbookVoice: { enabled: true } }).toProps(),
    ),
    now,
  )
  db.prepare(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at) VALUES ('guest-lea', 'event-1', NULL, ?, ?)`,
  ).run(now, now)
}

/** A file made by the machine's own ffmpeg, from the arguments between the quiet flags and the name. */
const generate = async (name: string, args: readonly string[]): Promise<Uint8Array> => {
  const capability = await probeFfmpegCapability({
    search: { path: MACHINE_PATH, extensions: MACHINE_PATHEXT },
    env: MACHINE_ENV,
  })
  if (!capability.available) throw new Error(`this suite needs ffmpeg: ${capability.reason}`)
  const file = join(workDir ?? '', name)
  const made = await runProcess({
    binary: capability.paths.ffmpeg,
    args: ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args, file],
    env: MACHINE_ENV,
    timeoutMs: 60_000,
    stallMs: 30_000,
  })
  if (!made.ok) throw new Error(`could not generate ${name}: ${made.stderr}`)
  return new Uint8Array(await readFile(file))
}

/** A recording as Chrome would send one: Opus in WebM, written live so it declares no duration. */
const aWebmRecording = (seconds = 2): Promise<Uint8Array> =>
  generate('recording.webm', [
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:a',
    'libopus',
    '-f',
    'webm',
    '-live',
    '1',
  ])

const aVideo = (): Promise<Uint8Array> =>
  generate('video.mp4', [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x120:rate=10:duration=1.5',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1.5',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
  ])

const filesUnder = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)],
    ),
  )
  return nested.flat()
}

/** What the media store holds of voice messages: the sources and the outputs, as paths. */
const voiceFiles = async (): Promise<{ sources: string[]; outputs: string[] }> => {
  const files = (await filesUnder(join(workDir ?? '', 'media', 'event-1'))).map((file) =>
    file.split('\\').join('/'),
  )
  return {
    sources: files.filter((file) => file.includes('/source/')),
    outputs: files.filter((file) => file.includes('/voice/')),
  }
}

describe('createContainer: a box with no audio encoder', () => {
  it('does not offer voice messages, and still answers /api/ready 200', async () => {
    const booted = await boot({})

    expect(booted.voiceAvailable).toBe(false)
    const ready = await request(booted.app).get('/api/ready')
    expect(ready.status).toBe(200)
    expect(ready.body.status).toBe('ready')
  })

  it('refuses a recording before a byte is written, with the code of a box that cannot process it', async () => {
    const booted = await boot({})
    seedEventAndGuest(booted)

    const staged = await booted.usecases.stageGuestbookVoice({
      eventId: EVENT,
      guestId: GUEST,
      file: { bytes: await aWebmRecording() },
    })

    expect(!staged.ok && staged.error.code).toBe('voice.transcoderUnavailable')
    expect(await voiceFiles()).toEqual({ sources: [], outputs: [] })
  })
})

describe('createContainer: the operator’s switch', () => {
  it('turns voice messages off for the whole box even when ffmpeg is there', async () => {
    const booted = await boot({ ...WITH_FFMPEG, GUESTBOOK_VOICE_ENABLED: 'false' })

    expect(booted.voiceAvailable).toBe(false)
  })

  it('leaves them on by default when ffmpeg is there', async () => {
    const booted = await boot({ ...WITH_FFMPEG })

    expect(booted.voiceAvailable).toBe(true)
  })
})

describe('createContainer: a voice message through the worker, with the real encoder', () => {
  const rowOf = (booted: Container, entryId: string) =>
    booted.db
      .prepare<
        [string],
        {
          state: string
          failure: string | null
          duration_ms: number | null
          audio_hash: string | null
          attempts: number
        }
      >(
        `SELECT state, failure, duration_ms, audio_hash, attempts FROM guestbook_voices WHERE entry_id = ?`,
      )
      .get(entryId)

  it('turns a staged WebM into a ready voice with an AAC file behind it, and removes the source', async () => {
    const booted = await boot({ ...WITH_FFMPEG })
    seedEventAndGuest(booted)
    const staged = await booted.usecases.stageGuestbookVoice({
      eventId: EVENT,
      guestId: GUEST,
      file: { bytes: await aWebmRecording() },
    })
    if (!staged.ok) throw new Error(staged.error.code)
    expect((await voiceFiles()).sources).toHaveLength(1)

    const outcome = await booted.clipWorker.runOnce()

    expect(outcome.status === 'completed' && outcome.report.voices).toBe(1)
    const row = rowOf(booted, staged.value.entry.id)
    expect(row?.state).toBe('ready')
    // Two seconds were recorded, and the duration is the one measured on the file written.
    expect(row?.duration_ms).toBeGreaterThan(1_800)
    expect(row?.duration_ms).toBeLessThan(2_300)
    const { sources, outputs } = await voiceFiles()
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toContain(`${row?.audio_hash ?? '?'}.m4a`)
    expect((await stat(outputs[0] ?? '')).size).toBeGreaterThan(0)
    expect(sources).toEqual([])
  })

  it('bounds a long recording at MAX_VOICE_SECONDS, whatever the file says: it declares nothing', async () => {
    const booted = await boot({ ...WITH_FFMPEG, MAX_VOICE_SECONDS: '10' })
    seedEventAndGuest(booted)
    const staged = await booted.usecases.stageGuestbookVoice({
      eventId: EVENT,
      guestId: GUEST,
      file: { bytes: await aWebmRecording(30) },
    })
    if (!staged.ok) throw new Error(staged.error.code)

    await booted.clipWorker.runOnce()

    const row = rowOf(booted, staged.value.entry.id)
    expect(row?.state).toBe('ready')
    expect(row?.duration_ms).toBeGreaterThan(9_500)
    expect(row?.duration_ms).toBeLessThan(10_300)
  })

  it('recovers a voice a dead process left running when the worker starts, and takes it up again', async () => {
    const booted = await boot({ ...WITH_FFMPEG })
    seedEventAndGuest(booted)
    const at = new Date().toISOString()
    booted.db
      .prepare(
        `INSERT INTO guestbook_entries (id, event_id, guest_id, body, status, created_at)
         VALUES ('voice-1', 'event-1', 'guest-lea', '', 'pending', ?)`,
      )
      .run(at)
    booted.db
      .prepare(
        `INSERT INTO guestbook_voices (entry_id, event_id, state, source_hash, source_byte_size,
                                       attempts, queued_at, started_at)
         VALUES ('voice-1', 'event-1', 'running', ?, 1000, 1, ?, ?)`,
      )
      .run('a'.repeat(64), at, at)

    booted.clipWorker.start()

    // Recovered, then claimed again (a second attempt): it has no source on this disk, so it goes
    // back to the queue with a backoff. Left `running`, it would never be claimed and stay at one.
    await vi.waitFor(() => expect(rowOf(booted, 'voice-1')?.attempts).toBe(2), { timeout: 5_000 })
    expect(rowOf(booted, 'voice-1')?.state).toBe('queued')
  })

  it('refuses a video sent as a voice message, for good, and leaves no file behind', async () => {
    const booted = await boot({ ...WITH_FFMPEG })
    seedEventAndGuest(booted)
    const staged = await booted.usecases.stageGuestbookVoice({
      eventId: EVENT,
      guestId: GUEST,
      file: { bytes: await aVideo() },
    })
    if (!staged.ok) throw new Error(staged.error.code)

    await booted.clipWorker.runOnce()

    expect(rowOf(booted, staged.value.entry.id)).toMatchObject({
      state: 'failed',
      failure: 'notAudio',
    })
    expect(await voiceFiles()).toEqual({ sources: [], outputs: [] })
  })
})
