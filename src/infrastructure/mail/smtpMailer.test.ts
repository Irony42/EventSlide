import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTransport, type SMTPTransportOptions } from 'nodemailer'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { LogContext, Logger } from '../../application/ports/logger'
import type { OutgoingMail } from '../../application/ports/mailer'
import { mailerContract } from '../../application/testing/contracts/mailerContract'
import { EmailAddress } from '../../domain/users/emailAddress'
import { silentLogger } from '../logging/pinoLogger'
import { parseSmtpUrl, type Mailbox, type SmtpEndpoint, type SmtpSettings } from './smtpEndpoint'
import {
  DEFAULT_MAIL_TIMEOUTS,
  classifyMailError,
  createSmtpMailer,
  describeFailure,
  transportOptionsFor,
  type MailTimeouts,
  type TransportFactory,
} from './smtpMailer'
import {
  parseMessage,
  startSmtpSink,
  type SmtpSink,
  type SmtpSinkOptions,
} from './testing/smtpSink'

/**
 * Ring 3: the SMTP adapter over a real socket to an in-process relay
 * (`testing/smtpSink.ts`), so what is asserted on is what arrived at the other end of an
 * SMTP conversation and not what the adapter says it did.
 *
 * Three things have their own section because each was a way to get this wrong that no
 * other test would notice: timeouts (a relay that never answers must not hold a request),
 * the mapping of a failure to `rejected` or `transient` (the caller's decision to retry
 * hangs on it), and the log canary (a reset link in a log line is a leaked credential).
 */

/**
 * Generous enough that a loaded CI machine does not trip them on a conversation that is
 * working, and short enough that a case which is *meant* to wait for one finishes in
 * well under the test timeout.
 */
const ORDINARY: MailTimeouts = {
  connectMs: 3_000,
  greetingMs: 3_000,
  inactivityMs: 3_000,
  totalMs: 6_000,
}

const FROM: Mailbox = { name: null, address: 'no-reply@photos.example.org' }

const endpointFor = (port: number, overrides: Partial<SmtpEndpoint> = {}): SmtpEndpoint => ({
  host: '127.0.0.1',
  port,
  implicitTls: false,
  credentials: null,
  ...overrides,
})

const settingsFor = (port: number, overrides: Partial<SmtpEndpoint> = {}): SmtpSettings => ({
  endpoint: endpointFor(port, overrides),
  from: FROM,
})

const to = (address: string): EmailAddress => {
  const parsed = EmailAddress.create(address)
  if (!parsed.ok) throw new Error(`invalid fixture: ${parsed.error.code}`)
  return parsed.value
}

const aMail = (overrides: Partial<OutgoingMail> = {}): OutgoingMail => ({
  to: to('camille@example.org'),
  subject: 'Your invitation',
  text: 'Open the link to choose a password.',
  ...overrides,
})

interface RecordedLine {
  readonly level: string
  readonly message: string
  readonly context: LogContext
}

/** Keeps the context, which the repository's own `CapturingLogger` drops — and the context is the point. */
class RecordingLogger implements Logger {
  readonly lines: RecordedLine[] = []

  debug(message: string, context: LogContext = {}): void {
    this.lines.push({ level: 'debug', message, context })
  }

  info(message: string, context: LogContext = {}): void {
    this.lines.push({ level: 'info', message, context })
  }

  warn(message: string, context: LogContext = {}): void {
    this.lines.push({ level: 'warn', message, context })
  }

  error(message: string, context: LogContext = {}): void {
    this.lines.push({ level: 'error', message, context })
  }

  child(_bindings: LogContext): Logger {
    return this
  }
}

/** Sinks opened by a case, closed after it, so a failing assertion never leaks a listener. */
const open: SmtpSink[] = []

const sink = async (options?: SmtpSinkOptions): Promise<SmtpSink> => {
  const started = await startSmtpSink(options)
  open.push(started)
  return started
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((started) => started.close()))
})

