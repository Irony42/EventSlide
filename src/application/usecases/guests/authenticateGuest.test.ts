import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestId, type EventId, type GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { GuestTokenClaims, GuestTokenService } from '../../ports/guestTokenService'
import { AT, aGuest, anEvent, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import type { Guest } from '../../../domain/guests/guest'
import { CapturingLogger } from '../../testing/capturingLogger'
import { makeAuthenticateGuest, PRESENCE_WRITE_INTERVAL_MS } from './authenticateGuest'
import { PRESENCE_WINDOW_MS } from './listGuests'

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

/** Counts the stamps, because "recorded as seen" and "written on every request" are different rules. */
class CountingGuestRepository extends FakeGuestRepository {
  touches = 0
  saves = 0

  override async touch(eventId: EventId, guestId: GuestId, at: Date): Promise<void> {
    this.touches += 1
    await super.touch(eventId, guestId, at)
  }

  /** The stamp must never go through the whole-row write: it could put a revoked guest back. */
  override async save(guest: Guest): Promise<void> {
    this.saves += 1
    await super.save(guest)
  }
}

/** A disk that is full, or a database that stays locked: the stamp is the one write that fails. */
class FailingStampGuestRepository extends FakeGuestRepository {
  override async touch(): Promise<void> {
    throw new Error('SQLITE_FULL: database or disk is full')
  }
}

const logger = new CapturingLogger()

describe('authenticateGuest', () => {
  let events: FakeEventRepository
  let guests: CountingGuestRepository
  let clock: FakeClock
  const tokens = new FakeGuestTokenService()

  const tokenFor = (eventId: EventId, guestId: GuestId, issuedAt: Date = AT): string =>
    tokens.issue({ eventId, guestId, issuedAt })

  const authenticate = (token: string, eventSlug: string = WEDDING_SLUG) =>
    makeAuthenticateGuest({ events, guests, tokens, clock, logger })({ token, eventSlug })

  beforeEach(() => {
    events = new FakeEventRepository().seed(aWedding(), aGala())
    logger.lines.length = 0
    guests = new CountingGuestRepository()
    guests.seed(aGuest({ id: LEA, eventId: WEDDING }))
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

  // ---------------------------------------------------------------- presence --

  /**
   * This runs on every guest request: a reaction tap, a poll of "my photos", an upload. The
   * host's count is read through a five-minute window, so a row written each time is cost with
   * no reader. The interval is what is left of the stamp: coarse, and far below the window.
   */
  it('does not stamp the guest again within thirty seconds of the last stamp', async () => {
    clock.advance(90_000)
    await authenticate(tokenFor(WEDDING, LEA))
    clock.advance(29_999)

    await authenticate(tokenFor(WEDDING, LEA))

    expect(guests.touches).toBe(1)
  })

  it('stamps the guest again once thirty seconds have passed, boundary included', async () => {
    clock.advance(90_000)
    await authenticate(tokenFor(WEDDING, LEA))
    clock.advance(30_000)

    await authenticate(tokenFor(WEDDING, LEA))

    expect((await guests.findById(WEDDING, LEA))?.lastSeenAt).toEqual(atPlus(120_000))
  })

  it('keeps the interval far below the window the host count is read through', () => {
    expect(PRESENCE_WRITE_INTERVAL_MS).toBeLessThanOrEqual(PRESENCE_WINDOW_MS / 10)
  })

  it('hands back the guest as seen now even when it skipped the stamp', async () => {
    clock.advance(1_000)

    const result = await authenticate(tokenFor(WEDDING, LEA))

    expect(result.ok && result.value.guest.lastSeenAt).toEqual(atPlus(1_000))
    expect(guests.touches).toBe(0)
  })

  it('stamps through the presence-only write and never rewrites the whole row', async () => {
    // A stamp taken from a row read a moment ago, written back whole, could put a revoked
    // guest back or take their name off. `touch` writes presence and nothing else.
    clock.advance(90_000)

    await authenticate(tokenFor(WEDDING, LEA))

    expect(guests.saves).toBe(0)
  })

  it('does not write when the guest was last seen in the future, as after a clock set back', async () => {
    guests.seed(aGuest({ id: LEA, eventId: WEDDING, lastSeenAt: atPlus(10 * 60 * 1_000) }))

    const result = await authenticate(tokenFor(WEDDING, LEA))

    expect(result.ok && result.value.guest.lastSeenAt).toEqual(atPlus(10 * 60 * 1_000))
    expect(guests.touches).toBe(0)
  })

  /**
   * The stamp is read by one number on the host's console. A full disk or a locked database that
   * made it throw would answer 500 to every request a guest makes, reads included, and keep
   * doing so, because a stamp that never lands is retried on the next one.
   */
  it('lets the guest through, and says so, when the stamp cannot be written', async () => {
    const failing = new FailingStampGuestRepository().seed(aGuest({ id: LEA, eventId: WEDDING }))
    clock.advance(90_000)

    const result = await makeAuthenticateGuest({
      events,
      guests: failing,
      tokens,
      clock,
      logger,
    })({ token: tokenFor(WEDDING, LEA), eventSlug: WEDDING_SLUG })

    expect(result.ok && result.value.guest.id).toBe(LEA)
    expect(logger.messages('warn')).toEqual([
      'could not record that a guest was seen; letting them through',
    ])
  })

  it('keeps the host count honest for a guest who joined long ago and is still uploading', async () => {
    // The sentence the header of this use case promises, in the terms the console reads it.
    clock.advance(60 * 60 * 1_000)

    await authenticate(tokenFor(WEDDING, LEA))

    const since = new Date(clock.now().getTime() - 5 * 60 * 1_000)
    expect(await guests.countActive(WEDDING, since)).toBe(1)
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

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers it as an event that is not there, so a token tells nothing about which slugs exist (HTTP-M-03)', async () => {
    // `403 guest.wrongEvent` confirmed the event existed, whatever its status, to a guest of any
    // other event; the public wall answers 404 for a draft, an archived and an absent slug alike.
    const foreign = await authenticate(tokenFor(GALA, LEA), WEDDING_SLUG)
    const absent = await authenticate(tokenFor(GALA, LEA), 'un-mariage-inconnu')

    expect(!foreign.ok && foreign.error.kind).toBe('notFound')
    expect(foreign).toEqual(absent)
  })

  it('keeps the reason in the log, where an operator wants it and a prober does not read', async () => {
    await authenticate(tokenFor(GALA, LEA), WEDDING_SLUG)

    const line = logger.lines.find((entry) => entry.context?.['code'] === 'guest.wrongEvent')
    expect(line?.level).toBe('warn')
    expect(line?.context).toEqual({
      code: 'guest.wrongEvent',
      requestedEventId: WEDDING,
      tokenEventId: GALA,
    })
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
   * Identity is not the lifecycle. A guest at a closed event can still look at their own
   * photographs, and one who uploads to it is told `event.notAcceptingUploads` by the use case
   * that owns that rule — a sentence they can act on — instead of a 404 they cannot. The
   * middleware never asked, and this use case now says so once.
   */
  it.each<EventStatus>(['draft', 'closed', 'archived'])(
    'still resolves a guest of a %s event, because who they are does not depend on the party',
    async (status) => {
      await events.save(aWedding(status))

      const result = await authenticate(tokenFor(WEDDING, LEA))

      expect(result.ok && result.value.guest.id).toBe(LEA)
    },
  )

  describe('for the event of a suspended client (G2-14, roadmap §10.7)', () => {
    beforeEach(async () => {
      await events.save(Event.restore({ ...aWedding().toProps(), clientSuspendedAt: AT }))
    })

    it('answers exactly as it does for an event that does not exist', async () => {
      const suspended = await authenticate(tokenFor(WEDDING, LEA))
      const unknown = await authenticate(tokenFor(WEDDING, LEA), 'un-autre-mariage')

      expect(suspended).toEqual(unknown)
      expect(!suspended.ok && suspended.error.code).toBe('event.notFound')
    })

    it('does not record presence at it', async () => {
      clock.advance(90_000)

      await authenticate(tokenFor(WEDDING, LEA))

      expect(guests.touches).toBe(0)
    })

    // It is judged before anything about the token is, so that no holder can tell it from an
    // event that is not there: a wrong event, a revoked guest and an erased one all get the
    // 404 an unknown slug gets, and not the 403 or the 401 that would say the event exists.
    it.each([
      {
        holder: 'a token issued for another event',
        arrange: async () => undefined,
        token: () => tokenFor(GALA, LEA),
      },
      {
        holder: 'a guest the host revoked',
        arrange: async () => {
          guests.seed(aGuest({ id: LEA, eventId: WEDDING, revokedAt: atPlus(1_000) }))
        },
        token: () => tokenFor(WEDDING, LEA),
      },
      {
        holder: 'a guest whose row was erased',
        arrange: async () => {
          await guests.delete(WEDDING, LEA)
        },
        token: () => tokenFor(WEDDING, LEA),
      },
    ])('answers $holder as it answers an event that does not exist', async ({ arrange, token }) => {
      await arrange()

      const suspended = await authenticate(token())
      const unknown = await authenticate(token(), 'un-autre-mariage')

      expect(suspended).toEqual(unknown)
      expect(!suspended.ok && suspended.error.code).toBe('event.notFound')
    })
  })
})
