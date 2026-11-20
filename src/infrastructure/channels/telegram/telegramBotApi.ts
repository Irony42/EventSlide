import type { LogContext } from '../../../application/ports/logger'

/**
 * A client of the Telegram Bot API made by hand on `fetch` (spec 27 §6): six methods and no dependency.
 *
 * ## The token is in every URL, so no URL ever leaves this file
 *
 * Telegram puts the bot's credential in the path (`/bot<token>/getUpdates`, `/file/bot<token>/<path>`). An error from
 * `fetch` carries that URL in its message, a rejected response may echo things, and a logged request is a leaked bot.
 * So every failure is **rebuilt** here as a {@link TelegramApiError} with a stable `code` and nothing else the remote
 * service said: `telegram.unreachable` (no answer: the network, a timeout, an abort), `telegram.rejected` (an answer that
 * says no, with its numeric HTTP status and Telegram's own `error_code`). The only thing read from a rejection's
 * description is whether it means "file too big", and it is never kept. Nothing here logs.
 */

export interface TelegramApiError {
  readonly code: 'telegram.unreachable' | 'telegram.rejected'
  /** The HTTP status when the service answered, else `null`. */
  readonly status: number | null
  /** Telegram's own numeric `error_code` (409 for two getUpdates, 429 for a wait), else `null`. */
  readonly errorCode: number | null
  /** Seconds Telegram asks to wait (`parameters.retry_after`), else `null`. */
  readonly retryAfterSeconds: number | null
  /** The service said the file is over its limit (`getFile`). The only text of a description that is ever read. */
  readonly fileTooBig: boolean
  /** The call was cut by the caller's own signal, which is not a fault of the network. */
  readonly aborted: boolean
}

export type TelegramResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TelegramApiError }

export interface TelegramBotApiOptions {
  readonly token: string
  /** `https://api.telegram.org` unless a local Bot API server or a test fake is in front. */
  readonly baseUrl: string
  /** Injected so a test needs no network; the default is the global `fetch`. */
  readonly fetch?: typeof fetch
  /** How long a plain call may take (`getUpdates` adds its own long-poll wait). */
  readonly timeoutMs?: number
}

export interface TelegramMe {
  readonly username: string
}

/** What `getUpdates` hands over: raw, untrusted updates, parsed by `telegramUpdates.ts`. */
export type RawUpdate = Readonly<Record<string, unknown>>

export type DownloadOutcome =
  | { readonly ok: true; readonly value: Uint8Array }
  | { readonly ok: false; readonly error: TelegramApiError | 'tooLarge' }

const DEFAULT_TIMEOUT_MS = 15_000
const LONG_POLL_MARGIN_MS = 10_000

const failure = (
  patch: Partial<TelegramApiError> = {},
): { ok: false; error: TelegramApiError } => ({
  ok: false,
  error: {
    code: 'telegram.unreachable',
    status: null,
    errorCode: null,
    retryAfterSeconds: null,
    fileTooBig: false,
    aborted: false,
    ...patch,
  },
})

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** An identifier as Telegram takes it: a number when it is a safe one, else the string it came as. */
const idOf = (ref: string): number | string => {
  const number = Number(ref)
  return Number.isSafeInteger(number) ? number : ref
}

export class TelegramBotApi {
  private readonly token: string
  private readonly baseUrl: string
  private readonly doFetch: typeof fetch
  private readonly timeoutMs: number

  constructor(options: TelegramBotApiOptions) {
    this.token = options.token
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.doFetch = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async getMe(signal: AbortSignal): Promise<TelegramResult<TelegramMe>> {
    const result = await this.call('getMe', {}, signal, this.timeoutMs)
    if (!result.ok) return result
    const me = asRecord(result.value)
    const username = me === null ? null : me['username']
    if (typeof username !== 'string' || username === '') {
      return failure({ code: 'telegram.rejected' })
    }
    return { ok: true, value: { username } }
  }

  async getUpdates(
    offset: number | null,
    timeoutSeconds: number,
    signal: AbortSignal,
  ): Promise<TelegramResult<readonly RawUpdate[]>> {
    const body: Record<string, unknown> = {
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'my_chat_member'],
    }
    if (offset !== null) body['offset'] = offset
    const result = await this.call(
      'getUpdates',
      body,
      signal,
      timeoutSeconds * 1000 + LONG_POLL_MARGIN_MS,
    )
    if (!result.ok) return result
    if (!Array.isArray(result.value)) return failure({ code: 'telegram.rejected' })
    const updates: RawUpdate[] = []
    for (const item of result.value as unknown[]) {
      const update = asRecord(item)
      if (update !== null) updates.push(update)
    }
    return { ok: true, value: updates }
  }

