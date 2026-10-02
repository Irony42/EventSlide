import { isSingleMailbox } from '../../domain/mail/outgoingMail'
import { err, ok, type Result } from '../../domain/shared/result'

/**
 * `SMTP_URL` and `MAIL_FROM`, parsed (G2-07 / P3-08). Pure: no socket, no `nodemailer`.
 *
 * It lives beside the adapter and is imported by `config/env.ts` rather than the other way
 * round, so the one place that reads the variables is also the one that refuses a bad
 * one at boot — and so the adapter receives **parts**, never a URL. That matters for two
 * reasons. `nodemailer` will take a connection string whole, and then reads its query
 * string as options (`?tls.rejectUnauthorized=false` is a way to switch certificate
 * checking off); handing it only a host, a port and a pair of credentials leaves nothing
 * for a query string to reach. And a URL with a password in it is the one value in this
 * process that must never be logged, so it is taken apart once, at the edge, and the
 * password travels as a field with one reader.
 */

export interface SmtpCredentials {
  readonly username: string
  readonly password: string
}

export interface SmtpEndpoint {
  readonly host: string
  readonly port: number
  /**
   * `smtps://`: TLS from the first byte, conventionally port 465. `false` is `smtp://`:
   * a plain connection that is **upgraded** with STARTTLS (587, or whatever the relay
   * says) — and whether it may stay plain is decided by {@link isLoopbackHost}.
   */
  readonly implicitTls: boolean
  /** Both halves or neither: an SMTP login with a user and no password is not a login. */
  readonly credentials: SmtpCredentials | null
}

/** A sender, as `MAIL_FROM` is written: `no-reply@example.org` or `EventSlide <no-reply@example.org>`. */
export interface Mailbox {
  readonly name: string | null
  readonly address: string
}

/** Everything the SMTP adapter needs, and the only shape in which `AppConfig` carries it. */
export interface SmtpSettings {
  readonly endpoint: SmtpEndpoint
  readonly from: Mailbox
}

const DEFAULT_SUBMISSION_PORT = 587
const DEFAULT_IMPLICIT_TLS_PORT = 465
const MAX_PORT = 65_535
const MAX_DISPLAY_NAME_LENGTH = 100

/** Whitespace or a control character anywhere: the parser would silently delete or keep it. */
const UNREADABLE = /[\s\p{Cc}]/u

/**
 * Whether `host` is the machine this process is running on, which is the one case where a
 * connection may stay unencrypted: `localhost`, a name under `.localhost`, `127.0.0.0/8`
 * and `::1`.
 *
 * It is what separates a developer's MailHog on port 1025 — which speaks no TLS and never
 * leaves the machine — from a relay across a network, where a password sent before the
 * STARTTLS upgrade, or sent without one, is readable by whoever sits between. The adapter
 * therefore **requires** the upgrade for every other host, whatever `NODE_ENV` says.
 */
export const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host === '::1' ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)

/**
 * Parses `SMTP_URL`. The error is a fixed sentence, **never the input**: a refused value
 * may well be `smtps://user:password@...` with one character wrong, and the boot's list of
 * problems is printed to a terminal and kept by whatever collects its output.
 *
 * Accepted: `smtp://host`, `smtp://host:2525`, `smtps://user:pass@host`,
 * `smtps://user:p%40ss@host:465`. Credentials are percent-decoded, so a password may hold
 * any character once it is encoded. Refused: any other scheme, no host, a port outside
 * 1-65535, a user without a password or the reverse, and a path, a query string or a
 * fragment — there is nothing they could mean here, and a query string is exactly where an
 * option nobody reviewed would hide.
 */
export const parseSmtpUrl = (raw: string): Result<SmtpEndpoint, string> => {
  const value = raw.trim()
  if (UNREADABLE.test(value)) return err('contains whitespace or a control character')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return err('is not a valid URL')
  }

  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') {
    return err('must start with smtp:// or smtps://')
  }
  const implicitTls = url.protocol === 'smtps:'

  // WHATWG keeps the brackets of an IPv6 literal in `hostname`; a socket wants it bare.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (host === '') return err('has no host')

  if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    return err('must not have a path, a query string or a fragment')
  }

  let port = implicitTls ? DEFAULT_IMPLICIT_TLS_PORT : DEFAULT_SUBMISSION_PORT
  if (url.port !== '') {
    port = Number(url.port)
    if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
      return err('has a port outside 1-65535')
    }
  }

  if ((url.username === '') !== (url.password === '')) {
    return err('must give a user and a password together, or neither')
  }
  let credentials: SmtpCredentials | null = null
  if (url.username !== '') {
    try {
      credentials = {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      }
    } catch {
      return err('has credentials that are not validly percent-encoded')
    }
  }

  return ok({ host, port, implicitTls, credentials })
}

/**
 * Parses `MAIL_FROM`: one address, optionally with a display name in front of it in angle
 * brackets, on one line. The display name may be quoted. The error is a fixed sentence.
 *
 * The address must satisfy the same single-mailbox rule every recipient does, because a
 * `From:` that is really a list is a rejected message at best, and the display name may not
 * hold a quote, an angle bracket or a backslash — the characters that would let it end
 * early and start a second address.
 */
export const parseMailbox = (raw: string): Result<Mailbox, string> => {
  const value = raw.trim()
  const invalid = err('must be one address, no-reply@example.org or Name <no-reply@example.org>')

  if (/\p{Cc}/u.test(value)) return invalid

  const open = value.lastIndexOf('<')
  if (open === -1) return isSingleMailbox(value) ? ok({ name: null, address: value }) : invalid

  if (!value.endsWith('>')) return invalid
  const address = value.slice(open + 1, -1)
  let name = value.slice(0, open).trim()
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1)

  if (
    name.length === 0 ||
    name.length > MAX_DISPLAY_NAME_LENGTH ||
    /[<>"\\]/.test(name) ||
    !isSingleMailbox(address)
  ) {
    return invalid
  }
  return ok({ name, address })
}
