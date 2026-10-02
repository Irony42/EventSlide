import { createTransport, type NodemailerError, type SMTPTransportOptions } from 'nodemailer'
import type { Logger, LogContext } from '../../application/ports/logger'
import { mailFailure, type MailFailureReason, type Mailer } from '../../application/ports/mailer'
import { checkOutgoingMail } from '../../domain/mail/outgoingMail'
import { err, ok } from '../../domain/shared/result'
import { isLoopbackHost, type SmtpSettings } from './smtpEndpoint'

/**
 * The SMTP adapter (G2-07 / P3-08), on `nodemailer` — MIT-0, so compatible with this
 * project's AGPL-3.0-only (docs/SECURITY.md §10 records the licence check).
 *
 * Wired by the composition root only when `SMTP_URL` is set; otherwise `NullMailer`.
 *
 * **What it promises, and how each promise is kept:**
 *
 * - *Never throws.* `send` is one `try` around everything that can reject, and a rejection
 *   becomes an `Err` whose code is one of three (`mail.rejected`, `mail.transient`; see
 *   {@link classifyMailError}).
 * - *Bounded in time.* `nodemailer`'s own defaults are two minutes to connect and ten
 *   minutes of silence, which is a request left hanging for ten minutes behind a click on
 *   "send the invitation". {@link DEFAULT_MAIL_TIMEOUTS} replaces all of them, and a hard
 *   deadline on the whole call backs them up against a relay that answers slowly enough
 *   never to be silent.
 * - *No address beyond its domain, no body, no link in a log* — see {@link describeFailure}.
 *   `nodemailer` builds every error message by appending the relay's own reply, and a relay
 *   that refuses a recipient says which one (`550 5.1.1 <camille@example.org>: Recipient
 *   address rejected`). So the message is never logged and never returned; only the numeric
 *   reply code, the library's error code and the name of the SMTP command are.
 * - *Encrypted, except to this machine.* See {@link transportOptionsFor}.
 *
 * `nodemailer`'s own `logger` and `debug` options are left off, deliberately: with `debug`
 * it writes the whole SMTP conversation — message body, and the base64 of the credentials —
 * to its logger, and with `logger: true` to the console.
 */

export interface MailTimeouts {
  /** Opening the TCP connection, and resolving the relay's name. */
  readonly connectMs: number
  /** Waiting for the relay's `220` greeting once connected. */
  readonly greetingMs: number
  /** Silence on an open connection between two replies. */
  readonly inactivityMs: number
  /**
   * The whole `send`, from the call to the answer. The bound a caller can count on, whatever
   * the relay does in between: a reply every few seconds keeps the connection from ever
   * being "silent" and would otherwise never end.
   */
  readonly totalMs: number
}

export const DEFAULT_MAIL_TIMEOUTS: MailTimeouts = {
  connectMs: 10_000,
  greetingMs: 10_000,
  inactivityMs: 30_000,
  totalMs: 60_000,
}

/**
 * Library error codes that a retry cannot change: credentials the relay refused, no
 * credentials where it demands them, a sender or recipient the library itself will not put
 * in an envelope, a STARTTLS the relay does not offer, a configuration the library rejects.
 * Everything else — a dead socket, a timeout, a DNS failure, a TLS handshake that broke —
 * is something that may well work in a minute.
 */
const PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'EAUTH',
  'ENOAUTH',
  'EENVELOPE',
  'EREQUIRETLS',
  'ECONFIG',
])

/**
 * Whether a failure is worth trying again.
 *
 * The relay's own verdict wins when there is one, because it is the only party that
 * knows: a **5xx** reply is permanent (RFC 5321 §4.2.1), a **4xx** is "try again later" —
 * including the 454 that a relay answers to a login it could not check just now, which
 * would have been misfiled as a refusal had the library's `EAUTH` been read first. With no
 * reply to read, the library's code decides ({@link PERMANENT_ERROR_CODES}); and anything
 * that cannot be classified — an exception of some other shape, a value that is not an
 * error at all — is `transient`, the safer thing to tell a caller than "never".
 */
export const classifyMailError = (error: unknown): MailFailureReason => {
  if (typeof error !== 'object' || error === null) return 'transient'
  const { code, responseCode } = error as NodemailerError

  if (typeof responseCode === 'number') {
    if (responseCode >= 500) return 'rejected'
    if (responseCode >= 400) return 'transient'
  }
  return typeof code === 'string' && PERMANENT_ERROR_CODES.has(code) ? 'rejected' : 'transient'
}

/** The name of an SMTP command (`RCPT TO`, `AUTH PLAIN`, `CONN`), and nothing longer. */
const COMMAND_NAME = /^[A-Z][A-Z0-9 -]{0,23}$/

