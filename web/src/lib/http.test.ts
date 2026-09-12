import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, http } from './http'
import { fr } from './i18n/fr'

/**
 * The real transport, against stood-in browser primitives.
 *
 * Every component test injects a fake `Transport`, which is what keeps a component test
 * a statement about the component — and is also why nothing exercised this file. Here
 * the transport *is* the subject, so `fetch` and `XMLHttpRequest` are stood in for:
 * they are the third-party boundary this adapter exists to wrap, in the same category
 * as the `EventSource` stand-in in `useEventStream.test.ts`. No application module is
 * mocked.
 */

// ------------------------------------------------------------------ fetch --

interface SentRequest {
  readonly url: string
  readonly init: RequestInit
}

type FetchHandler = (url: string, init: RequestInit) => Promise<Response>

const sent: SentRequest[] = []

const stubFetch = (handler: FetchHandler): void => {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    sent.push({ url, init })
    return handler(url, init)
  })
}

/** Always answers with this one response, whatever was asked. */
const answerWith = (response: () => Response): void => {
  stubFetch(() => Promise.resolve(response()))
}

const jsonBody = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const textBody = (status: number, body: string): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/html' } })

/**
 * A 204 whose body cannot be read.
 *
 * The one way to state "the body was not parsed" as an outcome a caller observes rather
 * than as an assertion about a spy: reaching for it rejects.
 */
const unreadableNoContent = (): Response =>
  ({
    status: 204,
    ok: true,
    text: () => Promise.reject(new Error('a 204 carries no body to read')),
  }) as unknown as Response

const lastRequest = (): SentRequest => {
  const request = sent[sent.length - 1]
  if (request === undefined) throw new Error('no request was made')
  return request
}

const requestAt = (index: number): SentRequest => {
  const request = sent[index]
  if (request === undefined) throw new Error(`no request was made at attempt ${index + 1}`)
  return request
}

/** Read back through `Headers`, so the names are normalised the way fetch normalises them. */
const headersOf = (request: SentRequest): Record<string, string> =>
  Object.fromEntries(new Headers(request.init.headers ?? {}).entries())

// -------------------------------------------------------------------- xhr --

/**
 * A controllable stand-in for `XMLHttpRequest`.
 *
 * Extends `EventTarget` so listener registration and dispatch are the platform's own.
 * `abort()` models the specification faithfully — it fires nothing while the request
 * has not been sent — because a forgiving double here would make a cancellation bug
 * pass.
 */
class FakeXhr extends EventTarget {
  static instances: FakeXhr[] = []

  readonly upload = new EventTarget()
  readonly headers: Record<string, string> = {}
  method = ''
  url = ''
  withCredentials = false
  status = 0
  responseText = ''
  body: FormData | null = null
  sent = false

  constructor() {
    super()
    FakeXhr.instances.push(this)
  }

  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value
  }

  send(body: FormData): void {
    this.body = body
    this.sent = true
  }

  abort(): void {
    if (this.sent) this.dispatchEvent(new Event('abort'))
  }

  respond(status: number, responseText = ''): void {
    this.status = status
    this.responseText = responseText
    this.dispatchEvent(new Event('load'))
  }

  drop(kind: 'error' | 'timeout'): void {
    this.dispatchEvent(new Event(kind))
  }

  reportProgress(init: ProgressEventInit): void {
    this.upload.dispatchEvent(new ProgressEvent('progress', init))
  }
}

const pendingUpload = (): FakeXhr => {
  const instance = FakeXhr.instances[FakeXhr.instances.length - 1]
  if (instance === undefined) throw new Error('no upload was opened')
  return instance
}

const aForm = (): FormData => {
  const form = new FormData()
  form.append('photos', new Blob(['bytes'], { type: 'image/jpeg' }), 'confettis.jpg')
  return form
}

// ----------------------------------------------------------------- cookies --

const COOKIE_NAMES = [
  'es_csrf',
  'not_es_csrf',
  'es_csrf_backup',
  'es_csrfx',
  'es_guest',
  'lang',
  'flag',
]

