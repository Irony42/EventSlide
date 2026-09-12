import { messageForCode } from './i18n/fr'

/**
 * The only place in the web app that calls `fetch`.
 *
 * Components receive data through a hook, and a hook calls a typed function in
 * `web/src/lib/api/`. That is what lets a component test inject a fake transport
 * instead of stubbing a global.
 */

export interface ApiErrorBody {
  readonly error: {
    readonly code: string
    readonly message?: string
    readonly details?: Readonly<Record<string, unknown>>
  }
}

/**
 * A failure the server described. `code` is the stable machine string; `message` is the
 * French sentence chosen locally from it, never text the server sent.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Readonly<Record<string, unknown>>

  constructor(status: number, code: string, details: Readonly<Record<string, unknown>> = {}) {
    super(messageForCode(code))
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** A dropped connection mid-upload, which the guest surface must offer to retry. */
  static network(): ApiError {
    return new ApiError(0, 'network')
  }

  get isNetwork(): boolean {
    return this.status === 0
  }

  get isUnauthenticated(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  /** Retrying will not help: the request itself is wrong. */
  get isClientFault(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429
  }
}

const isApiErrorBody = (value: unknown): value is ApiErrorBody => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = (value as { error?: unknown }).error
  if (typeof candidate !== 'object' || candidate === null) return false
  return typeof (candidate as { code?: unknown }).code === 'string'
}

/**
 * Double-submit CSRF.
 *
 * The server sets a readable `es_csrf` cookie and requires its value echoed in this
 * header on every state-changing request. `SameSite=Lax` alone is not enough here: it
 * still permits a cross-site top-level POST, and the guest surface is reached by
 * scanning a QR code, so a guest's browser follows links from outside the app as a
 * matter of course.
 *
 * The token is read from `document.cookie` per request and never cached, which is what
 * makes the server's rotation on login and on logout invisible here: whatever the
 * cookie holds at the moment a request is built is what goes in the header. See
 * {@link isStaleCsrf} for the one interleaving that still needs handling.
 */
const CSRF_COOKIE = 'es_csrf'
const CSRF_HEADER = 'x-csrf-token'

/** The two codes the server's CSRF gate answers with. */
const CSRF_REFUSALS = new Set(['request.csrfMissing', 'request.csrfMismatch'])

const readCookie = (name: string): string | null => {
  for (const part of document.cookie.split('; ')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator) === name) {
      return decodeURIComponent(part.slice(separator + 1))
    }
  }
  return null
}

/**
 * The double-submit token as it stands right now.
 *
 * Exported for the one caller that cannot read `document.cookie` for itself: the
 * offline outbox captures the token beside a photo so the service worker — which has no
 * document — can send it hours later. Nothing else should reach for this; every request
 * built here already carries the header.
 */
export const currentCsrfToken = (): string | null => readCookie(CSRF_COOKIE)

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const headersFor = (method: string, body: unknown): HeadersInit => {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json'
  }
  if (MUTATING.has(method)) {
    const token = readCookie(CSRF_COOKIE)
    if (token !== null) headers[CSRF_HEADER] = token
  }
  return headers
}

const buildUrl = (path: string, query?: Readonly<Record<string, string | number | undefined>>) => {
  if (!query) return path
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const serialised = search.toString()
  return serialised.length > 0 ? `${path}?${serialised}` : path
}

const parse = async <T>(response: Response): Promise<T> => {
  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: unknown
  try {
    payload = text.length > 0 ? JSON.parse(text) : undefined
  } catch {
    // A proxy error page or a truncated response, whatever the status was. Never
    // surface the raw body: it may be an HTML page or, behind a misconfigured proxy,
    // someone else's response.
    throw new ApiError(response.status, 'unknown')
  }

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiError(response.status, payload.error.code, payload.error.details ?? {})
    }
    throw new ApiError(response.status, 'unknown')
  }

  return payload as T
}

interface RequestOptions {
  body?: unknown
  query?: Readonly<Record<string, string | number | undefined>>
  signal?: AbortSignal
}

const send = async <T>(method: string, path: string, options: RequestOptions): Promise<T> => {
  // Assembled conditionally rather than with `undefined` values: under
  // `exactOptionalPropertyTypes` an explicit `body: undefined` is not the same as an
  // absent one, and `RequestInit` does not accept it.
  const init: RequestInit = {
    method,
    // Session cookie for a host, device-token cookie for a guest.
    credentials: 'same-origin',
    headers: headersFor(method, options.body),
    ...(options.body === undefined
      ? {}
      : {
          body: options.body instanceof FormData ? options.body : JSON.stringify(options.body),
        }),
    ...(options.signal ? { signal: options.signal } : {}),
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), init)
  } catch (cause) {
    // An aborted request is the caller's own doing, not a network failure to report.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw ApiError.network()
  }

  return parse<T>(response)
}

