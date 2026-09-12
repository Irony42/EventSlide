import { describe, expect, it, vi } from 'vitest'
import { fetchOutboxSender } from './fetchSender'
import { outboxSenderContract } from './testing/outboxSenderContract'
import type { OutboxEntry } from './outbox'

/**
 * The service worker's sender, against the same contract the page's answers.
 *
 * This module lives in `web/src` rather than in `web/sw` precisely so that this file can
 * exist: `web/sw` belongs to no vitest project, so code written there reports as
 * *nothing* in the coverage summary — not a low number, absent, which is the one way a
 * gap stays hidden.
 */

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status })

const accepted = (): Response =>
  jsonResponse(200, { results: [{ index: 0, status: 'accepted', photoId: 'photo-1' }] })

/**
 * A `fetch` double that records what it was asked for.
 *
 * Annotated as `typeof fetch` rather than inferred: `vi.fn(async () => …)` infers a
 * zero-argument mock, so `mock.calls[0]` is an empty tuple and every assertion about the
 * request it received is unreachable at the type level.
 */
const recordingFetch = () => vi.fn<typeof fetch>(async () => accepted())

const requestFrom = (mock: ReturnType<typeof recordingFetch>): RequestInit => {
  const init = mock.mock.calls[0]?.[1]
  if (init === undefined) throw new Error('fetch was never called')
  return init
}

const readCsrf = async (): Promise<string | null> => 'csrf-live'

outboxSenderContract('fetch', {
  ok: (results) =>
    fetchOutboxSender({
      fetch: vi.fn<typeof fetch>(async () => jsonResponse(200, { results })),
      readCsrf,
    }),
  failure: (status, code) =>
    fetchOutboxSender({
      fetch: vi.fn<typeof fetch>(async () => jsonResponse(status, { error: { code } })),
      readCsrf,
    }),
  offline: () =>
    fetchOutboxSender({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('Failed to fetch')
      }),
      readCsrf,
    }),
})

const anEntry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: 'entry-1',
  slug: 'camille & sacha',
  bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
  fileName: 'confettis.jpg',
  fileType: 'image/jpeg',
  caption: 'Les confettis',
  enqueuedAt: 0,
  attempts: 0,
  lastAttemptAt: null,
  claimedAt: null,
  csrfToken: 'csrf-stored',
  ...overrides,
})

describe('fetchOutboxSender', () => {
  it('posts to the entry’s own event, escaped', async () => {
    // Every photo query on the server is scoped by event, and so is this: an entry sent
    // to the wrong slug is the client half of a tenancy bug.
    const fetch = recordingFetch()

    await fetchOutboxSender({ fetch, readCsrf })(anEntry())

    expect(fetch.mock.calls[0]?.[0]).toBe('/api/events/camille%20%26%20sacha/photos')
  })

  it('carries the caption, the file name and the credentials', async () => {
    const fetch = recordingFetch()

    await fetchOutboxSender({ fetch, readCsrf })(anEntry())

    const init = requestFrom(fetch)
    const form = init.body as FormData
    expect(init.method).toBe('POST')
    // The guest's device token lives in an HttpOnly cookie; without this the request is
    // anonymous and the server answers 401.
    expect(init.credentials).toBe('same-origin')
    expect((form.get('photos') as File).name).toBe('confettis.jpg')
    expect(form.get('caption')).toBe('Les confettis')
  })

  it('omits an absent caption rather than sending an empty one', async () => {
    // The server distinguishes "no caption" from an invalid one, and an untouched field
    // must not become a validation error.
    const fetch = recordingFetch()

    await fetchOutboxSender({ fetch, readCsrf })(anEntry({ caption: null }))

    expect((requestFrom(fetch).body as FormData).has('caption')).toBe(false)
  })

  it('sends the live CSRF token when the worker can read one', async () => {
    const fetch = recordingFetch()

    await fetchOutboxSender({ fetch, readCsrf })(anEntry())

    const headers = requestFrom(fetch).headers as Record<string, string>
    expect(headers['x-csrf-token']).toBe('csrf-live')
  })

  it('sends no CSRF header at all rather than an empty one', async () => {
    // A worker with no `cookieStore`, holding an entry stored before the token existed.
    // An invented empty header is refused as `request.csrfMismatch`, which reads to the
    // guest as "the page has expired" — a confusing answer to a question nobody asked.
    const fetch = recordingFetch()

    await fetchOutboxSender({ fetch, readCsrf: async () => null })(anEntry())

    const headers = requestFrom(fetch).headers as Record<string, string>
    expect('x-csrf-token' in headers).toBe(false)
  })

  it('keeps a photo when the answer was not JSON at all', async () => {
    // A proxy error page. The status decides, and an unreadable body must never be the
    // reason a photo is deleted off somebody's phone.
    const sender = fetchOutboxSender({
      fetch: vi.fn<typeof fetch>(
        async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      ),
      readCsrf,
    })

    expect(await sender(anEntry())).toEqual({ kind: 'deferred' })
  })
})