mailerContract('smtp, against an in-process relay', 'delivers', async () => {
  const relay = await startSmtpSink()
  const mailer = createSmtpMailer({
    settings: settingsFor(relay.port),
    logger: silentLogger(),
    timeouts: ORDINARY,
  })
  return {
    mailer,
    delivered: async () =>
      relay.messages.map((message) => {
        const parsed = parseMessage(message.raw)
        return {
          // The envelope, not the `To:` header: it is what decides who actually receives it.
          to: message.envelopeTo.join(','),
          subject: parsed.subject,
          text: parsed.text ?? '',
          html: parsed.html,
        }
      }),
    provoke: async (reason) => {
      relay.refuseNextRecipient(reason === 'rejected' ? 550 : 451)
    },
    dispose: () => relay.close(),
  }
})

describe('createSmtpMailer: the sender and the login', () => {
  it('logs in with the credentials read from the URL, percent-decoded', async () => {
    const relay = await sink({ auth: { user: 'ca@mille', pass: 'p@ss/w:rd' } })
    const endpoint = parseSmtpUrl(`smtp://ca%40mille:p%40ss%2Fw%3Ard@127.0.0.1:${relay.port}`)
    if (!endpoint.ok) throw new Error(endpoint.error)
    const mailer = createSmtpMailer({
      settings: { endpoint: endpoint.value, from: FROM },
      logger: silentLogger(),
      timeouts: ORDINARY,
    })

    const result = await mailer.send(aMail())

    expect(result.ok).toBe(true)
    expect(relay.logins).toEqual([{ user: 'ca@mille', pass: 'p@ss/w:rd' }])
    expect(relay.messages).toHaveLength(1)
  })

  it('fails with mail.rejected, never transient, when the relay refuses the credentials', async () => {
    // Retrying a wrong password only repeats it, and locks the account sooner.
    const relay = await sink({ auth: { user: 'camille', pass: 'right' } })
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port, {
        credentials: { username: 'camille', password: 'wrong' },
      }),
      logger: silentLogger(),
      timeouts: ORDINARY,
    })

    const result = await mailer.send(aMail())

    expect(!result.ok && result.error.code).toBe('mail.rejected')
    expect(relay.messages).toEqual([])
  })

  it('fails with mail.rejected when the relay demands a login and none is configured', async () => {
    const relay = await sink({ auth: { user: 'camille', pass: 'right' } })
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port),
      logger: silentLogger(),
      timeouts: ORDINARY,
    })

    const result = await mailer.send(aMail())

    expect(!result.ok && result.error.code).toBe('mail.rejected')
    expect(relay.messages).toEqual([])
  })

  it('sends from the configured address, and carries a display name in the From header', async () => {
    const relay = await sink()
    const mailer = createSmtpMailer({
      settings: {
        endpoint: endpointFor(relay.port),
        from: { name: 'Studio Éclair', address: 'no-reply@photos.example.org' },
      },
      logger: silentLogger(),
      timeouts: ORDINARY,
    })

    await mailer.send(aMail())

    const [message] = relay.messages
    expect(message?.envelopeFrom).toBe('no-reply@photos.example.org')
    expect(parseMessage(message?.raw ?? '').from).toBe(
      'Studio Éclair <no-reply@photos.example.org>',
    )
  })

  it('sends to exactly one recipient, in the envelope and in the header', async () => {
    const relay = await sink()
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port),
      logger: silentLogger(),
      timeouts: ORDINARY,
    })

    await mailer.send(aMail())

    const [message] = relay.messages
    expect(message?.envelopeTo).toEqual(['camille@example.org'])
    expect(message?.raw).toMatch(/^To: .*camille@example\.org/m)
    expect(message?.raw).not.toMatch(/^(Cc|Bcc): /im)
  })
})

