import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A Telegram Bot API in memory, over `node:http`, for the adapter's tests and the end-to-end journey
 * (`TELEGRAM_API_BASE_URL` points at it). It speaks the same envelope as the real one (`{ok, result}` or
 * `{ok: false, error_code, description, parameters}`) and nothing more: updates are queued by the test and handed to
 * `getUpdates` once, files are served from a map, and what the bot said and reacted with is recorded.
 *
 * It checks the token in the path against the one it was started with, as the real service does: a wrong token is a 401,
 * which is how the tests prove the adapter uses its own and never leaks it.
 */

export interface RecordedCall {
  readonly method: string
  readonly body: Record<string, unknown>
}

export interface FakeBotApiOptions {
  readonly token: string
  readonly username?: string
  /** How long a `getUpdates` with nothing queued waits before answering empty. Short in tests. */
  readonly pollWaitMs?: number
}

type Failure = { readonly status: number; readonly body: unknown }

export class FakeBotApiServer {
  readonly calls: RecordedCall[] = []
  /** Every URL path the server was asked for: the token is in them, which is what the tests search for. */
  readonly paths: string[] = []
  private readonly updates: Record<string, unknown>[] = []
  private readonly files = new Map<string, Buffer>()
  private readonly failures = new Map<string, Failure[]>()
  /** Where it listens, once started. */
  baseUrl = ''
  private nextUpdateId = 1
  private server: Server | null = null
  private readonly token: string
  private readonly username: string
  private readonly pollWaitMs: number

  constructor(options: FakeBotApiOptions) {
    this.token = options.token
    this.username = options.username ?? 'EventSlideBot'
    this.pollWaitMs = options.pollWaitMs ?? 20
  }

  async start(port = 0): Promise<string> {
    const server = createServer((request, response) => {
      void this.handle(request, response)
    })
    this.server = server
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    this.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return this.baseUrl
  }

  async stop(): Promise<void> {
    const server = this.server
    if (server === null) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.server = null
  }

  /** Queue an update for the next `getUpdates`; its `update_id` is assigned here. */
  push(update: Record<string, unknown>): number {
    const id = this.nextUpdateId
    this.nextUpdateId += 1
    this.updates.push({ update_id: id, ...update })
    return id
  }

  /** A file the bot can fetch: `file_id` is what a message carries, the path is where it is served. */
  hold(fileId: string, bytes: Buffer): void {
    this.files.set(fileId, bytes)
  }

  /** The next call of `method` fails like this (once, in order). `method` may be `file` for a download. */
  failNext(method: string, status: number, body: unknown = {}): void {
    const list = this.failures.get(method) ?? []
    list.push({ status, body })
    this.failures.set(method, list)
  }

  said(): { chat_id: unknown; text: string; reply_to: unknown }[] {
    return this.calls
      .filter((call) => call.method === 'sendMessage')
      .map((call) => ({
        chat_id: call.body['chat_id'],
        text: String(call.body['text']),
        reply_to: (call.body['reply_parameters'] as { message_id?: unknown } | undefined)
          ?.message_id,
      }))
  }

  reactions(): { chat_id: unknown; message_id: unknown }[] {
    return this.calls
      .filter((call) => call.method === 'setMessageReaction')
      .map((call) => ({ chat_id: call.body['chat_id'], message_id: call.body['message_id'] }))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? ''
    this.paths.push(url)
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }

    const file = /^\/file\/bot([^/]+)\/(.+)$/u.exec(url)
    if (file !== null) {
      const failure = this.failures.get('file')?.shift()
      if (failure !== undefined) return send(failure.status, failure.body)
      if (file[1] !== this.token) return send(401, { ok: false, error_code: 401 })
      const bytes = this.files.get(decodeURIComponent(file[2] ?? '').replace(/^files\//u, ''))
      if (bytes === undefined) return send(404, { ok: false, error_code: 404 })
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
      })
      response.end(bytes)
      return
    }

    const call = /^\/bot([^/]+)\/(\w+)$/u.exec(url)
    if (call === null) return send(404, { ok: false, error_code: 404 })
    const method = call[2] ?? ''
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const text = Buffer.concat(chunks).toString('utf8')
    const body = (text === '' ? {} : JSON.parse(text)) as Record<string, unknown>
    this.calls.push({ method, body })

    const failure = this.failures.get(method)?.shift()
    if (failure !== undefined) return send(failure.status, failure.body)
    if (call[1] !== this.token) {
      return send(401, { ok: false, error_code: 401, description: 'Unauthorized' })
    }

    switch (method) {
      case 'getMe':
        return send(200, { ok: true, result: { id: 1, is_bot: true, username: this.username } })
      case 'getUpdates': {
        const offset = typeof body['offset'] === 'number' ? body['offset'] : 0
        const due = this.updates.filter((update) => (update['update_id'] as number) >= offset)
        if (due.length === 0) await new Promise((resolve) => setTimeout(resolve, this.pollWaitMs))
        return send(200, { ok: true, result: due })
      }
      case 'getFile': {
        const id = String(body['file_id'])
        if (!this.files.has(id)) {
          return send(400, {
            ok: false,
            error_code: 400,
            description: 'Bad Request: wrong file_id',
          })
        }
        return send(200, { ok: true, result: { file_id: id, file_path: `files/${id}` } })
      }
      case 'sendMessage':
      case 'setMessageReaction':
        return send(200, { ok: true, result: true })
      default:
        return send(404, { ok: false, error_code: 404, description: 'Not Found' })
    }
  }
}
