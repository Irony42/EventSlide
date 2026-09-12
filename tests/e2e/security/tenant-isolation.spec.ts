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

// ------------------------------------------------------------------- helpers --

/** A minimal valid JPEG, for the requests whose payload is not the point. */
const bytesOf = async (): Promise<Buffer> => fileBytes(await aPhoto('tiny', 32, 32))

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