describe('createSmtpMailer: a relay that is not there, or does not answer', () => {
  const elapsedFor = async (run: () => Promise<unknown>): Promise<number> => {
    const started = performance.now()
    await run()
    return performance.now() - started
  }

  it('answers mail.transient, and does not throw, when nothing is listening', async () => {
    const relay = await startSmtpSink()
    const { port } = relay
    await relay.close()
    const mailer = createSmtpMailer({
      settings: settingsFor(port),
      logger: silentLogger(),
      timeouts: ORDINARY,
    })

    const result = await mailer.send(aMail())

    expect(!result.ok && result.error.code).toBe('mail.transient')
  })

  it('gives up on a relay that accepts the connection and never greets, within the greeting timeout', async () => {
    const relay = await sink({ greeting: 'never' })
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port),
      logger: silentLogger(),
      timeouts: { connectMs: 5_000, greetingMs: 200, inactivityMs: 5_000, totalMs: 8_000 },
    })

    let code: string | null = null
    const elapsed = await elapsedFor(async () => {
      const result = await mailer.send(aMail())
      code = result.ok ? null : result.error.code
    })

    expect(code).toBe('mail.transient')
    expect(elapsed).toBeLessThan(3_000)
  })

  it('gives up on a relay that goes silent in the middle of a message, within the inactivity timeout', async () => {
    const relay = await sink({ afterData: 'hang' })
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port),
      logger: silentLogger(),
      timeouts: { connectMs: 5_000, greetingMs: 5_000, inactivityMs: 200, totalMs: 8_000 },
    })

    let code: string | null = null
    const elapsed = await elapsedFor(async () => {
      const result = await mailer.send(aMail())
      code = result.ok ? null : result.error.code
    })

    expect(code).toBe('mail.transient')
    expect(elapsed).toBeLessThan(3_000)
  })

  it('stops waiting at the overall deadline even when every other timeout is generous', async () => {
    // A relay that answers a byte every few seconds is never "silent", so the inactivity
    // timeout never fires; only a bound on the whole call ends it.
    const relay = await sink({ afterData: 'hang' })
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port),
      logger: silentLogger(),
      timeouts: { connectMs: 30_000, greetingMs: 30_000, inactivityMs: 60_000, totalMs: 300 },
    })

    let code: string | null = null
    const elapsed = await elapsedFor(async () => {
      const result = await mailer.send(aMail())
      code = result.ok ? null : result.error.code
    })

    expect(code).toBe('mail.transient')
    expect(elapsed).toBeLessThan(3_000)
  })

  it('is still usable after a send that hit the deadline, on the same instance', async () => {
    const relay = await sink()
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port),
      logger: silentLogger(),
      timeouts: { connectMs: 3_000, greetingMs: 3_000, inactivityMs: 60_000, totalMs: 300 },
    })
    relay.hangNextMessage()

    const first = await mailer.send(aMail({ subject: 'Hangs' }))
    const second = await mailer.send(aMail({ subject: 'Goes through' }))

    expect(!first.ok && first.error.code).toBe('mail.transient')
    expect(second.ok).toBe(true)
    // The first message was taken by the relay before it stopped answering — which is the
    // "transient does not mean unsent" caveat in `MailTimeouts.totalMs`, observed.
    expect(relay.messages.map((message) => parseMessage(message.raw).subject)).toEqual([
      'Hangs',
      'Goes through',
    ])
  })

  it('answers mail.transient, and does not throw, when given something that is not a message', async () => {
    const logger = new RecordingLogger()
    const mailer = createSmtpMailer({ settings: settingsFor(1), logger, timeouts: ORDINARY })

    const result = await mailer.send({} as unknown as OutgoingMail)

    expect(!result.ok && result.error.code).toBe('mail.transient')
    expect(logger.lines).toEqual([
      { level: 'error', message: 'mail failed unexpectedly', context: {} },
    ])
  })
})

