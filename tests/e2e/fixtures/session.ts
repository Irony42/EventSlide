/**
 * A cookie jar and a CSRF token over `fetch`: how the fixtures talk to the API, as a browser does.
 *
 * One client for everything that is not a page: seeding an event, signing the owner in, and the
 * specs about ceilings and operators whose every control is a refusal the server answers.
 * It used to be two (a seeding one in `startTestApp.ts` that froze the CSRF token at its first
 * value and kept duplicate cookie names in an array, and this one, which reads the cookie the
 * server last set), so a login that rotates the pair was handled by the one and left to luck in
 * the other.
 */

/** A JSON object body, narrowed by whoever reads it: this suite never trusts a shape. */
export type Json = Readonly<Record<string, unknown>>

export interface Reply {
  readonly status: number
  readonly body: Json
}

/** Whether a reply is a success. The product answers 200, 201, 202 or 204 as the route says. */
export const succeeded = (reply: Reply): boolean => reply.status >= 200 && reply.status < 300

/**
 * What a session over `fetch` offers. Not a shortcut around the boundary: a fixture that wrote
 * rows directly could create state the application cannot, and going through the API also covers
 * the seeding path itself.
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
