import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import Database from 'better-sqlite3'
import type { TestApp } from './startTestApp'

/**
 * What a spec about a client's ceilings (roadmap §10.5) needs and the product cannot yet do
 * for it: make a client.
 *
 * **No route creates a client** — that is G2-14, behind `SITE_ADMIN` — so a client, its roster
 * row and its ceilings are written to the running server's own database, which is the
 * operational path `docs/SECURITY.md` §11 describes today. It is the same narrow exception
 * `tenant-isolation.spec.ts` makes for `enrolInAClient`, and for the same reason: the fact
 * under test (a ceiling) has no other way in. **Everything the specs then assert goes through
 * HTTP**, against the built server; the database is written to arrange a client and to move a
 * stored instant, and read from for nothing at all.
 *
 * Moving a stored instant is how this suite spells a fake clock. The real build has no clock
 * seam — nothing in a booted server lets a test advance time — and adding one to production
 * code for a spec is a worse trade than rewriting `opened_at` and `closed_at` to where they
 * would be had the time gone by: every rule under test reads those two columns and the clock,
 * so "four days have passed" and "the event opened four days ago" are the same state.
 */

/** A JSON object body, narrowed by whoever reads it: this suite never trusts a shape. */
export type Json = Readonly<Record<string, unknown>>

export interface Reply {
  readonly status: number
  readonly body: Json
}

/** Whether a reply is a success. The product answers 200, 201, 202 or 204 as the route says. */
export const succeeded = (reply: Reply): boolean => reply.status >= 200 && reply.status < 300

/** The `code` of a refusal, or `null` when the reply is not one. */
export const codeOf = (reply: Reply): string | null => {
  const error = reply.body['error']
  if (typeof error !== 'object' || error === null) return null
  const code = (error as Json)['code']
  return typeof code === 'string' ? code : null
}

/** The `details` of a refusal. */
export const detailsOf = (reply: Reply): Json => {
  const error = reply.body['error']
  if (typeof error !== 'object' || error === null) return {}
  const details = (error as Json)['details']
  return typeof details === 'object' && details !== null ? (details as Json) : {}
}

/**
 * A cookie jar and a CSRF token over `fetch`, because a spec about ceilings has no use for a
 * browser: every control under test is a refusal the server answers.
 *
 * Double-submit, exactly as a browser does it (`csrfHeaders` in `fixtures/app.ts` is the
 * Playwright flavour): any GET issues `es_csrf`, and every write echoes it.
 */
export interface Session {
  get(path: string): Promise<Reply>
  post(path: string, body?: unknown): Promise<Reply>
  patch(path: string, body: unknown): Promise<Reply>
  delete(path: string): Promise<Reply>
  /** A multipart upload with one part, as the guest's phone sends it. */
  upload(
    path: string,
    field: string,
    file: { name: string; type: string; bytes: Buffer },
  ): Promise<Reply>
}

export const sessionOn = async (baseUrl: string): Promise<Session> => {
  const jar = new Map<string, string>()

  const remember = (response: Response): void => {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0]
      if (pair === undefined) continue
      const at = pair.indexOf('=')
      if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1))
    }
  }

  const cookies = (): string =>
    [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')

  remember(await fetch(`${baseUrl}/api/auth/me`))
  if (jar.get('es_csrf') === undefined) throw new Error('the server issued no CSRF cookie')

  /**
   * The token **as the cookie holds it now**, which is what a browser echoes: the server may
   * issue a fresh pair after a login, and a header frozen at the first value would then
   * disagree with the cookie it is compared to.
   */
  const csrf = (): string => jar.get('es_csrf') ?? ''

  const send = async (method: string, path: string, init: RequestInit = {}): Promise<Reply> => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      method,
      headers: {
        'x-csrf-token': csrf(),
        cookie: cookies(),
        ...(init.headers as Record<string, string> | undefined),
      },
    })
    remember(response)
    const text = await response.text()
    const body: unknown = text.length === 0 ? {} : JSON.parse(text)
    return {
      status: response.status,
      body: (typeof body === 'object' && body !== null ? body : {}) as Json,
    }
  }

  const json = (body: unknown): RequestInit => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  return {
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body === undefined ? {} : json(body)),
    patch: (path, body) => send('PATCH', path, json(body)),
    delete: (path) => send('DELETE', path),
    upload: (path, field, file) => {
      const form = new FormData()
      form.append(field, new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name)
      return send('POST', path, { body: form })
    },
  }
}

/** The ceilings a spec asks a client for, in the product's own words. `null` is "no ceiling". */
export interface Ceilings {
  readonly maxEvents?: number | null
  readonly maxTotalBytes?: number | null
  readonly maxEventQuotaBytes?: number | null
  readonly maxRetentionDays?: number | null
  readonly clipsAllowed?: boolean
  readonly liveAllowed?: boolean
  readonly maxLiveDays?: number | null
  readonly maxEventsPerPeriod?: number | null
  /** An instant: the retention ceiling was lowered then, so its notice runs from there. */
  readonly retentionCapSince?: Date | null
}