describe('transportOptionsFor', () => {
  const optionsFor = (endpoint: Partial<SmtpEndpoint>) =>
    transportOptionsFor(
      {
        endpoint: {
          host: 'mail.example.com',
          port: 587,
          implicitTls: false,
          credentials: null,
          ...endpoint,
        },
        from: FROM,
      },
      DEFAULT_MAIL_TIMEOUTS,
    )

  it('requires the STARTTLS upgrade for an smtp URL to any host that is not this machine', () => {
    // Without it nodemailer upgrades only if the relay happens to advertise STARTTLS, and
    // otherwise sends the login in the clear.
    expect(optionsFor({ host: 'mail.example.com' })).toMatchObject({
      requireTLS: true,
      secure: false,
    })
    expect(optionsFor({ host: '10.0.0.5' })).toMatchObject({ requireTLS: true })
  })

  it.each(['localhost', '127.0.0.1', '::1'])(
    'lets an smtp URL to %s stay plain, which is a local relay such as MailHog',
    (host) => {
      expect(optionsFor({ host })).toMatchObject({ requireTLS: false, secure: false })
    },
  )

  it('uses implicit TLS for smtps, and then has nothing to upgrade', () => {
    expect(optionsFor({ implicitTls: true, port: 465 })).toMatchObject({
      secure: true,
      requireTLS: false,
    })
  })

  it('passes the credentials as an auth pair, and sends none when there are none', () => {
    expect(optionsFor({ credentials: { username: 'camille', password: 's3cret' } }).auth).toEqual({
      user: 'camille',
      pass: 's3cret',
    })
    expect(optionsFor({})).not.toHaveProperty('auth')
  })

  it('hands nodemailer a host and a port, never a URL it could read options out of', () => {
    const options = optionsFor({ host: 'mail.example.com', port: 2525 })

    expect(options).toMatchObject({ host: 'mail.example.com', port: 2525 })
    expect(options).not.toHaveProperty('url')
    expect(options).not.toHaveProperty('service')
  })

  it('bounds every phase of the conversation, each well under nodemailer’s own defaults', () => {
    const options = optionsFor({})

    // Its defaults are two minutes to connect, thirty seconds for a greeting and ten
    // minutes of silence.
    expect(options.connectionTimeout).toBe(DEFAULT_MAIL_TIMEOUTS.connectMs)
    expect(options.dnsTimeout).toBe(DEFAULT_MAIL_TIMEOUTS.connectMs)
    expect(options.greetingTimeout).toBe(DEFAULT_MAIL_TIMEOUTS.greetingMs)
    expect(options.socketTimeout).toBe(DEFAULT_MAIL_TIMEOUTS.inactivityMs)
    expect(DEFAULT_MAIL_TIMEOUTS.connectMs).toBeLessThanOrEqual(30_000)
    expect(DEFAULT_MAIL_TIMEOUTS.greetingMs).toBeLessThanOrEqual(30_000)
    expect(DEFAULT_MAIL_TIMEOUTS.inactivityMs).toBeLessThanOrEqual(60_000)
    // A person is waiting behind this one: it is what the docs promise as the worst case.
    expect(DEFAULT_MAIL_TIMEOUTS.totalMs).toBeLessThanOrEqual(30_000)
  })

  it('leaves nodemailer’s logging off, because with debug it prints the message and the login', () => {
    const options = optionsFor({})

    expect(options.logger).toBe(false)
    expect(options.debug).toBe(false)
  })

  it('forbids the library to read a file or fetch a URL on a message’s behalf', () => {
    const options = optionsFor({})

    expect(options.disableFileAccess).toBe(true)
    expect(options.disableUrlAccess).toBe(true)
  })

  it('passes exactly these options and no others, so a new one has to be argued for in a diff to this test', () => {
    // Every TLS rule is an absence: no `tls` (which is where `rejectUnauthorized: false`
    // would go), no `ignoreTLS`, no `opportunisticTLS`, no `url`, no `proxy`. Listing the
    // keys is what makes an absence something a test can see.
    const bare = Object.keys(optionsFor({})).sort()
    const withLogin = Object.keys(
      optionsFor({ credentials: { username: 'camille', password: 's3cret' } }),
    ).sort()

    expect(bare).toEqual([
      'connectionTimeout',
      'debug',
      'disableFileAccess',
      'disableUrlAccess',
      'dnsTimeout',
      'greetingTimeout',
      'host',
      'logger',
      'port',
      'requireTLS',
      'secure',
      'socketTimeout',
    ])
    expect(withLogin).toEqual([...bare, 'auth'].sort())
  })
})

