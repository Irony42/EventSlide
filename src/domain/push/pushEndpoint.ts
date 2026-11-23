import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * Where a browser's push service lives, and whether this box may call it (spec 30, lot 4).
 *
 * Web Push is the **first request this box makes to an address a user supplied**: the endpoint comes
 * from a browser through the host's own session, and a host (or a script holding a stolen session)
 * must not be able to point the box at an internal service. So the endpoint is judged **twice**, with
 * this one function, when it is stored and again when it is called (the allowlist may have been
 * narrowed since):
 *
 * - `https` only, no credentials in it, no fragment, the default port, at most 2048 characters;
 * - **a host name of the allowlist** (the four push services browsers use by default, replaceable by
 *   the operator in the configuration), never an IP address literal;
 * - the infrastructure adds what a name cannot show: the addresses it resolves to must be public, and
 *   nothing is followed (a redirect is a failure).
 */

export const PUSH_ENDPOINT_MAX_CHARS = 2048

/** The push services of the browsers: Firefox, Chrome and Edge's FCM, Windows, Safari. */
export const DEFAULT_PUSH_HOSTS: readonly string[] = [
  '*.push.services.mozilla.com',
  'fcm.googleapis.com',
  '*.notify.windows.com',
  'web.push.apple.com',
]

const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/u

/**
 * A comma-separated list of host patterns (`push.example.org`, `*.push.example.org`) read from the
 * configuration, or `null` when one is not a host name, an IP address was written, or the list is empty.
 */
export const parsePushHosts = (text: string): readonly string[] | null => {
  const patterns = text
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '')
  if (patterns.length === 0) return null
  for (const pattern of patterns) {
    if (!HOST_PATTERN.test(pattern) || /^(\*\.)?[0-9.]+$/u.test(pattern)) return null
  }
  return patterns
}

const matches = (host: string, pattern: string): boolean => {
  if (!pattern.startsWith('*.')) return host === pattern
  const suffix = pattern.slice(1)
  // At least one label in front: `*.notify.windows.com` is not `notify.windows.com` itself.
  return host.length > suffix.length && host.endsWith(suffix)
}

/** Whether a host name (lower case, no port) is one of the allowed push services. */
export const pushHostAllowed = (host: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => matches(host, pattern))

const invalid = (): DomainError => DomainError.invalid('push.endpointInvalid')
const notAllowed = (): DomainError => DomainError.invalid('push.endpointNotAllowed')

/**
 * An endpoint a browser sent, judged: the normalised address, or `push.endpointInvalid` (not an https
 * address of the shape above) or `push.endpointNotAllowed` (a host that is not a push service).
 */
export const parsePushEndpoint = (
  raw: unknown,
  allowedHosts: readonly string[],
): Result<string, DomainError> => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > PUSH_ENDPOINT_MAX_CHARS) {
    return err(invalid())
  }
  // https, a host of letters, digits, dots and hyphens (so no credentials, no port, no bracketed IPv6,
  // no non-ASCII name), then a path and a query: no fragment, no space.
  const shape = /^https:\/\/([A-Za-z0-9.-]+)([/?][^\s#]*)?$/u.exec(raw)
  if (shape === null) return err(invalid())
  const host = (shape[1] as string).toLowerCase()
  // An IPv4 address is digits and dots: not a push service's name, whatever the allowlist says.
  if (/^[0-9.]+$/u.test(host) || host.endsWith('.') || host.includes('..')) {
    return err(notAllowed())
  }
  if (!pushHostAllowed(host, allowedHosts)) return err(notAllowed())
  return ok(`https://${host}${shape[2] ?? ''}`)
}
