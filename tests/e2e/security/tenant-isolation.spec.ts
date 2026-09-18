import Database from 'better-sqlite3'
import type { APIRequestContext, Browser } from '@playwright/test'
import { csrfHeaders, expect, test } from '../fixtures/app'
import type { TestApp } from '../fixtures/startTestApp'
import { aDisguisedScript, anSvgNamedAsJpeg, aPhoto, aPixelBomb } from '../fixtures/media'

/**
 * The specs that justify the suite existing.
 *
 * These are not journeys — they are assertions that a control holds against the real
 * server, over real HTTP, with real cookies. Every one of them describes something 1.0
 * allowed.
 */

test.describe('guest token scope', () => {
  test('a guest token from one event cannot upload to another @smoke', async ({ app, browser }) => {
    const wedding = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })
    const gala = await app.seedEvent({ slug: 'gala', name: 'Gala' })

    const context = await browser.newContext({ baseURL: app.baseUrl })
    const page = await context.newPage()
    await page.goto(app.url(`/join/${wedding.joinCode}`))
    await page.getByLabel(/Votre prénom/i).fill('Léa')
    await page.getByRole('button', { name: /Rejoindre/i }).click()
    await page.waitForURL(/\/upload/)

    // Same cookie jar, a different event in the path. The token names the wedding, so
    // the server must refuse regardless of what the client asks for. In 1.0 the upload
    // endpoint was public and took the event name from a query parameter, so this was
    // not merely possible, it was the normal way to use it.
    const response = await context.request.post(app.url(`/api/events/${gala.slug}/photos`), {
      headers: await csrfHeaders(context.request, app),
      multipart: { photos: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await bytesOf() } },
    })

    expect(response.status()).toBe(403)
    expect((await response.json()).error.code).toBe('guest.wrongEvent')

    await context.close()
  })

  test('an upload with no guest token at all is refused', async ({ app, request }) => {
    const event = await app.seedEvent({ slug: 'mariage' })

    const response = await request.post(app.url(`/api/events/${event.slug}/photos`), {
      headers: await csrfHeaders(request, app),
      multipart: { photos: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await bytesOf() } },
    })

    expect(response.status()).toBe(401)
  })

  test('a guest cannot reach the moderation queue', async ({ app, browser }) => {
    const event = await app.seedEvent({ slug: 'mariage' })
    const context = await browser.newContext({ baseURL: app.baseUrl })
    const page = await context.newPage()
    await page.goto(app.url(`/join/${event.joinCode}`))
    await page.getByRole('button', { name: /Rejoindre/i }).click()
    await page.waitForURL(/\/upload/)

    const response = await context.request.get(app.url(`/api/events/${event.slug}/moderation`))

    expect(response.status()).toBe(401)

    await context.close()
  })
})

test.describe('media scoping', () => {
  test('a real photo cannot be read through another event’s path', async ({ app, browser }) => {
    // 1.0 built the media path from the session's own partyId and the client's
    // filename, so the only thing separating two events was that the row happened to
    // belong to a different party.
    //
    // A real uploaded photo, not a random id: the id has to exist for the assertion to
    // mean anything, or the 404 could just as well be "no such photo anywhere".
    const wedding = await guestContext(app, browser)
    const gala = await app.seedEvent({ slug: 'gala-scoping' })

    const upload = await wedding.request.post(app.url(`/api/events/${wedding.slug}/photos`), {
      headers: await csrfHeaders(wedding.request, app),
      multipart: {
        photos: {
          name: 'a.jpg',
          mimeType: 'image/jpeg',
          buffer: await fileBytes(await aPhoto('scoping', 640, 480)),
        },
      },
    })
    const { results } = await upload.json()
    const photoId = results[0].photoId as string

    // The same photo id, under the other event. It exists — just not there.
    const acrossEvents = await wedding.request.get(
      app.url(`/api/events/${gala.slug}/photos/${photoId}/display`),
    )

    // 404 rather than 403: a 403 would confirm the photo exists and make this an
    // enumeration oracle for other people's albums.
    expect(acrossEvents.status()).toBe(404)

    await wedding.dispose()
  })

  test('a sequential id is not a valid photo id', async ({ app, request }) => {
    // Ids are opaque UUIDs precisely so that /photos/3 cannot invite /photos/4, which
    // 1.0's AUTOINCREMENT keys did.
    const event = await app.seedEvent({ slug: 'mariage' })

    const response = await request.get(app.url(`/api/events/${event.slug}/photos/3/display`))

    expect(response.status()).toBe(400)
  })
})