describe('createSmtpMailer: what actually reaches the library', () => {
  const record = (): { seen: SMTPTransportOptions[]; transport: TransportFactory } => {
    const seen: SMTPTransportOptions[] = []
    return {
      seen,
      transport: (options) => {
        seen.push(options)
        return createTransport(options)
      },
    }
  }

  it('builds its transporter from exactly what transportOptionsFor computed, with nothing added at the call site', () => {
    // The TLS rules are options, and a function that returns the right ones proves nothing
    // about the call that uses it: `tls: { rejectUnauthorized: false }` spread in at
    // `createTransport(...)` leaves every test of the function above green.
    const { seen, transport } = record()
    const settings = settingsFor(2525, {
      host: 'mail.example.com',
      credentials: { username: 'u', password: 'p' },
    })

    createSmtpMailer({ settings, logger: silentLogger(), timeouts: ORDINARY, transport })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toStrictEqual(transportOptionsFor(settings, ORDINARY))
  })

  it('never turns certificate checking, STARTTLS or the library’s own logging off', () => {
    const { seen, transport } = record()

    createSmtpMailer({
      settings: settingsFor(587, { host: 'mail.example.com' }),
      logger: silentLogger(),
      timeouts: ORDINARY,
      transport,
    })

    const options = seen[0]
    expect(options).toMatchObject({ requireTLS: true, secure: false, logger: false, debug: false })
    for (const absent of ['tls', 'ignoreTLS', 'opportunisticTLS', 'url', 'proxy', 'service']) {
      expect(options, absent).not.toHaveProperty(absent)
    }
  })
})

/**
 * Certificate checking, over a real TLS handshake.
 *
 * It is on because the library's default is on, and the only thing that can turn it off is an
 * option this adapter never passes — which the exact-keys test above asserts, and which this
 * asserts again from the other end: a relay with a self-signed certificate is refused, no
 * login is sent to it (the point of checking a certificate is that the password goes to the
 * right machine), and the failure is permanent. The self-signed pair is made here with the
 * `openssl` that CI images and developer machines carry, rather than committed: a private
 * key in the tree is a thing scanners flag whether or not it is a test's.
 */
const hasOpenssl = ((): boolean => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasOpenssl)('a relay whose certificate this box does not trust', () => {
  let directory = ''
  let key = ''
  let cert = ''

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'eventslide-tls-'))
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    )
    key = readFileSync(join(directory, 'key.pem'), 'utf8')
    cert = readFileSync(join(directory, 'cert.pem'), 'utf8')
  })

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  const login = { username: 'camille', password: 'right' }

  it('refuses a self-signed certificate: permanent, no login sent, no message sent, and the log says why', async () => {
    const relay = await sink({ tls: { key, cert }, auth: { user: 'camille', pass: 'right' } })
    const logger = new RecordingLogger()
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port, { implicitTls: true, credentials: login }),
      logger,
      timeouts: ORDINARY,
    })

    const result = await mailer.send(aMail())

    expect(!result.ok && result.error.code).toBe('mail.rejected')
    expect(relay.logins).toEqual([])
    expect(relay.messages).toEqual([])
    // A flag, never the library's wording: that message names the host and the chain.
    expect(logger.lines).toEqual([
      {
        level: 'warn',
        message: 'mail not sent',
        context: {
          reason: 'rejected',
          recipientDomain: 'example.org',
          errorCode: 'ESOCKET',
          command: 'CONN',
          tlsCertificate: true,
        },
      },
    ])
  })

  it('is a relay that works: the same send succeeds once checking is switched off, so the refusal above is the check', async () => {
    // The control. It builds the transporter by hand with the option this adapter must never
    // pass, to show the relay, the login and the message are all fine and only the
    // certificate stood in the way.
    const relay = await sink({ tls: { key, cert }, auth: { user: 'camille', pass: 'right' } })
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port, { implicitTls: true, credentials: login }),
      logger: silentLogger(),
      timeouts: ORDINARY,
      transport: (options) => createTransport({ ...options, tls: { rejectUnauthorized: false } }),
    })

    const result = await mailer.send(aMail())

    expect(result.ok).toBe(true)
    expect(relay.logins).toEqual([{ user: 'camille', pass: 'right' }])
    expect(relay.messages).toHaveLength(1)
  })
})

