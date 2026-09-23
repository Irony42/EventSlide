import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { PasswordHasher } from '../../ports/passwordHasher'
import {
  eventBehind,
  issueUnlock,
  notAvailable,
  type GalleryAccessDeps,
  type UnlockProof,
} from './galleryAccess'

/**
 * A guest enters the gallery's password.
 *
 * The answer is a short-lived proof the HTTP layer puts in an `HttpOnly` cookie scoped to
 * the gallery's API path — never the password, never anything derived from it, and never
 * in a URL, where it would be in the browser's history, the proxy's log and the next
 * `Referer`.
 *
 * **The order is the timing story.** An unavailable link is refused before any hash is
 * compared, so a dead token costs a lookup and nothing more — and that tells the caller
 * nothing `GET /gallery/:token` does not already tell them for free. A live link spends
 * one bcrypt comparison per attempt, which is what the per-client and per-link limits in
 * front of this route are for.
 *
 * A link with no password answers with a proof as well. Nothing asks for one, and
 * refusing would only be a second way of saying the same thing the gallery already says.
 */

export interface UnlockGalleryInput {
  readonly token: string
  readonly password: string
}

export interface UnlockGalleryDeps extends GalleryAccessDeps {
  readonly hasher: PasswordHasher
}

export type UnlockGallery = (input: UnlockGalleryInput) => Promise<Result<UnlockProof, DomainError>>

export const makeUnlockGallery =
  (deps: UnlockGalleryDeps): UnlockGallery =>
  async ({ token, password }) => {
    const link = await deps.shareLinks.findByTokenDigest(deps.signer.digestOf(token))
    if (link === null) return err(notAvailable())

    const now = deps.clock.now()
    if ((await eventBehind(deps, link, now)) === null) return err(notAvailable())

    const hash = link.passwordHash
    if (hash !== null && !(await deps.hasher.verify(password, hash))) {
      return err(DomainError.unauthenticated('gallery.wrongPassword'))
    }

    return ok(issueUnlock(deps.signer, link, now))
  }
