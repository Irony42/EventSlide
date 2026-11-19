import { DisplayName } from '../guests/displayName'
import type { DomainError } from '../shared/errors'
import { toSingleLine } from '../shared/plainText'
import type { Result } from '../shared/result'
import type { ChannelKind } from './channelKind'
import type { ChannelSender } from './inboundMessage'

/**
 * Who a sender is, as an EventSlide guest (spec 27 §4.4).
 *
 * A messaging identity becomes a guest **without a cookie**: the first media of a sender at an event
 * creates one, the next ones find it again. What finds it is a key, never the channel's identifier
 * itself: the infrastructure hashes {@link senderKeyMaterial} with a key derived from the guest-token
 * secret, so the table holds a fingerprint from which nobody can read a Telegram account.
 */

/** What is hashed: the channel and the sender's ref, so two channels never share a fingerprint. */
export const senderKeyMaterial = (channel: ChannelKind, sender: ChannelSender): string =>
  `${channel}:${sender.ref}`

/** The longest first name kept before the initial, so that name + space + initial + dot fits 40. */
const MAX_FIRST_NAME = DisplayName.maxLength - 3

/**
 * `Léa Martin` → `Léa M.`; `Léa` → `Léa`; `Jean Pierre Dupont` → `Jean D.`. The first name and the initial
 * of the last word: enough for a friend to recognise the photograph, and not a full name on a wall.
 * Nothing at all (an anonymous administrator, a blank name) is an anonymous guest.
 */
export const senderDisplayName = (rawName: string | null): DisplayName | null => {
  if (rawName === null) return null
  const words = toSingleLine(rawName)
    .split(' ')
    .filter((word) => word !== '')
  const [first, ...rest] = words
  if (first === undefined) return null

  const firstName = [...first].slice(0, MAX_FIRST_NAME).join('')
  const last = rest.at(-1)
  const initial = last === undefined ? undefined : [...last][0]?.toLocaleUpperCase('fr')
  const shown = initial === undefined ? firstName : `${firstName} ${initial}.`

  return anonymousIfInvalid(DisplayName.createOptional(shown))
}

/**
 * A name the domain refuses is no reason to refuse the photograph: the guest stays anonymous.
 * (`shown` above is at most 40 characters and single-line, so this is a safety net, kept honest by
 * its own test rather than by a branch no input reaches.)
 */
export const anonymousIfInvalid = (
  parsed: Result<DisplayName | null, DomainError>,
): DisplayName | null => (parsed.ok ? parsed.value : null)

/**
 * Whether the guest of a sender should take the name the channel shows now. A sender who changed their
 * Telegram name is renamed; one whose name vanished keeps what they had, so a photograph already on
 * the wall is not silently turned anonymous.
 */
export const shouldRenameGuest = (current: DisplayName | null, next: DisplayName | null): boolean =>
  next !== null && (current === null || !current.equals(next))