describe('describeFailure', () => {
  it('keeps the library code, the relay’s numeric reply and the name of the command', () => {
    const error = Object.assign(new Error('Recipient address rejected'), {
      code: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO',
    })

    expect(describeFailure(error)).toEqual({
      errorCode: 'EENVELOPE',
      smtpCode: 550,
      command: 'RCPT TO',
    })
  })

  it('drops everything else an error from the library carries, each of which can name the mailbox', () => {
    const error = Object.assign(
      new Error('550 5.1.1 <camille@example.org>: Recipient address rejected'),
      {
        code: 'EENVELOPE',
        response: '550 5.1.1 <camille@example.org>: Recipient address rejected',
        recipient: 'camille@example.org',
        rejected: ['camille@example.org'],
        rejectedErrors: [new Error('camille@example.org')],
        sourceUrl: 'https://photos.example.org/reset/LINK-CANARY',
      },
    )

    expect(JSON.stringify(describeFailure(error))).not.toMatch(/camille|LINK-CANARY|Recipient/)
  })

  it('drops a command that is more than a command’s name, so a library that put the whole line there cannot leak the address', () => {
    const error = Object.assign(new Error('x'), {
      code: 'EENVELOPE',
      command: 'RCPT TO:<camille@example.org>',
    })

    expect(describeFailure(error)).toEqual({ errorCode: 'EENVELOPE' })
  })

  it('flags a certificate the box did not accept, without repeating what the library said about it', () => {
    const error = Object.assign(
      new Error("Hostname/IP does not match certificate's altnames: Host: a."),
      { code: 'ESOCKET', command: 'CONN' },
    )

    expect(describeFailure(error)).toEqual({
      errorCode: 'ESOCKET',
      command: 'CONN',
      tlsCertificate: true,
    })
  })

  it('does not flag an ordinary connection failure', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:465'), {
      code: 'ESOCKET',
      command: 'CONN',
    })

    expect(describeFailure(error)).toEqual({ errorCode: 'ESOCKET', command: 'CONN' })
  })

  it.each([
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('says nothing about %s, which is not an error object', (_name, value) => {
    expect(describeFailure(value)).toEqual({})
  })

  it('ignores fields of the wrong type rather than logging them', () => {
    const error = Object.assign(new Error('x'), { code: 7, responseCode: '550', command: 42 })

    expect(describeFailure(error)).toEqual({})
  })
})