  /** The path of a file on Telegram's servers (valid for an hour), from the `file_id` a message carried. */
  async getFilePath(fileId: string, signal: AbortSignal): Promise<TelegramResult<string>> {
    const result = await this.call('getFile', { file_id: fileId }, signal, this.timeoutMs)
    if (!result.ok) return result
    const file = asRecord(result.value)
    const path = file === null ? null : file['file_path']
    if (typeof path !== 'string' || path === '') return failure({ code: 'telegram.rejected' })
    return { ok: true, value: path }
  }

  /**
   * The bytes of a file, **at most `maxBytes` of them**: the declared length is checked first, then the stream is read
   * chunk by chunk and cut as soon as it would pass the limit, so a lie about the size costs the limit and never the file.
   */
  async downloadFile(
    filePath: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<DownloadOutcome> {
    const url = `${this.baseUrl}/file/bot${this.token}/${filePath}`
    const guard = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs * 4)])
    let response: Response
    try {
      response = await this.doFetch(url, { signal: guard })
    } catch {
      return failure({ aborted: signal.aborted })
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return failure({ code: 'telegram.rejected', status: response.status })
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      return { ok: false, error: 'tooLarge' }
    }
    if (response.body === null) return { ok: true, value: new Uint8Array(0) }

    const chunks: Uint8Array[] = []
    let total = 0
    try {
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined)
          return { ok: false, error: 'tooLarge' }
        }
        chunks.push(value)
      }
    } catch {
      return failure({ aborted: signal.aborted })
    }
    const bytes = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) {
      bytes.set(chunk, at)
      at += chunk.length
    }
    return { ok: true, value: bytes }
  }

  async sendMessage(
    conversationRef: string,
    text: string,
    replyTo: string | undefined,
    signal: AbortSignal,
  ): Promise<TelegramResult<null>> {
    const body: Record<string, unknown> = {
      chat_id: idOf(conversationRef),
      text,
      link_preview_options: { is_disabled: true },
    }
    if (replyTo !== undefined) {
      // A reply to a message deleted since must still be said.
      body['reply_parameters'] = { message_id: idOf(replyTo), allow_sending_without_reply: true }
    }
    const result = await this.call('sendMessage', body, signal, this.timeoutMs)
    return result.ok ? { ok: true, value: null } : result
  }

  async setReaction(
    conversationRef: string,
    messageRef: string,
    emoji: string,
    signal: AbortSignal,
  ): Promise<TelegramResult<null>> {
    const result = await this.call(
      'setMessageReaction',
      {
        chat_id: idOf(conversationRef),
        message_id: idOf(messageRef),
        reaction: [{ type: 'emoji', emoji }],
      },
      signal,
      this.timeoutMs,
    )
    return result.ok ? { ok: true, value: null } : result
  }

  /** One JSON call. Never throws; never carries the URL, the token or a description into what it returns. */
  private async call(
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<TelegramResult<unknown>> {
    const guard = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    let response: Response
    try {
      response = await this.doFetch(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: guard,
      })
    } catch {
      return failure({ aborted: signal.aborted })
    }

    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      return failure({ code: 'telegram.rejected', status: response.status })
    }
    const envelope = asRecord(parsed)
    if (response.ok && envelope !== null && envelope['ok'] === true) {
      return { ok: true, value: envelope['result'] }
    }

    const parameters = envelope === null ? null : asRecord(envelope['parameters'])
    const description =
      envelope !== null && typeof envelope['description'] === 'string'
        ? envelope['description']
        : ''
    return failure({
      code: 'telegram.rejected',
      status: response.status,
      errorCode: envelope === null ? null : asNumber(envelope['error_code']),
      retryAfterSeconds: parameters === null ? null : asNumber(parameters['retry_after']),
      fileTooBig: /file is too big/iu.test(description),
    })
  }
}

/** The context a log line may carry about a failure: a code and numbers, never a message from the service. */
export const describeFailure = (error: TelegramApiError): LogContext => ({
  code: error.code,
  status: error.status,
  errorCode: error.errorCode,
})
