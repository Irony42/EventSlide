import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * How long a shared gallery link stays open (docs/ROADMAP.md §4.1).
 *
 * **Every link expires, and the host cannot say otherwise.** It is the product's first
 * public read surface: a URL that ends up in a group chat, forwarded to people the host
 * has never met, is a URL that will be opened long after anybody remembers sending it.
 * An expiry is the one control that still works when the host forgets the link exists —
 * revocation needs somebody to press a button, and nobody does, two years later.
 *
 * Counted in whole days because that is the granularity of the promise a host makes in a
 * message ("the photos are up for a month"), and because a finer one buys nothing a
 * guest could notice. The instant is computed once, at creation, from the clock the use
 * case was handed; it is stored, never re-derived.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** The weeks after a wedding in which "can you send me the photos" actually arrives. */
export const SHARE_LINK_DEFAULT_DAYS = 30

export const SHARE_LINK_MIN_DAYS = 1

/**
 * A season, and no more. Long enough for the family who only get round to it after the
 * honeymoon; short enough that a forwarded link stops working before it is anybody's
 * archive. A host who needs longer makes a new link, which is a deliberate act — the
 * point of a ceiling is that it does not move because somebody typed a bigger number.
 */
export const SHARE_LINK_MAX_DAYS = 90

export class ShareLinkLifetime {
  private constructor(readonly days: number) {}

  /** `undefined` is "the default", which is what a host who chose nothing gets. */
  static create(days: unknown): Result<ShareLinkLifetime, DomainError> {
    if (days === undefined) return ok(new ShareLinkLifetime(SHARE_LINK_DEFAULT_DAYS))

    if (
      typeof days !== 'number' ||
      !Number.isInteger(days) ||
      days < SHARE_LINK_MIN_DAYS ||
      days > SHARE_LINK_MAX_DAYS
    ) {
      return err(
        DomainError.invalid('shareLink.lifetimeInvalid', {
          min: SHARE_LINK_MIN_DAYS,
          max: SHARE_LINK_MAX_DAYS,
        }),
      )
    }
    return ok(new ShareLinkLifetime(days))
  }

  /** The instant the link stops opening, for a link created at `now`. */
  expiresAfter(now: Date): Date {
    return new Date(now.getTime() + this.days * MS_PER_DAY)
  }
}