describe('classifyMailError', () => {
  const failure = (fields: Record<string, unknown>): Error => Object.assign(new Error('x'), fields)

  it.each([
    ['a 550 mailbox that does not exist', { code: 'EENVELOPE', responseCode: 550 }],
    ['a 535 refused login', { code: 'EAUTH', responseCode: 535 }],
    ['a 554 greeting that refuses the client', { code: 'EPROTOCOL', responseCode: 554 }],
    ['a 500 reply whatever the code says', { code: 'ETIMEDOUT', responseCode: 500 }],
  ])('treats %s as rejected: it is permanent', (_name, fields) => {
    expect(classifyMailError(failure(fields))).toBe('rejected')
  })

  it.each([
    ['a 451 try again later', { code: 'EENVELOPE', responseCode: 451 }],
    ['a 421 service closing', { code: 'ECONNECTION', responseCode: 421 }],
    ['a 454 temporary authentication failure', { code: 'EAUTH', responseCode: 454 }],
    ['a 400 reply', { responseCode: 400 }],
  ])('treats %s as transient: the relay itself said to try again', (_name, fields) => {
    expect(classifyMailError(failure(fields))).toBe('transient')
  })

  it.each([
    ['a self-signed certificate', 'self-signed certificate; if the root CA is installed locally'],
    [
      'one signed by an authority this box does not trust',
      'unable to get local issuer certificate',
    ],
    ['an incomplete chain', 'unable to verify the first certificate'],
    ['an expired certificate', 'certificate has expired'],
    [
      'one issued to another name',
      "Hostname/IP does not match certificate's altnames: Host: a. is not in the cert's altnames: DNS:b",
    ],
  ])('treats %s as rejected: it stays wrong until the operator acts', (_name, message) => {
    expect(classifyMailError(failure({ code: 'ESOCKET', command: 'CONN', message }))).toBe(
      'rejected',
    )
    expect(classifyMailError(failure({ code: 'ETLS', command: 'CONN', message }))).toBe('rejected')
  })

  it.each([
    ['a refused connection', 'connect ECONNREFUSED 127.0.0.1:465'],
    ['a reset', 'read ECONNRESET'],
    ['a name that does not resolve', 'getaddrinfo ENOTFOUND mail.example.com'],
  ])('keeps %s transient: nothing in it says the certificate is the problem', (_name, message) => {
    expect(classifyMailError(failure({ code: 'ESOCKET', command: 'CONN', message }))).toBe(
      'transient',
    )
  })

  it('lets a 4xx reply decide before the wording of a message does', () => {
    expect(
      classifyMailError(
        failure({ code: 'ETLS', responseCode: 454, message: 'certificate has expired' }),
      ),
    ).toBe('transient')
  })

  it.each(['EAUTH', 'ENOAUTH', 'EENVELOPE', 'EREQUIRETLS', 'ECONFIG'])(
    'treats the library code %s, with no reply to read, as rejected',
    (code) => {
      expect(classifyMailError(failure({ code }))).toBe('rejected')
    },
  )

  it.each(['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ETLS', 'EPROTOCOL', 'ECONNREFUSED'])(
    'treats the library code %s as transient',
    (code) => {
      expect(classifyMailError(failure({ code }))).toBe('transient')
    },
  )

  it.each([
    ['a plain error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
  ])('treats %s as transient, the safer thing to tell a caller than never', (_name, value) => {
    expect(classifyMailError(value)).toBe('transient')
  })

  it('ignores a reply code that is not a number', () => {
    expect(classifyMailError(failure({ code: 'EAUTH', responseCode: '535' }))).toBe('rejected')
    expect(classifyMailError(failure({ code: 'ETIMEDOUT', responseCode: '550' }))).toBe('transient')
  })
})

/**
 * The canary.
 *
 * A password-reset link is a credential, and a log line is kept by whatever ships the
 * logs. Every value below is distinctive enough that finding it anywhere in what the
 * adapter logged **or returned** is conclusive, and every one of them is also in the
 * message or the relay's own reply — because `nodemailer` appends that reply to the error
 * it throws, and a real relay's reply names the recipient.
 */
const CANARY = {
  localPart: 'canary-local-7f3a9c',
  domain: 'recipient-domain.example',
  subject: 'SUBJECT-CANARY-31b8',
  text: 'BODY-CANARY-55d2',
  html: 'HTML-CANARY-77aa',
  link: 'LINK-CANARY-e91c',
  user: 'USER-CANARY-b00b',
  password: 'PASSWORD-CANARY-c0ffee',
  relayWording: 'Recipient address rejected',
} as const

describe('createSmtpMailer: nothing but the recipient’s domain reaches a log', () => {
  const recipient = `${CANARY.localPart}@${CANARY.domain}`
  const canaryMail = (overrides: Partial<OutgoingMail> = {}): OutgoingMail => ({
    to: to(recipient),
    subject: CANARY.subject,
    text: `${CANARY.text} https://photos.example.org/invite/${CANARY.link}`,
    html: `<p>${CANARY.html} <a href="https://photos.example.org/reset/${CANARY.link}">open</a></p>`,
    ...overrides,
  })
  const credentials = { username: CANARY.user, password: CANARY.password }

  /** Runs every way a send can end, against real relays, through one logger. */
  const runEveryOutcome = async () => {
    const logger = new RecordingLogger()
    const results: Awaited<ReturnType<ReturnType<typeof createSmtpMailer>['send']>>[] = []
    const mailerFor = (port: number, timeouts: MailTimeouts, withLogin = true) =>
      createSmtpMailer({
        settings: settingsFor(port, withLogin ? { credentials } : {}),
        logger,
        timeouts,
      })

    // 1. accepted
    const accepting = await sink({ auth: { user: CANARY.user, pass: CANARY.password } })
    results.push(await mailerFor(accepting.port, ORDINARY).send(canaryMail()))

    // 2. the recipient refused for good, with a reply that names the mailbox
    accepting.refuseNextRecipient(550)
    results.push(await mailerFor(accepting.port, ORDINARY).send(canaryMail()))

    // 3. the relay unable for the moment, the same
    accepting.refuseNextRecipient(451)
    results.push(await mailerFor(accepting.port, ORDINARY).send(canaryMail()))

    // 4. a login the relay refuses
    const guarded = await sink({ auth: { user: CANARY.user, pass: 'not-the-password' } })
    results.push(await mailerFor(guarded.port, ORDINARY).send(canaryMail()))

    // 5. a relay that never greets
    const mute = await sink({ greeting: 'never' })
    results.push(
      await mailerFor(mute.port, { ...ORDINARY, greetingMs: 150 }, false).send(canaryMail()),
    )

    // 6. a relay that hangs after the message, ended by the overall deadline
    const hanging = await sink({ afterData: 'hang' })
    results.push(
      await mailerFor(
        hanging.port,
        { ...ORDINARY, inactivityMs: 30_000, totalMs: 250 },
        false,
      ).send(canaryMail()),
    )

    // 7. nothing listening at all
    const gone = await startSmtpSink()
    const { port } = gone
    await gone.close()
    results.push(await mailerFor(port, ORDINARY, false).send(canaryMail()))

    // 8. refused before sending: a subject that is a header injection, and a list
    results.push(
      await mailerFor(accepting.port, ORDINARY).send(
        canaryMail({ subject: `${CANARY.subject}${String.fromCodePoint(0x0a)}Bcc: x@example.net` }),
      ),
    )
    results.push(
      await mailerFor(accepting.port, ORDINARY).send(
        canaryMail({ to: to(`${recipient},someone-else@example.net`) }),
      ),
    )

    return { logger, results }
  }

  it('never logs, or returns, an address, a subject, a body, a link, a login or the relay’s own wording', async () => {
    const { logger, results } = await runEveryOutcome()

    // Everything an operator or a caller could read afterwards.
    const everything = JSON.stringify([
      logger.lines,
      results.map((result) =>
        result.ok
          ? 'ok'
          : {
              code: result.error.code,
              details: result.error.details,
              message: result.error.message,
            },
      ),
    ])

    // Not vacuous: the cases ran, and the one thing that is meant to be logged is there.
    expect(results).toHaveLength(9)
    expect(logger.lines.length).toBeGreaterThanOrEqual(9)
    expect(everything).toContain(CANARY.domain)

    for (const secret of [
      CANARY.localPart,
      CANARY.subject,
      CANARY.text,
      CANARY.html,
      CANARY.link,
      CANARY.user,
      CANARY.password,
      CANARY.relayWording,
    ]) {
      expect(everything, `${secret} reached a log or a return value`).not.toContain(secret)
    }
  })

  it('logs a failure as its reason, the recipient’s domain and the relay’s numeric reply, and nothing more', async () => {
    const relay = await sink()
    relay.refuseNextRecipient(550)
    const logger = new RecordingLogger()
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port),
      logger,
      timeouts: ORDINARY,
    })

    await mailer.send(canaryMail())

    // An exact shape, so a field added to this line later has to be argued for in a diff to
    // this test and not slipped in beside it.
    expect(logger.lines).toEqual([
      {
        level: 'warn',
        message: 'mail not sent',
        context: {
          reason: 'rejected',
          recipientDomain: CANARY.domain,
          errorCode: 'EENVELOPE',
          smtpCode: 550,
          command: 'RCPT TO',
        },
      },
    ])
  })

  it('logs a success as the recipient’s domain alone', async () => {
    const relay = await sink()
    const logger = new RecordingLogger()
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port),
      logger,
      timeouts: ORDINARY,
    })

    await mailer.send(canaryMail())

    expect(logger.lines).toEqual([
      {
        level: 'info',
        message: 'mail accepted by the relay',
        context: { recipientDomain: CANARY.domain },
      },
    ])
  })

  it('logs a message refused before sending as the rule it broke, with not even a domain', async () => {
    const relay = await sink()
    const logger = new RecordingLogger()
    const mailer = createSmtpMailer({
      settings: settingsFor(relay.port),
      logger,
      timeouts: ORDINARY,
    })

    await mailer.send(canaryMail({ to: to(`${recipient},someone-else@example.net`) }))

    expect(logger.lines).toEqual([
      {
        level: 'warn',
        message: 'mail refused before sending',
        context: { code: 'mail.recipientInvalid' },
      },
    ])
    expect(relay.messages).toEqual([])
  })
})
