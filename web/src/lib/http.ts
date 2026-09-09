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
 */
const CSRF_COOKIE = 'es_csrf'
const CSRF_HEADER = 'x-csrf-token'

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

const request = async <T>(
  method: string,
  path: string,
  options: {
    body?: unknown
    query?: Readonly<Record<string, string | number | undefined>>
    signal?: AbortSignal
  } = {},
): Promise<T> => {
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
        xhr.abort()
      } else {
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }
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
