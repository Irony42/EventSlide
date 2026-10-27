import { DomainError } from '../../../domain/shared/errors'
import { JoinCode } from '../../../domain/shared/joinCode'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'

/**
 * How many codes are tried before giving up.
 *
 * Five, because 32^6 is at least a billion codes (more, if `JOIN_CODE_LENGTH` is configured
 * above its six-character floor): a working generator does not collide five times in a row, so
 * a sixth attempt would only be there to hide a generator stuck on a constant — which must
 * surface as a failure instead of spinning forever.
 */
export const MAX_JOIN_CODE_ATTEMPTS = 5

/**
 * A free join code, or the reason there is none.
 *
 * The code space is shared by every event on the box, because `/join/:code` resolves without
 * knowing which event it belongs to. A collision would send a guest to the wrong party — 1.0's
 * worst defect, in a new shape — so the unique index refuses it and `save` would throw rather
 * than return a `Result`. Asking the repository first turns that into an ordinary retry.
 *
 * Used by `createEvent` and `rotateJoinCode`, which each carried a copy of this.
 */
export const allocateJoinCode = async (
  events: EventRepository,
  ids: IdGenerator,
  length: number,
): Promise<Result<JoinCode, DomainError>> => {
  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const candidate = JoinCode.fromBytes(ids.bytes(length), length)
    if (!candidate.ok) return candidate
    if (!(await events.joinCodeTaken(candidate.value))) return ok(candidate.value)
  }
  // `unexpected`, not `conflict`: nothing about the host's input collided, and there is
  // nothing for them to change and retry. It is the box that is broken.
  return err(
    DomainError.unexpected('event.joinCodeExhausted', { attempts: MAX_JOIN_CODE_ATTEMPTS }),
  )
}