/**
 * Whether this refusal is the one a retry fixes.
 *
 * Reading the cookie and sending the request are not one atomic step: `headersFor`
 * reads `document.cookie` synchronously, and the browser attaches its own `Cookie`
 * header later, when it actually builds the request. A response that rotates `es_csrf`
 * — a login or a logout completing in another tab, or alongside a queued mutation —
 * can land in between, and then the header carries the old token while the cookie
 * carries the new one. The server calls that `request.csrfMismatch` and the French copy
 * for it tells the user the page has expired, which is both confusing and wrong: only
 * the token moved.
 *
 * Retrying is safe here in a way it is not for other 4xx, and that is a property of the
 * server rather than a hope: `requireCsrfToken` is mounted on `/api` ahead of every
 * router (`src/interface/http/server.ts`), so a refusal carrying one of these two codes
 * proves the request reached no route and changed nothing. Any other status may have
 * been produced after work was done and is never repeated.
 *
 * Only for mutations, because only a mutation carries the header at all.
 */
const isStaleCsrf = (method: string, cause: unknown): boolean =>
  MUTATING.has(method) &&
  cause instanceof ApiError &&
  cause.status === 403 &&
  CSRF_REFUSALS.has(cause.code)

const request = async <T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  try {
    return await send<T>(method, path, options)
  } catch (cause) {
    if (!isStaleCsrf(method, cause)) throw cause
    // Once, never in a loop. The second attempt re-reads `document.cookie`, so it
    // carries whatever the rotation left there; if that is refused too then the token
    // really is missing or stale — a tab open all evening, a proxy that dropped the
    // cookie — and "reload the page" is the right advice after all.
    return await send<T>(method, path, options)
  }
}

export interface UploadProgress {
  readonly loaded: number
  readonly total: number
  readonly percent: number
}

/**
 * A multipart upload with progress, over `XMLHttpRequest`.
 *
 * `fetch` still has no upload-progress event in any shipping browser, and a guest on
 * congested venue Wi-Fi sending four photos needs to see that something is happening —
 * a spinner with no movement is indistinguishable from a hang, and they will re-tap.
 *
 * No CSRF retry here, unlike {@link request}, and the asymmetry is deliberate. The
 * token is rotated only by a login or a logout; the only caller of this path is a guest
 * sending photos, and a guest never does either — they have a device token, not a
 * session. So the interleaving {@link isStaleCsrf} exists for cannot arise on this
 * path, while the retry itself would mean pushing tens of megabytes back up a venue's
 * Wi-Fi a second time, which is the one repetition the guest surface is built to avoid.
 */
const upload = <T>(
  path: string,
  form: FormData,
  handlers: {
    onProgress?: (progress: UploadProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', path)
    xhr.withCredentials = true
    xhr.setRequestHeader('accept', 'application/json')
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf !== null) xhr.setRequestHeader(CSRF_HEADER, csrf)

    if (handlers.onProgress) {
      const onProgress = handlers.onProgress
      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable) return
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        })
      })
    }

    xhr.addEventListener('load', () => {
      let payload: unknown
      try {
        payload = xhr.responseText.length > 0 ? JSON.parse(xhr.responseText) : undefined
      } catch {
        reject(new ApiError(xhr.status, 'unknown'))
        return
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as T)
        return
      }
      if (isApiErrorBody(payload)) {
        reject(new ApiError(xhr.status, payload.error.code, payload.error.details ?? {}))
        return
      }
      reject(new ApiError(xhr.status, 'unknown'))
    })

    xhr.addEventListener('error', () => reject(ApiError.network()))
    xhr.addEventListener('timeout', () => reject(ApiError.network()))
    xhr.addEventListener('abort', () => reject(new DOMException('Upload aborted', 'AbortError')))

    if (handlers.signal) {
      const signal = handlers.signal
      if (signal.aborted) {
        // Refused here rather than through `xhr.abort()`. Per the XHR specification
        // `abort()` on a request that has not been sent fires no `abort` event and
        // leaves the object OPENED, so the old form both failed to reject and then
        // sent the photo anyway — the opposite of a cancellation.
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(form)
  })

/**
 * The transport surface. Injected as a whole in tests, so a component test never
 * touches `fetch` or `XMLHttpRequest`.
 */
export interface Transport {
  get<T>(
    path: string,
    query?: Readonly<Record<string, string | number | undefined>>,
    signal?: AbortSignal,
  ): Promise<T>
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>
  patch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>
  del<T>(path: string, signal?: AbortSignal): Promise<T>
  upload<T>(
    path: string,
    form: FormData,
    handlers?: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal },
  ): Promise<T>
}

export const http: Transport = {
  get: (path, query, signal) =>
    request('GET', path, { ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),
  post: (path, body, signal) =>
    request('POST', path, {
      ...(body !== undefined ? { body } : {}),
      ...(signal ? { signal } : {}),
    }),
  patch: (path, body, signal) =>
    request('PATCH', path, {
      ...(body !== undefined ? { body } : {}),
      ...(signal ? { signal } : {}),
    }),
  del: (path, signal) => request('DELETE', path, signal ? { signal } : {}),
  upload,
}
