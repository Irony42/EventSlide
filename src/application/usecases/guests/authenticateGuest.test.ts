import { beforeEach, describe, expect, it } from 'vitest'
import type { Event } from '../../../domain/events/event'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestId, type EventId, type GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { GuestTokenClaims, GuestTokenService } from '../../ports/guestTokenService'
import { AT, aGuest, anEvent, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { makeAuthenticateGuest } from './authenticateGuest'

/**
 * A token a test can both mint and read: `token|<eventId>|<guestId>|<issuedAt ms>`.
 *
 * Local rather than shared, because the real service's whole job is the HMAC and a
 * faked signature asserts nothing — `hmacTokenService` has its own ring-3 tests. What
 * this use case owes is what happens *after* a token verifies: the claims are checked
 * against the event in the URL and against the guest row. So the double models exactly
 * the three verify outcomes the port promises, and nothing else.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1_000

class FakeGuestTokenService implements GuestTokenService {
  issue({ eventId, guestId, issuedAt }: GuestTokenClaims): string {
    return `token|${eventId}|${guestId}|${issuedAt.getTime()}`
  }

  verify(token: string, now: Date): Result<GuestTokenClaims, DomainError> {
    const [prefix, eventId, guestId, issuedAt] = token.split('|')
    if (prefix !== 'token' || eventId === undefined || guestId === undefined) {
      return err(DomainError.unauthenticated('guestToken.malformed'))
    }

    const issuedAtMs = Number(issuedAt)
    if (!Number.isFinite(issuedAtMs)) {
      return err(DomainError.unauthenticated('guestToken.malformed'))
    }
    if (now.getTime() - issuedAtMs > MAX_AGE_MS) {
      return err(DomainError.unauthenticated('guestToken.expired'))
    }

    return ok({
      eventId: asEventId(eventId),
      guestId: asGuestId(guestId),
      issuedAt: new Date(issuedAtMs),
    })
  }
}

const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')
const LEA = asGuestId('guest-1')

const WEDDING_SLUG = 'camille-et-sacha'
const GALA_SLUG = 'gala-nova'

const aWedding = (status: EventStatus = 'live'): Event =>
  anEvent({ id: WEDDING, slug: WEDDING_SLUG, joinCode: 'H0K2QM', status })

const aGala = (): Event =>
  anEvent({ id: GALA, slug: GALA_SLUG, name: 'Gala Nova', joinCode: 'R40T9W' })

describe('authenticateGuest', () => {
  let events: FakeEventRepository
  let guests: FakeGuestRepository
  let clock: FakeClock
  const tokens = new FakeGuestTokenService()

  const tokenFor = (eventId: EventId, guestId: GuestId, issuedAt: Date = AT): string =>
    tokens.issue({ eventId, guestId, issuedAt })

  const authenticate = (token: string, eventSlug: string = WEDDING_SLUG) =>
    makeAuthenticateGuest({ events, guests, tokens, clock })({ token, eventSlug })

  beforeEach(() => {
    events = new FakeEventRepository().seed(aWedding(), aGala())
    guests = new FakeGuestRepository().seed(aGuest({ id: LEA, eventId: WEDDING }))
    clock = new FakeClock()
  })

  // -------------------------------------------------------------------- accepts --

  it('resolves a token whose event matches the slug in the URL to that guest', async () => {
    const result = await authenticate(tokenFor(WEDDING, LEA))

    expect(result.ok && result.value.guest.id).toBe(LEA)
  })

  it('returns the event it resolved, so the caller never reads the slug twice', async () => {
    const result = await authenticate(tokenFor(WEDDING, LEA))

    expect(result.ok && result.value.event.id).toBe(WEDDING)
  })

  it('records the guest as seen, so the host count says who is here now', async () => {
    clock.advance(90_000)

    await authenticate(tokenFor(WEDDING, LEA))

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.lastSeenAt).toEqual(atPlus(90_000))
  })

  // ------------------------------------------------------------------ the token --

  it.each([
    { rejected: 'a token that is not a token at all', token: 'nimportequoi' },
    { rejected: 'an empty cookie', token: '' },
  ])('refuses $rejected', async ({ token }) => {
    const result = await authenticate(token)

    expect(!result.ok && result.error.code).toBe('guestToken.malformed')
  })

  it('refuses a token older than the maximum age', async () => {
    clock.advance(MAX_AGE_MS + 1)

    const result = await authenticate(tokenFor(WEDDING, LEA))

    expect(!result.ok && result.error.code).toBe('guestToken.expired')
  })

  // -------------------------------------------------------------- cross-event --

  /**
   * The cross-event attack. A guest at one wedding holds a perfectly valid token and
   * points their own cookie at another event's endpoints; the claims are compared
   * against the event resolved from the URL, so it is refused. 1.0 had no such
   * comparison — the event came from a query parameter the client chose.
   */
  it('refuses a valid token issued for another event', async () => {
    const result = await authenticate(tokenFor(GALA, LEA), WEDDING_SLUG)

    expect(!result.ok && result.error.code).toBe('guest.wrongEvent')
  })

  it('calls a token from another event forbidden, not merely unauthenticated', async () => {
    const result = await authenticate(tokenFor(GALA, LEA), WEDDING_SLUG)

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('does not record presence at an event the token does not name', async () => {
    clock.advance(90_000)

    await authenticate(tokenFor(GALA, LEA), WEDDING_SLUG)

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.lastSeenAt).toEqual(AT)
  })

  /**
   * The same attack from the other side: the token and the URL agree on the gala, so
   * the event comparison passes, and the only thing between the holder and Léa's
   * wedding identity is that the guest row is read *within* the event. An unscoped
   * `findById(guestId)` would resolve her row at the gala and hand it over.
   */
  it('refuses a guest id that exists only at another event, though token and URL agree', async () => {
    const result = await authenticate(tokenFor(GALA, LEA), GALA_SLUG)

    expect(!result.ok && result.error.kind).toBe('unauthenticated')
  })

  it('leaves the other event row untouched when its guest id is used at the gala', async () => {
    clock.advance(90_000)

    await authenticate(tokenFor(GALA, LEA), GALA_SLUG)

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.lastSeenAt).toEqual(AT)
  })

  // -------------------------------------------------------------------- the URL --

  it('refuses a slug the domain would never have stored', async () => {
    const result = await authenticate(tokenFor(WEDDING, LEA), 'Pas Un Slug')

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a slug that belongs to no event', async () => {
    const result = await authenticate(tokenFor(WEDDING, LEA), 'un-autre-mariage')

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  // ------------------------------------------------------------------ the guest --

  /**
   * The row is what makes a stateless token revocable, so a token naming a row that no
   * longer exists is a credential failure: the phone must drop the cookie and scan the
   * code again, which is what 401 tells it to do.
   */
  it('refuses a token whose guest row has been erased', async () => {
    await guests.delete(WEDDING, LEA)

    const result = await authenticate(tokenFor(WEDDING, LEA))

    expect(!result.ok && result.error.kind).toBe('unauthenticated')
  })

  it('refuses a guest the host has revoked', async () => {
    guests.seed(aGuest({ id: LEA, eventId: WEDDING, revokedAt: atPlus(1_000) }))

    const result = await authenticate(tokenFor(WEDDING, LEA))

    expect(!result.ok && result.error.code).toBe('guest.revoked')
  })

  it('does not record presence for a revoked guest', async () => {
    guests.seed(aGuest({ id: LEA, eventId: WEDDING, lastSeenAt: AT, revokedAt: atPlus(1_000) }))
    clock.advance(90_000)

    await authenticate(tokenFor(WEDDING, LEA))

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.lastSeenAt).toEqual(AT)
  })

  // ------------------------------------------------------------------ the event --

  /**
   * A device token grants identity only while the doors are open. Uploads have their
   * own gate, but a party that is over stops handing out identity too — otherwise
   * `archived`, which is terminal precisely because the media may be gone, would still
   * mint sessions.
   */
  it.each<EventStatus>(['draft', 'closed', 'archived'])(
    'refuses a guest of a %s event, which no longer accepts guests',
    async (status) => {
      await events.save(aWedding(status))

      const result = await authenticate(tokenFor(WEDDING, LEA))

      expect(!result.ok && result.error.code).toBe('event.notFound')
    },
  )
})