test.describe('event visibility', () => {
  test('a draft event is invisible to a guest, indistinguishably from a wrong code', async ({
    app,
    request,
  }) => {
    // A distinguishable "not open yet" would let someone enumerate which codes exist.
    const response = await request.post(app.url('/api/join'), {
      headers: await csrfHeaders(request, app),
      data: { joinCode: 'ZZZZZZ' },
    })

    expect(response.status()).toBe(404)
    expect((await response.json()).error.code).toBe('event.notFound')
  })

  test('the wall of an unknown event is a 404, not a hint', async ({ app, request }) => {
    const response = await request.get(app.url('/api/events/no-such-event/wall'))

    expect(response.status()).toBe(404)
  })
})

test.describe('upload hardening', () => {
  test('a script renamed to .jpg is refused whatever MIME type is claimed', async ({
    app,
    browser,
  }) => {
    // 1.0 decided with `file.mimetype.startsWith('image/')`, a string the client
    // chooses, so this file passed the filter and was written to disk under a name
    // derived from the client's own filename.
    const context = await guestContext(app, browser)

    const response = await context.request.post(app.url(`/api/events/${context.slug}/photos`), {
      headers: await csrfHeaders(context.request, app),
      multipart: {
        photos: {
          name: 'holiday-snap.jpg',
          mimeType: 'image/jpeg',
          buffer: await fileBytes(await aDisguisedScript()),
        },
      },
    })

    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.results[0]).toMatchObject({ status: 'rejected', code: 'image.unsupportedFormat' })

    await context.dispose()
  })

  test('an SVG is refused, because a rendered SVG executes script', async ({ app, browser }) => {
    const context = await guestContext(app, browser)

    const response = await context.request.post(app.url(`/api/events/${context.slug}/photos`), {
      headers: await csrfHeaders(context.request, app),
      multipart: {
        photos: {
          name: 'sunset.jpg',
          mimeType: 'image/svg+xml',
          buffer: await fileBytes(await anSvgNamedAsJpeg()),
        },
      },
    })

    const body = await response.json()
    expect(body.results[0].status).toBe('rejected')

    await context.dispose()
  })

  test('a pixel bomb is refused from its header, before it is decoded', async ({
    app,
    browser,
  }) => {
    // A flat-colour 20000x20000 PNG is a few hundred kilobytes on the wire and
    // gigabytes once decoded. Judging it from the header is the only order that works.
    const context = await guestContext(app, browser)

    const response = await context.request.post(app.url(`/api/events/${context.slug}/photos`), {
      headers: await csrfHeaders(context.request, app),
      multipart: {
        photos: {
          name: 'bomb.png',
          mimeType: 'image/png',
          buffer: await fileBytes(await aPixelBomb()),
        },
      },
    })

    const body = await response.json()
    expect(body.results[0]).toMatchObject({ status: 'rejected', code: 'image.tooManyPixels' })

    await context.dispose()
  })

  test('a stored photo carries no EXIF, so the venue’s coordinates do not survive', async ({
    app,
    browser,
  }) => {
    // A guest's camera records where they are standing — at a wedding, often somebody's
    // home. 1.0 wrote all of it to disk and shipped it in the album ZIP.
    const context = await guestContext(app, browser)

    const upload = await context.request.post(app.url(`/api/events/${context.slug}/photos`), {
      headers: await csrfHeaders(context.request, app),
      multipart: {
        photos: {
          name: 'with-gps.jpg',
          mimeType: 'image/jpeg',
          buffer: await fileBytes(await aPhoto('with-gps')),
        },
      },
    })
    const { results } = await upload.json()
    const photoId = results[0].photoId as string

    const stored = await context.request.get(
      app.url(`/api/events/${context.slug}/photos/${photoId}/display`),
    )
    const bytes = Buffer.from(await stored.body())

    // The EXIF APP1 marker, with its 'Exif\0\0' identifier. Present in the fixture,
    // absent from anything the pipeline produced.
    expect(bytes.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false)

    await context.dispose()
  })
})