const forgetCookies = (): void => {
  for (const name of COOKIE_NAMES) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

const failed = async (call: Promise<unknown>): Promise<unknown> =>
  call.then(
    () => {
      throw new Error('the call was expected to fail')
    },
    (cause: unknown) => cause,
  )

const asApiError = (cause: unknown): ApiError => {
  if (!(cause instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(cause)}`)
  return cause
}

beforeEach(() => {
  sent.length = 0
  FakeXhr.instances = []
  forgetCookies()
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ===========================================================================

describe('the error contract', () => {
  it('carries the machine code the server sent', async () => {
    answerWith(() => jsonBody(409, { error: { code: 'event.slugTaken' } }))

    const failure = asApiError(await failed(http.post('/api/events', { name: 'Gala' })))

    expect(failure.code).toBe('event.slugTaken')
    expect(failure.status).toBe(409)
  })

  it('shows French copy chosen from the code, never the message the server sent', async () => {
    // docs/API.md: `message` is for logs and developers. A guest's phone must never
    // render it — it is English, and behind a proxy it is not even necessarily ours.
    answerWith(() =>
      jsonBody(413, {
        error: { code: 'event.quotaExceeded', message: 'event byte quota reached' },
      }),
    )

    const failure = asApiError(await failed(http.post('/api/events/gala/photos', {})))

    expect(failure.message).toBe(fr.errors['event.quotaExceeded'])
  })

  it('carries the structured details alongside the code', async () => {
    answerWith(() => jsonBody(400, { error: { code: 'caption.tooLong', details: { max: 140 } } }))

    const failure = asApiError(await failed(http.patch('/api/events/gala/photos/p1/caption', {})))

    expect(failure.details).toEqual({ max: 140 })
  })

  it('reports a proxy’s HTML error page as a usable failure instead of crashing on it', async () => {
    // The realistic failure at a venue: a reverse proxy answers the upload with its own
    // 502 page. A parse exception here would surface as a blank screen.
    answerWith(() => textBody(502, '<html><body>502 Bad Gateway</body></html>'))

    const failure = asApiError(await failed(http.get('/api/events/gala/wall')))

    expect(failure.code).toBe('unknown')
    expect(failure.status).toBe(502)
  })

  it('reports an empty gateway failure as a usable failure', async () => {
    answerWith(() => textBody(502, ''))

    const failure = asApiError(await failed(http.get('/api/events/gala/wall')))

    expect(failure.code).toBe('unknown')
    expect(failure.status).toBe(502)
  })

  it('refuses to trust an error body that carries no code', async () => {
    answerWith(() => jsonBody(403, { error: { reason: 'nope' } }))

    const failure = asApiError(await failed(http.del('/api/events/gala')))

    expect(failure.code).toBe('unknown')
  })

  it.each([
    ['an error that is a sentence', { error: 'Bad Gateway' }],
    ['an error that is null', { error: null }],
    ['a body with no error at all', { detail: 'nope' }],
    ['a body that is not an object', 'nope'],
  ])('refuses to trust %s as the server’s failure vocabulary', async (_case, body) => {
    // Anything in front of the app can answer in its own shape. Reading a `code` out of
    // one would put a foreign string in front of a guest through `messageForCode`.
    answerWith(() => jsonBody(502, body))

    expect(asApiError(await failed(http.get('/api/events/gala/wall'))).code).toBe('unknown')
  })

  it('reports a truncated success body rather than returning half a DTO', async () => {
    answerWith(() => new Response('{"items":[', { status: 200 }))

    const failure = asApiError(await failed(http.get('/api/events')))

    expect(failure.code).toBe('unknown')
    expect(failure.status).toBe(200)
  })
})

describe('reading a response', () => {
  it('returns the parsed body of a successful read', async () => {
    answerWith(() => jsonBody(200, { revision: 'rev-1', items: [] }))

    const wall = await http.get<{ revision: string }>('/api/events/gala/wall')

    expect(wall.revision).toBe('rev-1')
  })

  it('does not read the body of a 204', async () => {
    answerWith(unreadableNoContent)

    await expect(http.del('/api/events/gala/photos/p1')).resolves.toBeUndefined()
  })

  it('resolves an empty 200 rather than failing on a body that is not there', async () => {
    answerWith(() => new Response('', { status: 200 }))

    await expect(http.post('/api/auth/logout')).resolves.toBeUndefined()
  })
})

describe('failures that are not the server’s answer', () => {
  it('reports a dropped connection as a network failure the guest can retry', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    const failure = asApiError(await failed(http.get('/api/events/gala/wall')))

    expect(failure.isNetwork).toBe(true)
    expect(failure.message).toBe(fr.errors.network)
  })

  it('lets a cancellation through instead of reporting it as a server failure', async () => {
    // The UI says nothing at all for a cancellation and "connexion interrompue" for a
    // drop, so conflating the two tells a guest their network failed when in fact they
    // pressed cancel.
    stubFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')))

    const failure = await failed(http.get('/api/events/gala/wall'))

    expect(failure).toBeInstanceOf(DOMException)
  })

  it.each([
    [
      'post',
      (signal: AbortSignal) => http.post('/api/events/gala/status', { status: 'live' }, signal),
    ],
    ['patch', (signal: AbortSignal) => http.patch('/api/events/gala', { name: 'Gala' }, signal)],
    ['del', (signal: AbortSignal) => http.del('/api/events/gala/photos/p1', signal)],
  ] as const)('carries the caller’s cancellation on a %s too', async (_verb, invoke) => {
    // An admin screen that unmounts mid-save must not leave the write in flight; every
    // verb is cancellable, not only the reads.
    const controller = new AbortController()
    answerWith(() => jsonBody(200, {}))

    await invoke(controller.signal)

    expect(lastRequest().init.signal).toBe(controller.signal)
  })

  it('hands the caller’s cancellation to the request itself', async () => {
    const controller = new AbortController()
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )

    const pending = http.get('/api/events/gala/wall', undefined, controller.signal)
    controller.abort()

    await expect(pending).rejects.toBeInstanceOf(DOMException)
  })
})

describe('what an ApiError tells the UI', () => {
  it('treats a rate limit as worth retrying, unlike the rest of the 4xx range', async () => {
    // The guest surface offers "Réessayer" on a 429 and explains the refusal on a 400;
    // one flag decides which, so the 429 exclusion is the whole rule.
    expect(new ApiError(429, 'rate.limited').isClientFault).toBe(false)
    expect(new ApiError(400, 'request.invalid').isClientFault).toBe(true)
    expect(new ApiError(500, 'server.unexpected').isClientFault).toBe(false)
  })

  it('distinguishes a missing session from an insufficient role', async () => {
    // 401 sends a host to the login screen; 403 must not, or a moderator of another
    // event is bounced out of their own.
    expect(new ApiError(401, 'auth.required').isUnauthenticated).toBe(true)
    expect(new ApiError(403, 'auth.forbidden').isForbidden).toBe(true)
    expect(new ApiError(403, 'auth.forbidden').isUnauthenticated).toBe(false)
  })
})

describe('CSRF double submit', () => {
  it('echoes the readable token on a state-changing request', async () => {
    document.cookie = 'es_csrf=tok-abc'
    answerWith(() => jsonBody(200, {}))

    await http.post('/api/events/gala/status', { status: 'live' })

    expect(headersOf(lastRequest())['x-csrf-token']).toBe('tok-abc')
  })

  it.each(['patch', 'del'] as const)('echoes the token on a %s as well', async (verb) => {
    document.cookie = 'es_csrf=tok-abc'
    answerWith(unreadableNoContent)

    await http[verb]('/api/events/gala/photos/p1')

    expect(headersOf(lastRequest())['x-csrf-token']).toBe('tok-abc')
  })

  it('sends no token on a read, which needs none', async () => {
    document.cookie = 'es_csrf=tok-abc'
    answerWith(() => jsonBody(200, {}))

    await http.get('/api/events/gala/wall')

    expect(headersOf(lastRequest())).not.toHaveProperty('x-csrf-token')
  })

  it('still sends the request when no token has been issued yet', async () => {
    // The very first call of a cold page can precede the cookie. Refusing to send would
    // strand a guest whose scan landed before the issuing response came back; the
    // server answers 403 and the page retries.
    answerWith(() => jsonBody(200, {}))

    await http.post('/api/join', { joinCode: 'H7K2QM' })

    expect(headersOf(lastRequest())).not.toHaveProperty('x-csrf-token')
  })

  it('finds the token among the other cookies of the page', async () => {
    // A venue's captive portal leaves its own cookies on whatever origin it can, and a
    // valueless one is legal. Neither may stop the scan before it reaches the token.
    document.cookie = 'flag'
    document.cookie = 'lang=fr'
    document.cookie = 'es_csrf=tok-abc'
    answerWith(() => jsonBody(200, {}))

    await http.post('/api/events/gala/status', { status: 'live' })

    expect(headersOf(lastRequest())['x-csrf-token']).toBe('tok-abc')
  })

  it.each([
    ['a cookie the token’s name is a suffix of', 'not_es_csrf=decoy'],
    ['a cookie the token’s name is a prefix of', 'es_csrf_backup=decoy'],
  ])('does not mistake %s for the token', async (_case, decoy) => {
    // Any match looser than the whole name — `includes`, `startsWith` — echoes a
    // captive portal's cookie as the token, and the server then answers 403 to every
    // upload at that venue. Both directions are asserted because each survives the
    // other's test.
    document.cookie = 'lang=fr'
    document.cookie = decoy
    answerWith(() => jsonBody(200, {}))

    await http.post('/api/events/gala/status', { status: 'live' })

    expect(headersOf(lastRequest())).not.toHaveProperty('x-csrf-token')
  })

  it('does not take a valueless cookie’s own name for the token', async () => {
    // `document.cookie` may carry a bare flag with no `=` at all. Reading a value out
    // of one yields the name itself, which would then be echoed as the token — a 403
    // on every upload, from a cookie the app never set.
    document.cookie = 'es_csrfx'
    answerWith(() => jsonBody(200, {}))

    await http.post('/api/events/gala/status', { status: 'live' })

    expect(headersOf(lastRequest())).not.toHaveProperty('x-csrf-token')
  })

  it('decodes a percent-encoded token rather than echoing it encoded', async () => {
    document.cookie = `es_csrf=${encodeURIComponent('tok/abc=')}`
    answerWith(() => jsonBody(200, {}))

    await http.post('/api/events/gala/status', { status: 'live' })

    expect(headersOf(lastRequest())['x-csrf-token']).toBe('tok/abc=')
  })
})

describe('what goes on the wire', () => {
  it('serialises a JSON body and declares its type', async () => {
    answerWith(() => jsonBody(200, {}))

    await http.post('/api/auth/login', { email: 'a@b.c', password: 'x' })

    expect(lastRequest().init.body).toBe('{"email":"a@b.c","password":"x"}')
    expect(headersOf(lastRequest())['content-type']).toBe('application/json')
  })

  it('leaves a FormData upload’s content type to the browser', async () => {
    // Stamping `application/json` on a multipart body strips the boundary the server
    // needs to split the parts, and every photo is then unreadable.
    answerWith(() => jsonBody(200, {}))
    const form = aForm()

    await http.post('/api/events/gala/photos', form)

    expect(lastRequest().init.body).toBe(form)
    expect(headersOf(lastRequest())).not.toHaveProperty('content-type')
  })

  it('declares no content type on a request that carries no body', async () => {
    answerWith(() => jsonBody(200, {}))

    await http.post('/api/events/gala/join-code')

    expect(lastRequest().init).not.toHaveProperty('body')
    expect(headersOf(lastRequest())).not.toHaveProperty('content-type')
  })

  it('sends the origin’s cookies, which are the only credential either audience has', async () => {
    answerWith(() => jsonBody(200, {}))

    await http.get('/api/auth/me')

    expect(lastRequest().init.credentials).toBe('same-origin')
  })

  it('asks for JSON on every request', async () => {
    answerWith(() => jsonBody(200, {}))

    await http.get('/api/auth/me')

    expect(headersOf(lastRequest())['accept']).toBe('application/json')
  })
})

describe('query strings', () => {
  it('appends the values the caller set', async () => {
    answerWith(() => jsonBody(200, {}))

    await http.get('/api/events/gala/moderation', { status: 'pending', limit: 50 })

    expect(lastRequest().url).toBe('/api/events/gala/moderation?status=pending&limit=50')
  })

  it('drops a value the caller left unset rather than sending the string "undefined"', async () => {
    // The moderation console passes `cursor` only on a second page. `?cursor=undefined`
    // is a 400 from the zod schema, so the first page would never load.
    answerWith(() => jsonBody(200, {}))

    await http.get('/api/events/gala/moderation', { status: 'pending', cursor: undefined })

    expect(lastRequest().url).toBe('/api/events/gala/moderation?status=pending')
  })

  it('leaves the path alone when every value was left unset', async () => {
    answerWith(() => jsonBody(200, {}))

    await http.get('/api/events/gala/moderation', { cursor: undefined })

    expect(lastRequest().url).toBe('/api/events/gala/moderation')
  })

  it('leaves the path alone when there is no query at all', async () => {
    answerWith(() => jsonBody(200, {}))

    await http.get('/api/events')

    expect(lastRequest().url).toBe('/api/events')
  })
})

describe('uploading with progress', () => {
  it('resolves with the server’s answer once the upload completes', async () => {
    const pending = http.upload<{ results: readonly { photoId: string }[] }>(
      '/api/events/gala/photos',
      aForm(),
    )

    pendingUpload().respond(201, JSON.stringify({ results: [{ photoId: 'photo-1' }] }))

    await expect(pending).resolves.toEqual({ results: [{ photoId: 'photo-1' }] })
  })

  it('posts the multipart body to the path it was given', async () => {
    const form = aForm()

    const pending = http.upload('/api/events/gala/photos', form)
    pendingUpload().respond(201, '{}')
    await pending

    expect(pendingUpload().method).toBe('POST')
    expect(pendingUpload().url).toBe('/api/events/gala/photos')
    expect(pendingUpload().body).toBe(form)
  })

  it('sends the device-token cookie with the upload', async () => {
    const pending = http.upload('/api/events/gala/photos', aForm())
    pendingUpload().respond(201, '{}')
    await pending

    // Without credentials the guest is anonymous to the server and the upload is a 401.
    expect(pendingUpload().withCredentials).toBe(true)
  })

  it('echoes the CSRF token on the upload', async () => {
    document.cookie = 'es_csrf=tok-abc'

    const pending = http.upload('/api/events/gala/photos', aForm())
    pendingUpload().respond(201, '{}')
    await pending

    expect(pendingUpload().headers['x-csrf-token']).toBe('tok-abc')
  })

  it('uploads without the CSRF header when no token has been issued yet', async () => {
    const pending = http.upload('/api/events/gala/photos', aForm())
    pendingUpload().respond(201, '{}')
    await pending

    expect(pendingUpload().headers).not.toHaveProperty('x-csrf-token')
  })

  it('reports progress as a whole percentage while the bytes leave the phone', async () => {
    // A spinner that does not move is indistinguishable from a hang, and a guest on
    // congested venue Wi-Fi re-taps.
    const seen: number[] = []
    const pending = http.upload('/api/events/gala/photos', aForm(), {
      onProgress: (progress) => seen.push(progress.percent),
    })

    // 512 of 1 500 is 34.13…: a fraction the progress bar would write straight into a
    // width, and a figure a guest would read as a broken number rather than a share.
    pendingUpload().reportProgress({ lengthComputable: true, loaded: 512, total: 1_500 })
    pendingUpload().reportProgress({ lengthComputable: true, loaded: 1_500, total: 1_500 })
    pendingUpload().respond(201, '{}')
    await pending

    expect(seen).toEqual([34, 100])
  })

  it('reports nothing while the total is still unknown', async () => {
    // A chunked request body has no computable length, and `NaN %` on a progress bar is
    // worse than no bar at all.
    const seen: number[] = []
    const pending = http.upload('/api/events/gala/photos', aForm(), {
      onProgress: (progress) => seen.push(progress.percent),
    })

    pendingUpload().reportProgress({ lengthComputable: false, loaded: 512, total: 0 })
    pendingUpload().respond(201, '{}')
    await pending

    expect(seen).toEqual([])
  })

  it('resolves an upload the server accepted with no body', async () => {
    const pending = http.upload('/api/events/gala/photos', aForm())

    pendingUpload().respond(204, '')

    await expect(pending).resolves.toBeUndefined()
  })

  it('carries the machine code when the server refuses the upload', async () => {
    const pending = http.upload('/api/events/gala/photos', aForm())

    pendingUpload().respond(413, JSON.stringify({ error: { code: 'upload.tooLarge' } }))

    const failure = asApiError(await failed(pending))
    expect(failure.code).toBe('upload.tooLarge')
    expect(failure.status).toBe(413)
  })

  it('reports a proxy’s HTML page during an upload as a usable failure', async () => {
    const pending = http.upload('/api/events/gala/photos', aForm())

    pendingUpload().respond(502, '<html><body>502 Bad Gateway</body></html>')

    expect(asApiError(await failed(pending)).code).toBe('unknown')
  })

  it('refuses an upload whose error body carries no code', async () => {
    const pending = http.upload('/api/events/gala/photos', aForm())

    pendingUpload().respond(403, JSON.stringify({ error: {} }))

    expect(asApiError(await failed(pending)).code).toBe('unknown')
  })

  it.each(['error', 'timeout'] as const)(
    'reports a %s during an upload as a network failure the guest can retry',
    async (kind) => {
      const pending = http.upload('/api/events/gala/photos', aForm())

      pendingUpload().drop(kind)

      // The code, not only the status: the queue offers "Réessayer" on `isNetwork` but
      // the row's sentence comes from the code, and a guest whose Wi-Fi dropped must be
      // told to check their network rather than given the generic sentence.
      const failure = asApiError(await failed(pending))
      expect(failure.code).toBe('network')
      expect(failure.isNetwork).toBe(true)
    },
  )

  it('reports a cancelled upload as a cancellation, not as a failed one', async () => {
    // The upload queue swallows an AbortError because the row is already gone. An
    // ApiError here would put "Échec" on a photo the guest deliberately removed.
    const controller = new AbortController()
    const pending = http.upload('/api/events/gala/photos', aForm(), {
      signal: controller.signal,
    })

    controller.abort()

    expect(await failed(pending)).toBeInstanceOf(DOMException)
  })

  it('does not send an upload whose signal was already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const failure = await failed(
      http.upload('/api/events/gala/photos', aForm(), { signal: controller.signal }),
    )

    expect(failure).toBeInstanceOf(DOMException)
    expect(pendingUpload().sent).toBe(false)
  })
})

/**
 * The server rotates `es_csrf` on a login and on a logout, so the token can change
 * underneath a request this transport is in the middle of building: the cookie is read
 * synchronously, the browser attaches its own `Cookie` header later, and a rotating
 * response can land in between. That mismatch is refused by a gate mounted ahead of
 * every router, so the attempt changed nothing and repeating it is safe.
 */
describe('a token rotated underneath a request', () => {
  /** Answers the first attempt with `code`, rotating the cookie as the server would. */
  const rotatingRefusal = (code: string): void => {
    let attempt = 0
    stubFetch(() => {
      attempt += 1
      if (attempt > 1) return Promise.resolve(jsonBody(200, { ok: true }))
      document.cookie = 'es_csrf=frais'
      return Promise.resolve(jsonBody(403, { error: { code } }))
    })
  }

  it.each(['request.csrfMismatch', 'request.csrfMissing'])(
    'repeats a mutation refused with %s, using the token the rotation left behind',
    async (code) => {
      document.cookie = 'es_csrf=perime'
      rotatingRefusal(code)

      await expect(http.post('/api/events/gala/status', { status: 'live' })).resolves.toEqual({
        ok: true,
      })

      expect(sent).toHaveLength(2)
      expect(headersOf(requestAt(0))['x-csrf-token']).toBe('perime')
      expect(headersOf(requestAt(1))['x-csrf-token']).toBe('frais')
    },
  )

  it('repeats the body and the path, not just the header', async () => {
    document.cookie = 'es_csrf=perime'
    rotatingRefusal('request.csrfMismatch')

    await http.patch('/api/events/gala/photos/p1/caption', { caption: 'Les confettis' })

    expect(lastRequest().url).toBe('/api/events/gala/photos/p1/caption')
    expect(lastRequest().init.body).toBe('{"caption":"Les confettis"}')
    expect(lastRequest().init.method).toBe('PATCH')
  })

  it('retries once and then reports the refusal, rather than looping', async () => {
    // A token that is genuinely gone — a tab open all evening, a proxy that dropped the
    // cookie — is not a race, and the French copy for these codes says to reload.
    document.cookie = 'es_csrf=perime'
    answerWith(() => jsonBody(403, { error: { code: 'request.csrfMismatch' } }))

    const failure = asApiError(await failed(http.del('/api/events/gala')))

    expect(failure.code).toBe('request.csrfMismatch')
    expect(sent).toHaveLength(2)
  })

  it('does not repeat a 403 that is not the CSRF gate', async () => {
    // A role refusal is the server's answer, not a stale token, and it may well have
    // been decided after the route did work.
    answerWith(() => jsonBody(403, { error: { code: 'auth.forbidden' } }))

    const failure = asApiError(await failed(http.post('/api/events/gala/status')))

    expect(failure.code).toBe('auth.forbidden')
    expect(sent).toHaveLength(1)
  })

  it('does not repeat a refusal on a read, which never carried a token', async () => {
    answerWith(() => jsonBody(403, { error: { code: 'request.csrfMismatch' } }))

    await failed(http.get('/api/events/gala'))

    expect(sent).toHaveLength(1)
  })

  it('does not repeat a refused upload, because a guest’s token never rotates', async () => {
    // Only a login or a logout rotates, and a guest does neither — they carry a device
    // token, not a session. Repeating here would push the photos up a congested venue's
    // Wi-Fi a second time for a race that cannot happen on this path.
    document.cookie = 'es_csrf=perime'
    const pending = http.upload('/api/events/gala/photos', aForm())
    pendingUpload().respond(403, JSON.stringify({ error: { code: 'request.csrfMismatch' } }))

    const failure = asApiError(await failed(pending))

    expect(failure.code).toBe('request.csrfMismatch')
    expect(FakeXhr.instances).toHaveLength(1)
  })
})