/**
 * What of a failure may be logged: the library's code, the relay's numeric reply code and
 * the name of the command in flight. **Never `message`, `response`, `recipient` or
 * `rejected`**, each of which can carry the address, and never anything from the message.
 * The command name is checked against {@link COMMAND_NAME} rather than trusted, so a future
 * version that put a full command line (`RCPT TO:<camille@example.org>`) in that field
 * would be dropped here instead of printed.
 */
const describeFailure = (error: unknown): LogContext => {
  if (typeof error !== 'object' || error === null) return {}
  const { code, responseCode, command } = error as NodemailerError
  return {
    ...(typeof code === 'string' ? { errorCode: code } : {}),
    ...(typeof responseCode === 'number' ? { smtpCode: responseCode } : {}),
    ...(typeof command === 'string' && COMMAND_NAME.test(command) ? { command } : {}),
  }
}

/**
 * The `nodemailer` options for these settings. Pure, and exported so the decisions in it
 * are asserted rather than assumed:
 *
 * - **`requireTLS` for every host that is not this machine, when the URL is `smtp://`.**
 *   Without it `nodemailer` upgrades only if the relay happens to advertise STARTTLS, and
 *   otherwise carries on in the clear — a login sent as base64 over the network, which an
 *   active attacker can arrange by stripping the advertisement. `smtps://` is encrypted
 *   from the first byte and needs no flag. Only a loopback relay (a developer's MailHog)
 *   may stay plain. Certificate checking is `nodemailer`'s default, which is on, and
 *   nothing here exposes a way to switch it off.
 * - **Explicit connection fields, never a URL**, for the reason in `smtpEndpoint.ts`.
 * - **`disableFileAccess` and `disableUrlAccess`.** The message is built from strings
 *   and nothing else, but `nodemailer` will read a file or fetch a URL if a message
 *   field is shaped `{ path }` or `{ href }`. This keeps a future template change from
 *   turning a caller-supplied value into a local file read or a request from this box.
 * - **No `logger`, no `debug`**, as above.
 */
export const transportOptionsFor = (
  settings: SmtpSettings,
  timeouts: MailTimeouts,
): SMTPTransportOptions => {
  const { host, port, implicitTls, credentials } = settings.endpoint
  return {
    host,
    port,
    secure: implicitTls,
    requireTLS: !implicitTls && !isLoopbackHost(host),
    ...(credentials === null
      ? {}
      : { auth: { user: credentials.username, pass: credentials.password } }),
    connectionTimeout: timeouts.connectMs,
    dnsTimeout: timeouts.connectMs,
    greetingTimeout: timeouts.greetingMs,
    socketTimeout: timeouts.inactivityMs,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  }
}

/**
 * Settles with whichever comes first: the work, or `ms`.
 *
 * If the deadline wins, the work is **not** cancelled — `nodemailer` offers no way to —
 * so its eventual rejection is consumed here rather than left to become an unhandled one,
 * which on Node 24 ends the process. The connection it holds is closed by the library's own
 * inactivity timeout.
 */
const within = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('the mail was not accepted in time'), { code: 'ETIMEDOUT' }))
    }, ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

export interface SmtpMailerOptions {
  readonly settings: SmtpSettings
  readonly logger: Logger
  /** Defaults to {@link DEFAULT_MAIL_TIMEOUTS}. Tests shorten them; nothing lengthens them. */
  readonly timeouts?: MailTimeouts
}

export const createSmtpMailer = ({
  settings,
  logger,
  timeouts = DEFAULT_MAIL_TIMEOUTS,
}: SmtpMailerOptions): Mailer => {
  const transporter = createTransport(transportOptionsFor(settings, timeouts))
  const { name, address } = settings.from
  const from = { name: name ?? '', address }

  return {
    canDeliver: true,

    send: async (mail) => {
      const checked = checkOutgoingMail(mail)
      if (!checked.ok) {
        // The rule that was broken, and nothing about the message: the recipient of a
        // refused message may be the problem, so even its domain is left out.
        logger.warn('mail refused before sending', { code: checked.error.code })
        return checked
      }

      // The only part of an address that is ever logged. Safe to read here: the address
      // has passed `isSingleMailbox`, so what follows its `@` is a host and not a payload.
      const recipientDomain = mail.to.domain

      try {
        await within(
          transporter.sendMail({
            from,
            to: { name: '', address: mail.to.value },
            subject: mail.subject,
            text: mail.text,
            ...(mail.html === undefined ? {} : { html: mail.html }),
          }),
          timeouts.totalMs,
        )
        logger.info('mail accepted by the relay', { recipientDomain })
        return ok(undefined)
      } catch (error) {
        const reason = classifyMailError(error)
        logger.warn('mail not sent', { reason, recipientDomain, ...describeFailure(error) })
        return err(mailFailure(reason))
      }
    },
  }
}
