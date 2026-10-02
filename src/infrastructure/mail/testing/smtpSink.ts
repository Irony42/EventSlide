import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { createServer as createTlsServer } from 'node:tls'

/**
 * A relay that lives inside the test process: a real TCP listener speaking enough SMTP
 * for `nodemailer` to hand it a message, and nothing more (G2-07 / P3-08).
 *
 * It exists so the SMTP adapter is tested over a **socket**, against what actually arrives
 * at the other end of the conversation, instead of against `nodemailer`'s own transports
 * (`jsonTransport`, `streamTransport`), which skip the part that has the bugs: connecting,
 * the greeting, authenticating, the envelope, dot-stuffing, and a relay that refuses a
 * recipient or says nothing at all. It needs no dependency — the protocol is a dozen
 * commands and this is under two hundred lines.
 *
 * Deliberately not an SMTP server: no STARTTLS, no pipelining, no size limits, one
 * connection at a time is the only case exercised. It is a test double, and the
 * `Mailer` contract suite is what keeps it honest — a sink that decoded a header wrongly
 * would fail the case that sends an accent through it.
 */

export interface ReceivedMessage {
  /** `MAIL FROM`, from the envelope. */
  readonly envelopeFrom: string
  /** Every `RCPT TO` the relay accepted. The authoritative answer to "who got it". */
  readonly envelopeTo: readonly string[]
  /** The message exactly as it came over the wire, dot-unstuffed, headers and all. */
  readonly raw: string
}

export interface SmtpSinkOptions {
  /** When set, the relay advertises AUTH, refuses mail before a login, and checks this pair. */
  readonly auth?: { readonly user: string; readonly pass: string }
  /** `never`: accept the connection and say nothing, as a relay that has hung does. */
  readonly greeting?: 'normal' | 'never'
  /** `hang`: take the message, then never answer the end of DATA. */
  readonly afterData?: 'accept' | 'hang'
  /**
   * Speak TLS from the first byte, as an `smtps://` relay does, with this key and certificate.
   * The test supplies a self-signed pair, which is the point: the adapter must refuse it.
   */
  readonly tls?: { readonly key: string; readonly cert: string }
}

export interface SmtpSink {
  readonly port: number
  /** Every message the relay accepted, oldest first. */
  readonly messages: readonly ReceivedMessage[]
  /** Every login attempted, correct or not. */
  readonly logins: readonly { readonly user: string; readonly pass: string }[]
  /** How many connections the relay has accepted: zero is "nobody ever dialled it". */
  readonly connections: number
  /**
   * The next `RCPT TO` is answered with this code, once: a 5xx is a mailbox that does not
   * exist, a 4xx is a relay that cannot take it right now. The reply text **names the
   * recipient**, as real relays do, which is what the log canary needs to see survive.
   */
  refuseNextRecipient(code: number): void
  /** The next message is taken and its end never answered, once; later ones are accepted. */
  hangNextMessage(): void
  close(): Promise<void>
}

const CRLF = '\r\n'
/** Separates the fields of an AUTH PLAIN payload. Built, so no editor or tool can alter it. */
const NUL = String.fromCharCode(0)