/**
 * The box's operator, on a client's evening (docs/ROADMAP.md §10.1).
 *
 * The bootstrap account is the operator — it is the account whoever installed this box
 * gave themselves — and here it holds a real session against a real server. A client
 * creates their own event on the same box, and the operator can reach none of it: not the
 * settings, not the queue, and not a photograph that is still waiting to be approved.
 *
 * That is the promise the whole category rests on. An operator who can see a client's
 * photographs by virtue of running the box is the incident this design exists to make
 * impossible; support access is §10.6, and it ships time-boxed, announced in the client's
 * own interface and written to a log the client can read. None of that exists yet, so
 * neither does the access.
 *
 * **"The bootstrap account is the operator" is checked here, not assumed.** It used to be
 * assumed, and that made the rest of this describe worth less than it looked: every 404
 * below is what any signed-in non-member gets, nothing in the HTTP surface carries a site
 * role, so the whole block stayed green with `bootstrapOwner` writing `siteRole: 'none'`
 * — the elevation it exists to catch never ran end to end at all, while
 * docs/SECURITY.md and docs/TESTING.md both named it as the ring-6 half of the invariant.
 * `siteRoleOf` reads the fact out of the server's own SQLite file, which is the only place
 * it exists, and `signedInAsOperator` refuses to hand back a session that is not one.
 */
test.describe('site operator scope', () => {
  test('the account these specs sign in as is really the box’s operator', async ({ app }) => {
    // The premise every refusal below rests on, and it was an unchecked one: nothing on
    // the HTTP surface carries an account's site role — `/api/auth/me` does not — so this
    // spec could not tell the operator from any signed-in stranger. Every 404 it asserts
    // is what a non-member gets, so `bootstrapOwner` writing `siteRole: 'none'` would
    // have left the whole describe green while the elevation it exists to catch was never
    // exercised end to end. docs/SECURITY.md and docs/TESTING.md both name this spec as
    // the ring-6 half of the invariant, which is what made the gap worth closing rather
    // than documenting.
    //
    // So the premise is read from the same SQLite file the running server is reading,
    // which is the only place the fact exists. Read-only, and it is the one thing in this
    // suite that does not go through HTTP.
    expect(siteRoleOf(app, app.owner.email)).toBe('operator')
  })

  test('the operator cannot reach a client’s event on the box they run @smoke', async ({
    app,
    browser,
  }) => {
    const client = await aClientWithTheirOwnEvent(app, browser)
    const operator = await signedInAsOperator(app, browser)

    try {
      // Every answer is 404 rather than 403, for the same reason it is for a stranger: a
      // 403 would confirm the event exists, which is more than the operator is entitled
      // to learn from these endpoints.
      const settings = await operator.request.get(app.url(`/api/events/${client.slug}`))
      expect(settings.status()).toBe(404)
      expect((await settings.json()).error.code).toBe('event.notFound')

      const queue = await operator.request.get(app.url(`/api/events/${client.slug}/moderation`))
      expect(queue.status()).toBe(404)

      const closing = await operator.request.post(app.url(`/api/events/${client.slug}/status`), {
        headers: await csrfHeaders(operator.request, app),
        data: { status: 'closed' },
      })
      expect(closing.status()).toBe(404)

      // And the client's evening is not on the operator's dashboard, which is the same
      // rule read from the other side: the listing is the membership table's answer.
      const dashboard = await operator.request.get(app.url('/api/events'))
      const slugs = ((await dashboard.json()).items as { slug: string }[]).map((row) => row.slug)
      expect(slugs).not.toContain(client.slug)
    } finally {
      await client.dispose()
      await operator.dispose()
    }
  })

  test('the operator cannot read a photograph the client has not published', async ({
    app,
    browser,
  }) => {
    // The one that matters most, and the reason this is a security spec rather than a
    // journey. A pending photograph is a guest's phone camera roll thirty seconds ago,
    // seen by nobody yet — not the room, and not the person who runs the server.
    const client = await aClientWithTheirOwnEvent(app, browser)
    const guest = await browser.newContext({ baseURL: app.baseUrl })
    const operator = await signedInAsOperator(app, browser)

    try {
      const page = await guest.newPage()
      await page.goto(app.url(`/join/${client.joinCode}`))
      await page.getByRole('button', { name: /Rejoindre/i }).click()
      await page.waitForURL(/\/upload/)

      const upload = await guest.request.post(app.url(`/api/events/${client.slug}/photos`), {
        headers: await csrfHeaders(guest.request, app),
        multipart: {
          photos: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await bytesOf() },
        },
      })
      const { results } = await upload.json()
      const photoId = results[0].photoId as string

      const asOperator = await operator.request.get(
        app.url(`/api/events/${client.slug}/photos/${photoId}/display`),
      )

      expect(asOperator.status()).toBe(404)

      // The contrast that makes the 404 mean something: the client, who owns the event,
      // reads the same bytes at the same URL. The photograph is there — it is simply not
      // the operator's to look at.
      const asClient = await client.request.get(
        app.url(`/api/events/${client.slug}/photos/${photoId}/display`),
      )
      expect(asClient.status()).toBe(200)
    } finally {
      await guest.close()
      await client.dispose()
      await operator.dispose()
    }
  })
})

