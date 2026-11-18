import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from '../interface/http/testing/request'
import { afterEach, describe, expect, it } from 'vitest'
import { anEventSettings } from '../application/testing/builders'
import { ALL_MEDIA_VARIANTS } from '../domain/photos/mediaVariant'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { probeFfmpegCapability } from '../infrastructure/media/ffmpegBinaries'
import { minimalChildEnv, runProcess } from '../infrastructure/media/runProcess'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import { mountedRoutes } from '../interface/http/testing/routeTable'
import { buildServerHarness } from '../interface/http/testing/serverHarness'
import { createContainer, type Container } from './container'

/**
 * **The voice routes through the real composition root** (spec 25, PR 3): the real session, the
 * real use cases, the real SQLite adapters, the real multer and the real encoder behind them.
 *
 * Three things only the container can show. That a recording goes all the way over HTTP (a phone's
 * upload, the worker, a moderator's `Range` request), because the wiring is the one thing the
 * ring-4 suite replaces. That **the table of answers by surface** (spec 25, section 6) holds for a
 * suspended client and for a taken-down event, against what an unknown event answers. And that
 * **no other route serves a voice recording**, however it is asked and by whom: the sweep walks
 * every `GET` route the server mounts and looks for the recording's own bytes in the answers.
 */

const OPERATOR = 'operateur@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'mariage-de-camille'
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NO_SUCH = 'un-mariage-qui-nexiste-pas'

let workDir: string | null = null
let container: Container | null = null

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

// A test file, where `process.env` may be read: the ffmpeg the machine has makes the recordings.
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

const boot = async (): Promise<Container> => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-guestbook-voice-'))
  container = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      // Empty: look for the machine's own ffmpeg, which the recordings below are made with.
      FFMPEG_PATH: '',
      FFPROBE_PATH: '',
      SITE_ADMIN: 'on',
      BOOTSTRAP_OWNER_EMAIL: OPERATOR,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  return container
}

/** A recording as Chrome would send one: Opus in WebM, written live so it declares no duration. */
const aWebmRecording = async (seconds = 2): Promise<Buffer> => {
  const capability = await probeFfmpegCapability({
    search: { path: MACHINE_PATH, extensions: MACHINE_PATHEXT },
    env: MACHINE_ENV,
  })
  if (!capability.available) throw new Error(`this suite needs ffmpeg: ${capability.reason}`)
  const file = join(workDir ?? '', 'recording.webm')
  const made = await runProcess({
    binary: capability.paths.ffmpeg,
    args: [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
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
      file,
    ],
    env: MACHINE_ENV,
    timeoutMs: 60_000,
    stallMs: 30_000,
  })
  if (!made.ok) throw new Error(`could not generate the recording: ${made.stderr}`)
  return readFile(file)
}