export const startSmtpSink = async (options: SmtpSinkOptions = {}): Promise<SmtpSink> => {
  const messages: ReceivedMessage[] = []
  const logins: { user: string; pass: string }[] = []
  const sockets = new Set<Socket>()
  const refusals: number[] = []
  let connections = 0
  let hangs = 0

  const serve = (socket: Socket): void => {
    connections += 1
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    // A client that hangs up mid-sentence is part of the cases under test.
    socket.on('error', () => {})
    socket.setEncoding('utf8')

    const reply = (line: string): void => {
      socket.write(`${line}${CRLF}`)
    }

    let pending = ''
    let phase: 'command' | 'data' | 'authPlain' | 'authLoginUser' | 'authLoginPass' = 'command'
    let authenticated = options.auth === undefined
    let loginUser = ''
    let envelopeFrom = ''
    let envelopeTo: string[] = []
    let dataLines: string[] = []

    const login = (user: string, pass: string): void => {
      logins.push({ user, pass })
      const ok = user === options.auth?.user && pass === options.auth.pass
      authenticated = ok
      reply(
        ok ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication credentials invalid',
      )
      phase = 'command'
    }

    const decodeBase64 = (text: string): string => Buffer.from(text, 'base64').toString('utf8')

    const onCommand = (line: string): void => {
      const verb = line.split(' ', 1)[0]?.toUpperCase() ?? ''

      if (verb === 'EHLO') {
        reply('250-sink.test greets you')
        if (options.auth !== undefined) reply('250-AUTH PLAIN LOGIN')
        reply('250 8BITMIME')
      } else if (verb === 'HELO') {
        reply('250 sink.test')
      } else if (verb === 'AUTH') {
        const [, method = '', initial] = line.split(' ')
        if (method.toUpperCase() === 'PLAIN') {
          if (initial === undefined) {
            phase = 'authPlain'
            reply('334 ')
          } else {
            const [, user = '', pass = ''] = decodeBase64(initial).split(NUL)
            login(user, pass)
          }
        } else if (method.toUpperCase() === 'LOGIN') {
          phase = 'authLoginUser'
          reply('334 VXNlcm5hbWU6')
        } else {
          reply('504 5.5.4 Unrecognized authentication type')
        }
      } else if (verb === 'MAIL') {
        if (!authenticated) {
          reply('530 5.7.0 Authentication required')
          return
        }
        envelopeFrom = /^MAIL FROM:\s*<([^>]*)>/i.exec(line)?.[1] ?? ''
        envelopeTo = []
        reply('250 2.1.0 Sender ok')
      } else if (verb === 'RCPT') {
        const recipient = /^RCPT TO:\s*<([^>]*)>/i.exec(line)?.[1] ?? ''
        const refusal = refusals.shift()
        if (refusal !== undefined) {
          // The shape of a real refusal, enhanced status code and all, naming the mailbox.
          const enhanced = refusal >= 500 ? '5.1.1' : '4.2.0'
          reply(`${refusal} ${enhanced} <${recipient}>: Recipient address rejected`)
        } else {
          envelopeTo.push(recipient)
          reply('250 2.1.5 Recipient ok')
        }
      } else if (verb === 'DATA') {
        if (envelopeTo.length === 0) {
          reply('503 5.5.1 Need RCPT first')
        } else {
          dataLines = []
          phase = 'data'
          reply('354 End data with <CR><LF>.<CR><LF>')
        }
      } else if (verb === 'RSET' || verb === 'NOOP') {
        envelopeTo = []
        reply('250 2.0.0 Ok')
      } else if (verb === 'QUIT') {
        reply('221 2.0.0 Bye')
        socket.end()
      } else {
        reply('502 5.5.2 Command not implemented')
      }
    }

    const onLine = (line: string): void => {
      if (phase === 'command') return onCommand(line)

      if (phase === 'data') {
        if (line !== '.') {
          // Dot-unstuffing (RFC 5321 §4.5.2): a line that began with a dot has had one added.
          dataLines.push(line.startsWith('..') ? line.slice(1) : line)
          return
        }
        messages.push({ envelopeFrom, envelopeTo, raw: dataLines.join(CRLF) + CRLF })
        envelopeTo = []
        phase = 'command'
        if (hangs > 0) hangs -= 1
        else if (options.afterData !== 'hang') reply('250 2.0.0 Queued')
        return
      }

      if (phase === 'authPlain') {
        const [, user = '', pass = ''] = decodeBase64(line).split(NUL)
        return login(user, pass)
      }
      if (phase === 'authLoginUser') {
        loginUser = decodeBase64(line)
        phase = 'authLoginPass'
        return reply('334 UGFzc3dvcmQ6')
      }
      return login(loginUser, decodeBase64(line))
    }

    socket.on('data', (chunk: string) => {
      pending += chunk
      let end = pending.indexOf(CRLF)
      while (end !== -1) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + CRLF.length)
        onLine(line)
        end = pending.indexOf(CRLF)
      }
    })

    if (options.greeting !== 'never') reply('220 sink.test ESMTP ready')
  }

  const server: Server =
    options.tls === undefined ? createServer(serve) : createTlsServer(options.tls, serve)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  return {
    port: (server.address() as AddressInfo).port,
    messages,
    logins,
    get connections() {
      return connections
    },
    refuseNextRecipient: (code) => {
      refusals.push(code)
    },
    hangNextMessage: () => {
      hangs += 1
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/* -------------------------------------------------------------------------- *
 * Reading a message back. Only what `nodemailer` writes for a text message and
 * a text-plus-HTML one: unfolded headers, RFC 2047 words in UTF-8, one level of
 * multipart/alternative, and the three transfer encodings it picks between.
 * -------------------------------------------------------------------------- */

export interface ParsedMessage {
  /** The `From:` header, decoded: a display name and an address in angle brackets, or a bare address. */
  readonly from: string
  readonly subject: string
  readonly text: string | null
  readonly html: string | null
}

/** `=XX` escapes to bytes, `_` to a space when `q` says so, then the bytes read as UTF-8. */
const decodeQuotedPrintable = (input: string, underscoreIsSpace: boolean): string => {
  const bytes: number[] = []
  for (let at = 0; at < input.length; at += 1) {
    const char = input.charAt(at)
    const hex = input.slice(at + 1, at + 3)
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      at += 2
    } else if (char === '_' && underscoreIsSpace) {
      bytes.push(0x20)
    } else {
      bytes.push(...Buffer.from(char, 'utf8'))
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

const decodeEncodedWords = (value: string): string =>
  // Two encoded words separated only by folding whitespace are one word (RFC 2047 §6.2).
  value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_match, encoding: string, payload: string) =>
      encoding.toLowerCase() === 'b'
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeQuotedPrintable(payload, true),
    )

const splitHead = (entity: string): { headers: Map<string, string>; body: string } => {
  const split = entity.indexOf(`${CRLF}${CRLF}`)
  const head = split === -1 ? entity : entity.slice(0, split)
  const body = split === -1 ? '' : entity.slice(split + 4)
  const headers = new Map<string, string>()
  // A line that starts with whitespace continues the header above it.
  for (const line of head.replace(/\r\n[ \t]+/g, ' ').split(CRLF)) {
    const colon = line.indexOf(':')
    if (colon > 0)
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  return { headers, body }
}

const decodeBody = (body: string, encoding: string | undefined): string => {
  const kind = encoding?.toLowerCase()
  const decoded =
    kind === 'base64'
      ? Buffer.from(body, 'base64').toString('utf8')
      : kind === 'quoted-printable'
        ? decodeQuotedPrintable(body.replace(/=\r\n/g, ''), false)
        : body
  // Line endings and the one the transport adds at the end are the wire's, not the author's.
  return decoded.replace(/\r\n/g, '\n').replace(/\n$/, '')
}

export const parseMessage = (raw: string): ParsedMessage => {
  const { headers, body } = splitHead(raw)
  const subject = decodeEncodedWords(headers.get('subject') ?? '')
  const from = decodeEncodedWords(headers.get('from') ?? '')
  const type = headers.get('content-type') ?? 'text/plain'

  const parts: { type: string; text: string }[] = []
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1]
  if (type.toLowerCase().startsWith('multipart/') && boundary !== undefined) {
    for (const segment of body.split(`--${boundary}`).slice(1)) {
      if (segment.startsWith('--')) break
      const part = splitHead(segment.replace(/^\r\n/, ''))
      parts.push({
        type:
          (part.headers.get('content-type') ?? 'text/plain').split(';')[0]?.trim().toLowerCase() ??
          '',
        text: decodeBody(
          part.body.replace(/\r\n$/, ''),
          part.headers.get('content-transfer-encoding'),
        ),
      })
    }
  } else {
    parts.push({
      type: type.split(';')[0]?.trim().toLowerCase() ?? '',
      text: decodeBody(body, headers.get('content-transfer-encoding')),
    })
  }

  return {
    from,
    subject,
    text: parts.find((part) => part.type === 'text/plain')?.text ?? null,
    html: parts.find((part) => part.type === 'text/html')?.text ?? null,
  }
}