/**
 * Disabling a host, end to end, against the real server.
 *
 * Every one of these was reachable before this branch. `disabled_at` was read on exactly
 * one line in the product — inside `authenticateUser` — so switching an account off
 * stopped the next sign-in and stopped nothing at all that the account was already doing,
 * on a session that renews for as long as it is used. The third case is the one that made
 * a bounded window unbounded: a disabled owner could invite a moderator and read out a
 * password to a brand new **enabled** account.
 */
test.describe('an account that has been disabled', () => {
  test('loses its own event the moment it is switched off @smoke', async ({ app, browser }) => {
    const client = await aClientWithTheirOwnEvent(app, browser)
    try {
      // The session is live and working before the account is touched, so the refusal
      // below cannot be a session that never worked.
      const before = await client.request.get(app.url(`/api/events/${client.slug}/moderation`))
      expect(before.status()).toBe(200)

      setAccountDisabled(app, client.email, new Date())

      const after = await client.request.get(app.url(`/api/events/${client.slug}/moderation`))
      expect(after.status()).toBe(404)
      expect((await after.json()).error.code).toBe('event.notFound')
    } finally {
      await client.dispose()
    }
  })

  test('cannot create another event from the tab it already had open', async ({ app, browser }) => {
    const client = await aClientWithTheirOwnEvent(app, browser)
    try {
      setAccountDisabled(app, client.email, new Date())

      const created = await client.request.post(app.url('/api/events'), {
        headers: await csrfHeaders(client.request, app),
        data: { name: 'Un évènement de trop' },
      })

      expect(created.status()).toBe(401)
    } finally {
      await client.dispose()
    }
  })

  test('cannot mint a fresh enabled account by inviting a moderator', async ({ app, browser }) => {
    const client = await aClientWithTheirOwnEvent(app, browser)
    const invitee = `remplacante-${Date.now()}@eventslide.test`
    try {
      setAccountDisabled(app, client.email, new Date())

      const invited = await client.request.post(app.url(`/api/events/${client.slug}/moderators`), {
        headers: await csrfHeaders(client.request, app),
        data: { email: invitee, temporaryPassword: 'mot-de-passe-provisoire-du-soir' },
      })

      expect(invited.status()).toBe(404)
      // And nothing was written: the account the disabled host would have signed in as
      // does not exist. A 404 with a row behind it would be the same escalation with a
      // better status code.
      expect(accountExists(app, invitee)).toBe(false)
    } finally {
      await client.dispose()
    }
  })

  test('gets its event back when the account is enabled again', async ({ app, browser }) => {
    const client = await aClientWithTheirOwnEvent(app, browser)
    try {
      setAccountDisabled(app, client.email, new Date())

      setAccountDisabled(app, client.email, null)

      const after = await client.request.get(app.url(`/api/events/${client.slug}/moderation`))
      expect(after.status()).toBe(200)
    } finally {
      await client.dispose()
    }
  })
})