const csrfOf = (headers: Record<string, unknown>): string | undefined => {
  const raw = headers['set-cookie']
  const cookies = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []
  const found = cookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`))
  return found === undefined
    ? undefined
    : decodeURIComponent(found.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
}

const filesUnder = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)],
    ),
  )
  return nested.flat()
}

/** What a response carries when the bytes are what is being asked about. */
const binary = (res: request.Response, done: (error: Error | null, body: Buffer) => void): void => {
  const chunks: Buffer[] = []
  res.on('data', (chunk: Buffer) => chunks.push(chunk))
  res.on('end', () => done(null, Buffer.concat(chunks)))
}

/** A browser: one cookie jar, the CSRF token it was last handed. */
const aBrowser = async (booted: Container) => {
  const agent = request.agent(booted.app)
  let csrf = csrfOf((await agent.get('/api/auth/me')).headers) ?? ''
  const note = (response: request.Response): request.Response => {
    csrf = csrfOf(response.headers) ?? csrf
    return response
  }
  return {
    agent,
    get: async (path: string) => note(await agent.get(path)),
    /** The raw bytes of an answer, whatever its type: a JSON error comes back as text bytes. */
    getBytes: async (path: string, headers: Record<string, string> = {}) => {
      let call = agent.get(path)
      for (const [name, value] of Object.entries(headers)) call = call.set(name, value)
      return note(await call.buffer(true).parse(binary))
    },
    post: async (path: string, body: object = {}) =>
      note(await agent.post(path).set(CSRF_HEADER, csrf).send(body)),
    patch: async (path: string, body: object = {}) =>
      note(await agent.patch(path).set(CSRF_HEADER, csrf).send(body)),
    delete: async (path: string) => note(await agent.delete(path).set(CSRF_HEADER, csrf)),
    sendVoice: async (path: string, bytes: Buffer, name = 'voice.webm') =>
      note(await agent.post(path).set(CSRF_HEADER, csrf).attach('voice', bytes, name)),
  }
}

type Browser = Awaited<ReturnType<typeof aBrowser>>

const answer = (response: request.Response) => ({
  status: response.status,
  body: response.body as unknown,
  cacheControl: response.headers['cache-control'],
})

const scene = async () => {
  const booted = await boot()
  booted.db.prepare('UPDATE users SET must_change_password = 0').run()
  const operatorRow = booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
    .get(OPERATOR)
  const operatorId = operatorRow?.id ?? ''
  const at = new Date().toISOString()
  booted.db
    .prepare('INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)')
    .run(CLIENT, 'Atelier Camille', at)

  const created = await booted.usecases.createEvent({
    ownerId: asUserId(operatorId),
    name: 'Mariage de Camille',
    slug: SLUG,
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
  const settings = JSON.stringify(
    anEventSettings({ allowGuestbook: true, guestbookVoice: { enabled: true } }).toProps(),
  )
  booted.db
    .prepare(
      `UPDATE events SET client_id = ?, status = 'live', opened_at = ?, settings = ? WHERE id = ?`,
    )
    .run(CLIENT, at, settings, created.value.id)

  const guest = await aBrowser(booted)
  const joined = await guest.post('/api/join', {
    joinCode: created.value.joinCode.value,
    displayName: 'Léa',
  })
  expect(joined.status, JSON.stringify(joined.body)).toBe(200)

  const operator = await aBrowser(booted)
  const login = await operator.post('/api/auth/login', { email: OPERATOR, password: PASSWORD })
  expect(login.status, JSON.stringify(login.body)).toBeLessThan(300)
  const confirmed = await operator.post('/api/auth/step-up', { password: PASSWORD })
  expect(confirmed.status).toBeLessThan(300)

  const stranger = await aBrowser(booted)
  return { booted, eventId: created.value.id as string, guest, operator, stranger }
}

type Scene = Awaited<ReturnType<typeof scene>>

const VOICE = `/api/events/${SLUG}/guestbook/voice`

/** The guest sends a real recording, the worker makes it ready: what a listener is served. */
const aReadyVoice = async (s: Scene): Promise<string> => {
  const sent = await s.guest.sendVoice(VOICE, await aWebmRecording())
  expect(sent.status, JSON.stringify(sent.body)).toBe(202)
  await s.booted.clipWorker.runOnce()
  return (sent.body as { entry: { id: string } }).entry.id
}

describe('a voice message over HTTP, through the real composition root', () => {
  it('goes from the phone’s upload to the moderator’s ears: 202, the worker, then a ranged 206 of real AAC', async () => {
    const s = await scene()

    const entryId = await aReadyVoice(s)

    const queue = await s.operator.get(`/api/events/${SLUG}/guestbook`)
    expect(queue.status).toBe(200)
    expect(queue.body.items).toHaveLength(1)
    expect(queue.body.items[0]).toMatchObject({
      id: entryId,
      text: null,
      voice: { state: 'ready' },
      allowedDecisions: ['publish', 'reject'],
    })
    expect(queue.body.items[0].voice.durationMs).toBeGreaterThan(1_800)
    expect(queue.body.voiceProcessing).toBe(0)

    const whole = await s.operator.getBytes(`/api/events/${SLUG}/guestbook/${entryId}/voice`)
    expect(whole.status).toBe(200)
    expect(whole.headers['content-type']).toBe('audio/mp4')
    expect(whole.headers['x-content-type-options']).toBe('nosniff')
    expect(whole.headers['accept-ranges']).toBe('bytes')
    // An MP4 container: `ftyp` at offset 4, which is what the encoder wrote and the phone never did.
    expect((whole.body as Buffer).subarray(4, 8).toString('latin1')).toBe('ftyp')

    const part = await s.operator.getBytes(`/api/events/${SLUG}/guestbook/${entryId}/voice`, {
      Range: 'bytes=0-15',
    })
    expect(part.status).toBe(206)
    expect((part.body as Buffer).length).toBe(16)
    expect(part.headers['content-range']).toMatch(
      new RegExp(`^bytes 0-15/${(whole.body as Buffer).length}$`),
    )
  })

  it('lets the guest read their own recording’s state, and never listen to it', async () => {
    const s = await scene()
    const entryId = await aReadyVoice(s)

    const mine = await s.guest.get(`/api/events/${SLUG}/guestbook/mine`)
    const listening = await s.guest.getBytes(`/api/events/${SLUG}/guestbook/${entryId}/voice`)

    expect(mine.body.items[0]).toMatchObject({ id: entryId, voice: { state: 'ready' } })
    expect(mine.body.voiceAvailable).toBe(true)
    expect(listening.status).toBe(401)
  })

  it('keeps a sealed recording secret from everyone until the owner opens it, and not before', async () => {
    const s = await scene()
    const entryId = await aReadyVoice(s)
    s.booted.db.prepare('UPDATE events SET settings = ? WHERE id = ?').run(
      JSON.stringify(
        anEventSettings({
          allowGuestbook: true,
          guestbookVoice: { enabled: true, sealed: true },
        }).toProps(),
      ),
      s.eventId,
    )
    const url = `/api/events/${SLUG}/guestbook/${entryId}/voice`

    const before = await s.operator.get(url)
    const opened = await s.operator.post(`${VOICE}/open`)
    const after = await s.operator.getBytes(url)

    expect([before.status, before.body.error?.code]).toEqual([403, 'guestbook.voiceSealed'])
    expect(opened.status).toBe(200)
    expect(after.status).toBe(200)
    expect(after.headers['content-type']).toBe('audio/mp4')
  })
})

describe('the guest’s budget, as the server wires it', () => {
  it('is one budget for the written messages and the voice route: six requests of one kind leave the other none', async () => {
    const s = await scene()
    // Six requests, whatever they were answered: the budget counts the attempt, and the ceiling of
    // three messages answers the fourth to the sixth with a 409 that has already spent it.
    const answers: number[] = []
    for (let word = 1; word <= 6; word += 1) {
      answers.push(
        (await s.guest.post(`/api/events/${SLUG}/guestbook`, { text: `mot ${word}` })).status,
      )
    }
    expect(answers.slice(0, 3)).toEqual([201, 201, 201])
    expect(answers.every((status) => status !== 429)).toBe(true)

    const refused = await s.guest.sendVoice(VOICE, await aWebmRecording(1))

    expect([refused.status, refused.body.error?.code]).toEqual([429, 'rate.limited'])
  })
})

describe('the answers by surface (spec 25, section 6)', () => {
  /** What each guest surface answers once the client is suspended, against an unknown event. */
  it('answers a suspended client’s guest 404 event.notFound on the voice upload and on “mine”, as an unknown event does', async () => {
    const s = await scene()
    await aReadyVoice(s)
    expect((await s.operator.post(`/api/site/clients/${CLIENT}/suspend`)).status).toBe(204)

    const suspendedUpload = await s.guest.sendVoice(VOICE, await aWebmRecording(1))
    const unknownUpload = await s.guest.sendVoice(
      `/api/events/${NO_SUCH}/guestbook/voice`,
      await aWebmRecording(1),
    )
    const suspendedMine = await s.guest.get(`/api/events/${SLUG}/guestbook/mine`)
    const unknownMine = await s.guest.get(`/api/events/${NO_SUCH}/guestbook/mine`)

    expect(answer(suspendedUpload)).toEqual(answer(unknownUpload))
    expect(answer(suspendedMine)).toEqual(answer(unknownMine))
    expect([suspendedUpload.status, suspendedUpload.body.error.code]).toEqual([
      404,
      'event.notFound',
    ])
    expect(JSON.stringify([suspendedUpload.body, suspendedMine.body])).not.toContain('suspended')
  })

  it('answers a suspended client’s members 403 client.suspended on the listening, the book, the opening and the bulk keep', async () => {
    const s = await scene()
    const entryId = await aReadyVoice(s)
    expect((await s.operator.post(`/api/site/clients/${CLIENT}/suspend`)).status).toBe(204)

    const answers = [
      await s.operator.get(`/api/events/${SLUG}/guestbook/${entryId}/voice`),
      await s.operator.get(`/api/events/${SLUG}/guestbook`),
      await s.operator.post(`${VOICE}/open`),
      await s.operator.post(`${VOICE}/keep-pending`),
    ].map((response) => [response.status, response.body.error?.code])

    expect(answers).toEqual(Array(4).fill([403, 'client.suspended']))
  })

  it('answers every surface 404 event.notFound once the operator took the event down, members and guests alike', async () => {
    const s = await scene()
    const entryId = await aReadyVoice(s)
    s.booted.db
      .prepare('UPDATE events SET taken_down_at = ? WHERE id = ?')
      .run(new Date().toISOString(), s.eventId)

    const answers = [
      await s.operator.get(`/api/events/${SLUG}/guestbook/${entryId}/voice`),
      await s.operator.get(`/api/events/${SLUG}/guestbook`),
      await s.operator.post(`${VOICE}/open`),
      await s.operator.post(`${VOICE}/keep-pending`),
      await s.guest.sendVoice(VOICE, await aWebmRecording(1)),
      await s.guest.get(`/api/events/${SLUG}/guestbook/mine`),
    ].map((response) => [response.status, response.body.error?.code])

    expect(answers).toEqual(Array(6).fill([404, 'event.notFound']))
  })
})

describe('no other route serves a voice recording', () => {
  /** The paths of every `GET` route the routers mount, without the web client that needs a build. */
  const getRoutes = (): readonly string[] =>
    mountedRoutes(buildServerHarness().app)
      .filter((route) => route.method.toLowerCase() === 'get')
      .map((route) => (route.path.startsWith('/api') ? route.path : `/api${route.path}`))
      // A stream never ends, and a stream carries signals, never bytes.
      .filter((path) => !path.endsWith('/stream'))

  const VOICE_ROUTE = '/api/events/:eventSlug/guestbook/:entryId/voice'

  /** Every way a parameter can be filled that could lead to the recording. */
  const fill = (
    path: string,
    ids: { readonly entry: string; readonly photo: string; readonly variant: string },
  ): string =>
    path
      .replace(':eventSlug', SLUG)
      .replace(':variant', ids.variant)
      .replace(':entryId', ids.entry)
      .replace(':photoId', ids.photo)
      .replace(/:[a-zA-Z]+/g, ids.entry)

  it('looks for the recording’s own bytes in the answer of every GET route, as the owner, a guest and a stranger', async () => {
    const s = await scene()
    const entryId = await aReadyVoice(s)
    const row = s.booted.db
      .prepare<[string], { readonly audio_hash: string }>(
        'SELECT audio_hash FROM guestbook_voices WHERE entry_id = ?',
      )
      .get(entryId)
    const hash = row?.audio_hash ?? ''
    const file = (await filesUnder(join(workDir ?? '', 'media', s.eventId))).find((path) =>
      path.endsWith(`${hash}.m4a`),
    )
    const stored = await readFile(file ?? '')
    // A slice from the middle: a header can match by chance, forty bytes of AAC cannot.
    const marker = stored.subarray(stored.length >> 1, (stored.length >> 1) + 40)
    expect(marker.length).toBe(40)

    // The attack the variant's place outside the served ones prevents: a photograph that names the
    // voice's own digest, so the photo route would find a file under it if 'voice' were served.
    const photoId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const guestRow = s.booted.db
      .prepare<[], { readonly id: string }>('SELECT id FROM guests LIMIT 1')
      .get()
    s.booted.db
      .prepare(
        `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash,
                             width, height, byte_size, created_at)
         VALUES (?, ?, ?, 'published', ?, 100, 100, 1234, ?)`,
      )
      .run(photoId, s.eventId, guestRow?.id ?? '', hash, new Date().toISOString())

    const viewers: readonly (readonly [string, Browser])[] = [
      ['the owner', s.operator],
      ['a guest', s.guest],
      ['a stranger', s.stranger],
    ]
    const served: string[] = []
    let asked = 0
    for (const path of getRoutes()) {
      for (const variant of ALL_MEDIA_VARIANTS) {
        const url = fill(path, { entry: entryId, photo: photoId, variant })
        for (const [who, browser] of viewers) {
          const response = await browser.getBytes(url)
          asked += 1
          const body = response.body as Buffer
          const carriesIt =
            response.headers['content-type'] === 'audio/mp4' ||
            (Buffer.isBuffer(body) && body.includes(marker))
          if (carriesIt) served.push(`${who} ${path} (${variant})`)
        }
        // Only a route with a variant in its path varies with it.
        if (!path.includes(':variant')) break
      }
    }

    expect(asked).toBeGreaterThan(100)
    // The one door: the owner, on the guestbook's own voice route, and nobody else anywhere.
    expect([...new Set(served)]).toEqual([`the owner ${VOICE_ROUTE} (${ALL_MEDIA_VARIANTS[0]})`])
  })
})

describe('the life of a recording after the evening (spec 25, section 10)', () => {
  /** Every file the media root holds for the event: what the purge and the erasure must reach. */
  const mediaOf = async (s: Scene): Promise<string[]> =>
    filesUnder(join(workDir ?? '', 'media', s.eventId))

  const closeLongAgo = (s: Scene, days: number, retention = 30): void => {
    const closed = new Date(Date.now() - days * 86_400_000).toISOString()
    s.booted.db
      .prepare(`UPDATE events SET status = 'closed', closed_at = ?, settings = ? WHERE id = ?`)
      .run(
        closed,
        JSON.stringify(
          anEventSettings({
            allowGuestbook: true,
            guestbookVoice: { enabled: true },
            retentionDays: retention,
          }).toProps(),
        ),
        s.eventId,
      )
  }

  const voiceRows = (s: Scene): number =>
    s.booted.db
      .prepare<[], { readonly n: number }>('SELECT COUNT(*) AS n FROM guestbook_voices')
      .get()?.n ?? 0

  it('removes the event’s whole folder with the recordings in it when the retention has run out', async () => {
    const s = await scene()
    await aReadyVoice(s)
    expect((await mediaOf(s)).some((path) => path.endsWith('.m4a'))).toBe(true)
    closeLongAgo(s, 40)

    const report = await s.booted.usecases.purgeExpiredEvents()

    expect(report.purged).toEqual([s.eventId])
    expect(await mediaOf(s)).toEqual([])
    expect(voiceRows(s)).toBe(0)
  })

  it('leaves the recordings alone while the retention has not run out', async () => {
    const s = await scene()
    await aReadyVoice(s)
    closeLongAgo(s, 5)

    const report = await s.booted.usecases.purgeExpiredEvents()

    expect(report.purged).toEqual([])
    expect((await mediaOf(s)).some((path) => path.endsWith('.m4a'))).toBe(true)
    expect(voiceRows(s)).toBe(1)
  })

  it('leaves the recordings alone under the operator’s hold on the purge, whatever the date says', async () => {
    const s = await scene()
    await aReadyVoice(s)
    closeLongAgo(s, 40)
    s.booted.db
      .prepare('UPDATE events SET purge_held_at = ? WHERE id = ?')
      .run(new Date().toISOString(), s.eventId)

    const report = await s.booted.usecases.purgeExpiredEvents()

    expect(report.purged).toEqual([])
    expect((await mediaOf(s)).some((path) => path.endsWith('.m4a'))).toBe(true)
  })

  it('takes the recording off the disk when its guest erases everything they sent, and the row with it', async () => {
    const s = await scene()
    await aReadyVoice(s)

    const erased = await s.guest.delete(`/api/events/${SLUG}/guests/me`)

    expect(erased.status).toBe(200)
    expect(erased.body).toMatchObject({ messages: 1 })
    expect(await mediaOf(s)).toEqual([])
    expect(voiceRows(s)).toBe(0)
  })

  it('takes the recording off the disk when its guest takes the one message back inside the grace window', async () => {
    const s = await scene()
    const entryId = await aReadyVoice(s)

    const removed = await s.guest.delete(`/api/events/${SLUG}/guestbook/${entryId}`)

    expect(removed.status).toBe(204)
    expect(await mediaOf(s)).toEqual([])
    expect(voiceRows(s)).toBe(0)
  })

  it('keeps the bytes of a recording the operator took down, through its guest’s erasure: they are evidence', async () => {
    const s = await scene()
    const entryId = await aReadyVoice(s)
    const down = await s.operator.post(`/api/site/guestbook-entries/${entryId}/take-down`, {
      reason: 'Signalement reçu, retrait conservatoire',
    })
    expect(down.status, JSON.stringify(down.body)).toBeLessThan(300)

    await s.guest.delete(`/api/events/${SLUG}/guests/me`)

    expect((await mediaOf(s)).some((path) => path.endsWith('.m4a'))).toBe(true)
    expect(voiceRows(s)).toBe(1)
  })
})

describe('the host’s ZIP and the recordings (spec 25, section 8)', () => {
  /** The names a ZIP lists in its central directory, read by hand. */
  const entryNamesOf = (zip: Buffer): readonly string[] => {
    const end = zip.length - 22
    const count = zip.readUInt16LE(end + 10)
    let at = zip.readUInt32LE(end + 16)
    const names: string[] = []
    for (let n = 0; n < count; n += 1) {
      const nameLength = zip.readUInt16LE(at + 28)
      const extraLength = zip.readUInt16LE(at + 30)
      const commentLength = zip.readUInt16LE(at + 32)
      names.push(zip.toString('utf8', at + 46, at + 46 + nameLength))
      at += 46 + nameLength + extraLength + commentLength
    }
    return names
  }

  const album = async (s: Scene): Promise<Buffer> => {
    const response = await s.operator.getBytes(`/api/events/${SLUG}/album.zip`)
    expect(response.status).toBe(200)
    return response.body as Buffer
  }

  const sealed = (s: Scene): void => {
    s.booted.db.prepare('UPDATE events SET settings = ? WHERE id = ?').run(
      JSON.stringify(
        anEventSettings({
          allowGuestbook: true,
          guestbookVoice: { enabled: true, sealed: true },
        }).toProps(),
      ),
      s.eventId,
    )
  }

  const publish = async (s: Scene, entryId: string): Promise<void> => {
    const decided = await s.operator.patch(`/api/events/${SLUG}/guestbook/${entryId}/status`, {
      decision: 'publish',
    })
    expect(decided.status, JSON.stringify(decided.body)).toBe(204)
  }

  const voiceNames = (zip: Buffer): readonly string[] =>
    entryNamesOf(zip).filter((name) => name.includes('/voice/'))

  it('carries a published recording as an .m4a listed in the manifest with the digest of the file on the disk, and a line in guestbook.txt', async () => {
    const s = await scene()
    const entryId = await aReadyVoice(s)
    await publish(s, entryId)
    const row = s.booted.db
      .prepare<[string], { readonly audio_hash: string }>(
        'SELECT audio_hash FROM guestbook_voices WHERE entry_id = ?',
      )
      .get(entryId)
    const file = (await filesUnder(join(workDir ?? '', 'media', s.eventId))).find((path) =>
      path.endsWith('.m4a'),
    )
    const stored = await readFile(file ?? '')

    const zip = await album(s)

    expect(voiceNames(zip)).toHaveLength(1)
    expect(voiceNames(zip)[0]).toMatch(new RegExp(`^${SLUG}/voice/0001-[0-9a-f]{12}\\.m4a$`))
    expect(voiceNames(zip)[0]).toContain((row?.audio_hash ?? '').slice(0, 12))
    // The ZIP is stored, not deflated: the recording's own bytes and the book's own text are in it.
    expect(zip.includes(stored)).toBe(true)
    const text = zip.toString('latin1')
    expect(text).toContain(`${createHash('sha256').update(stored).digest('hex')}  voice/0001-`)
    expect(text).toMatch(/\[message vocal, 0:0\d, voice\/0001-[0-9a-f]{12}\.m4a\]/)
  })

  it('leaves out a recording that was not published, which only the host’s decision brings in', async () => {
    const s = await scene()
    await aReadyVoice(s)

    expect(voiceNames(await album(s))).toEqual([])
  })

  it('keeps a secret recording out of the ZIP, says how many are left out, and brings it in once the owner opens it', async () => {
    const s = await scene()
    const entryId = await aReadyVoice(s)
    await publish(s, entryId)
    sealed(s)

    const before = await album(s)
    const opened = await s.operator.post(`${VOICE}/open`)
    const after = await album(s)

    expect(voiceNames(before)).toEqual([])
    expect(before.toString('latin1')).toContain('1 message vocal scell')
    expect(opened.status).toBe(200)
    expect(voiceNames(after)).toHaveLength(1)
    expect(after.toString('latin1')).not.toContain('scell')
  })
})
