import { beforeEach, describe, expect, it } from 'vitest'
import type { EventRole } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { GuestTokenClaims, GuestTokenService } from '../../ports/guestTokenService'
import { AT, aGuest, anEvent, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { makeAuthenticateGuest } from './authenticateGuest'
import { makeRevokeGuest, type RevokeGuestInput } from './revokeGuest'

/**
 * A readable token, as in `authenticateGuest.test.ts`, minus the age check — expiry is
 * that file's subject. It exists here because the two use cases are composed in the
 * last test: a revocation that did not actually stop the next request from the phone is
 * the failure this whole use case exists to prevent.
 */
class FakeGuestTokenService implements GuestTokenService {
  issue({ eventId, guestId, issuedAt }: GuestTokenClaims): string {
    return `token|${eventId}|${guestId}|${issuedAt.getTime()}`
  }

  verify(token: string): Result<GuestTokenClaims, DomainError> {
    const [prefix, eventId, guestId, issuedAt] = token.split('|')
    if (prefix !== 'token' || eventId === undefined || guestId === undefined) {
      return err(DomainError.unauthenticated('guestToken.malformed'))
    }
    return ok({
      eventId: asEventId(eventId),
      guestId: asGuestId(guestId),
      issuedAt: new Date(Number(issuedAt)),
    })
  }
}

const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')
const LEA = asGuestId('guest-1')
const HOST = asUserId('user-1')
const GALA_HOST = asUserId('user-2')

const WEDDING_SLUG = 'camille-et-sacha'

describe('revokeGuest', () => {
  let guests: FakeGuestRepository
  let memberships: FakeMembershipRepository
  let clock: FakeClock

  const revoke = (input: RevokeGuestInput) => makeRevokeGuest({ guests, memberships, clock })(input)

  const revokeLea = (actorId = HOST, eventId = WEDDING) =>
    revoke({ eventId, actorId, guestId: LEA })

  beforeEach(() => {
    guests = new FakeGuestRepository().seed(aGuest({ id: LEA, eventId: WEDDING }))
    memberships = new FakeMembershipRepository().seed(
      { eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: AT },
      { eventId: GALA, userId: GALA_HOST, role: 'owner', grantedAt: AT },
    )
    clock = new FakeClock()
  })

  // ------------------------------------------------------------------- revoking --

  it('marks the guest revoked, which is what makes a signed token revocable', async () => {
    await revokeLea()

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.isRevoked()).toBe(true)
  })

  it('stamps the revocation with the moment the host decided', async () => {
    clock.advance(30_000)

    await revokeLea()

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.revokedAt).toEqual(atPlus(30_000))
  })

  it('returns the revoked guest, so the host list updates without a refetch', async () => {
    const result = await revokeLea()

    expect(result.ok && result.value.isRevoked()).toBe(true)
  })

  /** The button is on a phone at a party, so it will be double-tapped. */
  it('keeps the first timestamp when the host presses revoke twice', async () => {
    await revokeLea()
    clock.advance(30_000)

    const result = await revokeLea()

    expect(result.ok && result.value.revokedAt).toEqual(AT)
  })

  // -------------------------------------------------------------- authorization --

  it.each<EventRole>(['owner', 'moderator'])(
    'lets %s remove a disruptive guest, because moderation is the point of the role',
    async (role) => {
      memberships.seed({ eventId: WEDDING, userId: HOST, role, grantedAt: AT })

      const result = await revokeLea()

      expect(result.ok).toBe(true)
    },
  )

  /**
   * A caller with no part in this event gets the answer an unknown event gets. 403
   * would confirm the event exists and make this an enumeration oracle for other
   * people's weddings — the same reason `requireRole` answers 404.
   */
  it('refuses a host of another event, and says nothing about this one', async () => {
    const result = await revokeLea(GALA_HOST)

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('does not revoke anyone on behalf of a host of another event', async () => {
    await revokeLea(GALA_HOST)

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.isRevoked()).toBe(false)
  })

  it('refuses a caller with no membership at all', async () => {
    const result = await revokeLea(asUserId('user-inconnu'))

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  // ----------------------------------------------------------------- one event --

  it('cannot revoke a guest of another event', async () => {
    const atTheGala = asGuestId('guest-gala')
    guests.seed(aGuest({ id: atTheGala, eventId: GALA }))

    const result = await revoke({ eventId: WEDDING, actorId: HOST, guestId: atTheGala })

    expect(!result.ok && result.error.code).toBe('guest.notFound')
  })

  it('leaves a guest of the same id at another event alone', async () => {
    guests.seed(aGuest({ id: LEA, eventId: GALA }))

    await revokeLea()

    const stored = await guests.findById(GALA, LEA)
    expect(stored?.isRevoked()).toBe(false)
  })

  it('answers a guest id that does not exist with guest.notFound', async () => {
    const result = await revoke({
      eventId: WEDDING,
      actorId: HOST,
      guestId: asGuestId('guest-inconnu'),
    })

    expect(!result.ok && result.error.code).toBe('guest.notFound')
  })

  // ---------------------------------------------------------------- composition --

  /**
   * The rule the host actually cares about, and the only one that spans both use cases:
   * pressing revoke has to stop the next request from the phone that is uploading.
   */
  it('stops a revoked guest from authenticating with a token that still verifies', async () => {
    const events = new FakeEventRepository().seed(
      anEvent({ id: WEDDING, slug: WEDDING_SLUG, joinCode: 'H0K2QM' }),
    )
    const tokens = new FakeGuestTokenService()
    const authenticate = makeAuthenticateGuest({ events, guests, tokens, clock })
    const token = tokens.issue({ eventId: WEDDING, guestId: LEA, issuedAt: AT })
    expect((await authenticate({ token, eventSlug: WEDDING_SLUG })).ok).toBe(true)

    await revokeLea()

    const result = await authenticate({ token, eventSlug: WEDDING_SLUG })
    expect(!result.ok && result.error.code).toBe('guest.revoked')
  })
})