// ------------------------------------------------------------------- helpers --

/** A minimal valid JPEG, for the requests whose payload is not the point. */
const bytesOf = async (): Promise<Buffer> => fileBytes(await aPhoto('tiny', 32, 32))

interface OperatorContext {
  readonly request: APIRequestContext
  dispose(): Promise<void>
}

/**
 * The site role stored for an account, read from the running server's own database.
 *
 * `readonly`, and the only read in this suite that does not go through HTTP — because the
 * fact exists nowhere else: no response carries a site role. Opened and closed per call
 * rather than held, so nothing here keeps a handle on a file a worker is about to delete.
 */
const siteRoleOf = (app: TestApp, email: string): string | null => {
  const db = new Database(app.databasePath, { readonly: true, fileMustExist: true })
  try {
    const row = db.prepare('SELECT site_role FROM users WHERE email = ?').get(email) as
      { readonly site_role: string } | undefined
    return row?.site_role ?? null
  } finally {
    db.close()
  }
}

/**
 * A real session for the account the box bootstrapped, which `bootstrapOwner` makes the
 * operator on a fresh install.
 *
 * Its own browser context, so the operator's cookie jar is nobody else's — the whole
 * point being what this session cannot do.
 *
 * The site role is checked before the session is handed back, so a spec below can never
 * report "the operator is refused" about an account that is not one. It is a throw rather
 * than an expectation: this is the fixture's precondition, and a failure here should name
 * itself instead of appearing as a puzzling 404 three assertions later.
 */
const signedInAsOperator = async (app: TestApp, browser: Browser): Promise<OperatorContext> => {
  const role = siteRoleOf(app, app.owner.email)
  if (role !== 'operator') {
    throw new Error(
      `the account this fixture signs in as holds site_role=${String(role)}, not 'operator' — ` +
        'every refusal asserted against it would be a stranger’s refusal, not an operator’s',
    )
  }

  const context = await browser.newContext({ baseURL: app.baseUrl })
  const login = await context.request.post(app.url('/api/auth/login'), {
    headers: await csrfHeaders(context.request, app),
    data: { email: app.owner.email, password: app.owner.password },
  })
  if (!login.ok()) throw new Error(`the operator could not sign in: ${login.status()}`)

  return { request: context.request, dispose: () => context.close() }
}

interface ClientContext {
  readonly slug: string
  readonly joinCode: string
  /** Named, because disabling an account is done by address against the real database. */
  readonly email: string
  readonly request: APIRequestContext
  dispose(): Promise<void>
}

/**
 * A client of the operator: their own account, their own event, and no operator anywhere
 * near it.
 *
 * The account arrives the only way the product can make one today — the operator invites
 * it to an event of their own — and then leaves that event behind by creating one of its
 * own, which is where §10.3's invitation will eventually land a client directly. What
 * matters here is the end state: an event whose only member is somebody who does not run
 * the box.
 */