const COLUMNS: Readonly<Record<keyof Ceilings, string>> = {
  maxEvents: 'max_events',
  maxTotalBytes: 'max_total_bytes',
  maxEventQuotaBytes: 'max_event_quota_bytes',
  maxRetentionDays: 'max_retention_days',
  clipsAllowed: 'clips_allowed',
  liveAllowed: 'live_allowed',
  maxLiveDays: 'max_live_days',
  maxEventsPerPeriod: 'max_events_per_period',
  retentionCapSince: 'retention_cap_since',
}

const asColumn = (value: number | boolean | Date | null): number | string | null => {
  if (value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString()
  return value
}

/** Opened for one statement and closed again, so nothing holds a file a worker will delete. */
const withDatabase = <T>(app: TestApp, work: (db: Database.Database) => T): T => {
  const db = new Database(app.databasePath, { fileMustExist: true })
  try {
    return work(db)
  } finally {
    db.close()
  }
}

/** Writes ceilings onto an existing client. A spec uses it to tighten one mid-test. */
export const setCeilings = (app: TestApp, clientId: string, ceilings: Ceilings): void => {
  withDatabase(app, (db) => {
    for (const [key, value] of Object.entries(ceilings) as [
      keyof Ceilings,
      number | boolean | Date | null,
    ][]) {
      db.prepare(`UPDATE clients SET ${COLUMNS[key]} = ? WHERE id = ?`).run(
        asColumn(value),
        clientId,
      )
    }
  })
}

/** A signed-in account of the box that is not the operator: it has events of its own, and nothing else. */
export interface Account {
  readonly email: string
  /** Signed in, with the temporary password already rotated. */
  readonly api: Session
}

export interface ClientAccount extends Account {
  readonly clientId: string
}

/**
 * The one event this server's operator invites every account to, made on first use.
 *
 * **One, not one per account, and the reason is the box's own limiter**: an account may create
 * twenty events an hour (`EVENT_CREATION_RATE_LIMIT_PER_HOUR`), and the operator is the account
 * every other spec seeds its events with. An introduction event per client account would spend
 * a dozen of the operator's twenty and fail whichever spec ran next on the same worker with a
 * `429`, nowhere near this file. The accounts made here create their events themselves, which
 * spends **their** allowance and nobody else's.
 */
const introductions = new WeakMap<TestApp, Promise<string>>()

const introductionOf = (app: TestApp): Promise<string> => {
  const known = introductions.get(app)
  if (known !== undefined) return known

  const made = app
    .seedEvent({ name: `Présentation ${randomUUID().slice(0, 8)}` })
    .then(({ slug }) => slug)
  introductions.set(app, made)
  return made
}

/**
 * An account the operator invited to the introduction event, signed in with its own password.
 *
 * It arrives the only way the product can make one today — the operator invites it as a
 * moderator — and what it can then do is create events, which under `EVENT_CREATION=anyAccount`
 * any account may.
 */
const anInvitedAccount = async (app: TestApp, label: string): Promise<Account> => {
  const suffix = randomUUID().slice(0, 8)
  const email = `${label}-${suffix}@eventslide.test`
  const temporary = 'mot-de-passe-provisoire-du-soir'
  const chosen = 'phrase-que-seule-la-cliente-connait'

  // The operator: the account the server bootstrapped, signed in over the API.
  const operator = await sessionOn(app.baseUrl)
  const login = await operator.post('/api/auth/login', {
    email: app.owner.email,
    password: app.owner.password,
  })
  if (!succeeded(login)) throw new Error(`the operator could not sign in: ${login.status}`)

  const invited = await operator.post(`/api/events/${await introductionOf(app)}/moderators`, {
    email,
    temporaryPassword: temporary,
  })
  if (!succeeded(invited)) {
    throw new Error(`inviting the account failed with ${invited.status} ${codeOf(invited) ?? ''}`)
  }

  const api = await sessionOn(app.baseUrl)
  const signedIn = await api.post('/api/auth/login', { email, password: temporary })
  if (!succeeded(signedIn)) throw new Error(`the account could not sign in: ${signedIn.status}`)
  const rotated = await api.post('/api/auth/password', {
    currentPassword: temporary,
    newPassword: chosen,
  })
  if (!succeeded(rotated)) {
    throw new Error(`the account's password rotation failed: ${rotated.status}`)
  }

  return { email, api }
}

/**
 * An account that belongs to no client: what a self-hoster's host is. Its events have no
 * ceilings, which is the control every spec here sets against a client's.
 */
export const aPlainAccount = (app: TestApp): Promise<Account> => anInvitedAccount(app, 'plain')

/**
 * A client of the operator: an account that belongs to a new client with these ceilings.
 *
 * Under `EVENT_CREATION=anyAccount`, which is what the shared server runs, a member of **one**
 * client has its events attached to it without saying so, so the ceilings apply to everything
 * it creates. Nothing here is a shortcut round the code under test: the events are created,
 * opened, uploaded to and deleted through the real routes.
 */
export const aClientAccount = async (
  app: TestApp,
  ceilings: Ceilings = {},
): Promise<ClientAccount> => {
  const account = await anInvitedAccount(app, 'client')

  const clientId = withDatabase(app, (db) => {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(account.email) as
      { readonly id: string } | undefined
    if (user === undefined) throw new Error(`no account to enrol for ${account.email}`)

    const id = randomUUID()
    const at = new Date().toISOString()
    db.prepare('INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)').run(
      id,
      `Atelier ${account.email}`,
      at,
    )
    db.prepare(
      "INSERT INTO client_members (client_id, user_id, role, granted_at) VALUES (?, ?, 'owner', ?)",
    ).run(id, user.id, at)
    return id
  })
  setCeilings(app, clientId, ceilings)

  return { ...account, clientId }
}

/** An event name no other test in the worker has used, because a slug is unique per server. */
export const aName = (label = 'Soirée'): string => `${label} ${randomUUID().slice(0, 8)}`

/** Creates an event as the client, through the API, and answers its slug. */
export const createEvent = async (
  account: Account,
  body: Readonly<Record<string, unknown>> = {},
): Promise<{ readonly reply: Reply; readonly slug: string }> => {
  const reply = await account.api.post('/api/events', { name: aName(), ...body })
  const slug = typeof reply.body['slug'] === 'string' ? reply.body['slug'] : ''
  return { reply, slug }
}

/** Creates an event as the client and opens it. */
export const createLiveEvent = async (
  account: Account,
  body: Readonly<Record<string, unknown>> = {},
): Promise<{ readonly slug: string; readonly joinCode: string }> => {
  const { reply, slug } = await createEvent(account, body)
  if (!succeeded(reply)) throw new Error(`creating the event failed with ${reply.status}`)
  const opened = await account.api.post(`/api/events/${slug}/status`, { status: 'live' })
  if (!succeeded(opened)) throw new Error(`opening the event failed with ${opened.status}`)
  const joinCode = reply.body['joinCode']
  if (typeof joinCode !== 'string') throw new Error('the event carries no join code')
  return { slug, joinCode }
}

/**
 * Moves an event's stored instants, which is how a spec says "this much time has passed" on
 * a build with no clock seam. `*DaysAgo: null` clears the column.
 */
export const rewind = (
  app: TestApp,
  slug: string,
  instants: { readonly openedDaysAgo?: number | null; readonly closedDaysAgo?: number | null },
): void => {
  const daysAgo = (days: number | null): string | null =>
    days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString()

  withDatabase(app, (db) => {
    if (instants.openedDaysAgo !== undefined) {
      db.prepare('UPDATE events SET opened_at = ? WHERE slug = ?').run(
        daysAgo(instants.openedDaysAgo),
        slug,
      )
    }
    if (instants.closedDaysAgo !== undefined) {
      db.prepare('UPDATE events SET closed_at = ? WHERE slug = ?').run(
        daysAgo(instants.closedDaysAgo),
        slug,
      )
    }
  })
}

/** A guest of a live event: joined through the API, holding the device cookie. */
export const aGuestOf = async (app: TestApp, joinCode: string): Promise<Session> => {
  const guest = await sessionOn(app.baseUrl)
  const joined = await guest.post('/api/join', { joinCode })
  if (!succeeded(joined)) throw new Error(`joining failed with ${joined.status}`)
  return guest
}

/** The bytes of a photograph from `fixtures/media.ts`, which writes them to a file. */
export const bytesOfFile = (path: string): Promise<Buffer> => readFile(path)

/** One photograph through the guest's own route: the per-file outcome, or the refusal. */
export const uploadPhoto = (
  guest: Session,
  slug: string,
  bytes: Buffer,
  name = 'photo.jpg',
): Promise<Reply> =>
  guest.upload(`/api/events/${slug}/photos`, 'photos', { name, type: 'image/jpeg', bytes })

/** The one per-file `code` of a single-file upload that was refused, or `null`. */
export const refusalOf = (reply: Reply): string | null => {
  const results = reply.body['results']
  if (!Array.isArray(results)) return codeOf(reply)
  const first = results[0] as Json | undefined
  return first !== undefined && first['status'] === 'rejected' && typeof first['code'] === 'string'
    ? first['code']
    : null
}

/** What the host's dashboard says an event has used, which is what the ceiling is judged on. */
export const usedBytesOf = async (account: Account, slug: string): Promise<number> => {
  const list = await account.api.get('/api/events')
  const items = list.body['items']
  if (!Array.isArray(items)) throw new Error('the dashboard answered no items')
  const row = (items as readonly Json[]).find((item) => item['slug'] === slug)
  const used = row?.['usedBytes']
  if (typeof used !== 'number') throw new Error(`the dashboard has no usedBytes for ${slug}`)
  return used
}

/** Whether the event still exists for the account: a purged one answers 404. */
export const existsFor = async (account: Account, slug: string): Promise<boolean> =>
  (await account.api.get(`/api/events/${slug}`)).status === 200