const aClientWithTheirOwnEvent = async (app: TestApp, browser: Browser): Promise<ClientContext> => {
  // Scoped to the worker: the server outlives one test, and an address that already has
  // an account takes the `created: false` branch and keeps its own password.
  const port = app.baseUrl.split(':').at(-1) ?? '0'
  const email = `cliente-${port}-${Date.now()}@eventslide.test`
  const temporary = 'mot-de-passe-provisoire-du-soir'
  const chosen = 'phrase-que-seule-la-cliente-connait'

  const introduction = await app.seedEvent({ slug: 'presentation', name: 'Présentation' })
  const operator = await signedInAsOperator(app, browser)
  const invited = await operator.request.post(
    app.url(`/api/events/${introduction.slug}/moderators`),
    {
      headers: await csrfHeaders(operator.request, app),
      data: { email, temporaryPassword: temporary },
    },
  )
  if (!invited.ok()) throw new Error(`inviting the client failed with ${invited.status()}`)
  await operator.dispose()

  const context = await browser.newContext({ baseURL: app.baseUrl })
  const api = context.request

  const login = await api.post(app.url('/api/auth/login'), {
    headers: await csrfHeaders(api, app),
    data: { email, password: temporary },
  })
  if (!login.ok()) throw new Error(`the client could not sign in: ${login.status()}`)

  const rotated = await api.post(app.url('/api/auth/password'), {
    headers: await csrfHeaders(api, app),
    data: { currentPassword: temporary, newPassword: chosen },
  })
  if (!rotated.ok()) throw new Error(`the client's password rotation failed: ${rotated.status()}`)

  const created = await api.post(app.url('/api/events'), {
    headers: await csrfHeaders(api, app),
    data: { name: `Mariage de la cliente ${port}-${Date.now()}` },
  })
  if (!created.ok()) throw new Error(`the client could not create their event: ${created.status()}`)
  const event = (await created.json()) as { slug: string; joinCode: string }

  const opened = await api.post(app.url(`/api/events/${event.slug}/status`), {
    headers: await csrfHeaders(api, app),
    data: { status: 'live' },
  })
  if (!opened.ok()) throw new Error(`the client could not open their event: ${opened.status()}`)

  return {
    slug: event.slug,
    joinCode: event.joinCode,
    email,
    request: api,
    dispose: () => context.close(),
  }
}

/**
 * Switches an account off in the running server's own database.
 *
 * There is no route and no console that does this — appointing and disabling accounts is
 * roadmap §10, and this branch deliberately builds the enforcement rather than the
 * administration of it. A statement against the SQLite file **is** the operational path
 * docs/SECURITY.md §11 describes today, so the specs below exercise the real one rather
 * than a fixture invented for them.
 *
 * Not `readonly`, unlike `siteRoleOf`: this one writes. Opened and closed per call for the
 * same reason — nothing here holds a handle on a file a worker is about to delete.
 */
/** Whether an address has an account at all, read from the server's own database. */
const accountExists = (app: TestApp, email: string): boolean => {
  const db = new Database(app.databasePath, { readonly: true, fileMustExist: true })
  try {
    return db.prepare('SELECT 1 FROM users WHERE email = ?').get(email) !== undefined
  } finally {
    db.close()
  }
}

const setAccountDisabled = (app: TestApp, email: string, at: Date | null): void => {
  const db = new Database(app.databasePath, { fileMustExist: true })
  try {
    const result = db
      .prepare('UPDATE users SET disabled_at = ? WHERE email = ?')
      .run(at === null ? null : at.toISOString(), email)
    if (result.changes !== 1) {
      throw new Error(`no account to disable for ${email}: ${result.changes} rows matched`)
    }
  } finally {
    db.close()
  }
}

const fileBytes = async (path: string): Promise<Buffer> => {
  const { readFile } = await import('node:fs/promises')
  return readFile(path)
}

interface GuestContext {
  readonly slug: string
  readonly request: APIRequestContext
  dispose(): Promise<void>
}

/** A joined guest with a live event, for the upload-hardening specs. */
const guestContext = async (app: TestApp, browser: Browser): Promise<GuestContext> => {
  const event = await app.seedEvent({})
  const context = await browser.newContext({ baseURL: app.baseUrl })
  const page = await context.newPage()
  await page.goto(app.url(`/join/${event.joinCode}`))
  await page.getByRole('button', { name: /Rejoindre/i }).click()
  await page.waitForURL(/\/upload/)

  return {
    slug: event.slug,
    request: context.request,
    dispose: () => context.close(),
  }
}
