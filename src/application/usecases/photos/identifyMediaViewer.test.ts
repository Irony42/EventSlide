import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import { asEventId, asGuestId, asUserId, type EventId, type GuestId } from '../../../domain/shared/ids'
import { ok } from '../../../domain/shared/result'
import { AT, aGuest, anEvent, aUser } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeAuthenticateGuest } from '../guests/authenticateGuest'
import { makeIdentifyMediaViewer } from './identifyMediaViewer'
import {
  FAKE_GUEST_TOKEN_MAX_AGE_MS as MAX_AGE_MS,
  FakeGuestTokenService,
} from '../../testing/fakeGuestTokenService'

/**
 * Who is asking for a photograph's bytes.
 *
 * The rules this use case owes are the ones the media route used to decide with repositories in
 * its handler: a moderator before a guest, a guest only by the checks `authenticateGuest` makes,
 * the public for everything that fails them, and a suspended client's event closed to everyone
 * but its moderators. The parity cases at the end are the guard on the one rule written in a
 * comment, "the same checks as `authenticateGuest`": a fifth check added to one and not the other
 * fails there.
 */


const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')
const LEA = asGuestId('guest-1')
const HOST = asUserId('user-host')
const HELPER = asUserId('user-helper')
const STRANGER = asUserId('user-stranger')

describe('identifyMediaViewer', () => {
  let events: FakeEventRepository
  let guests: FakeGuestRepository
  let memberships: FakeMembershipRepository
  let clock: FakeClock
  const tokens = new FakeGuestTokenService()

  const tokenFor = (eventId: EventId, guestId: GuestId, issuedAt: Date = AT): string =>
    tokens.issue({ eventId, guestId, issuedAt })

  const identify = (input: {
    readonly guestToken?: string | undefined
    readonly userId?: ReturnType<typeof asUserId> | undefined
    readonly event?: Event
  }) =>
    makeIdentifyMediaViewer({ guests, tokens, memberships, clock })({
      event: input.event ?? wedding(),
      guestToken: input.guestToken,
      userId: input.userId,
    })

  const wedding = (): Event => anEvent({ id: WEDDING, slug: 'camille-et-sacha', joinCode: 'H7K2QM' })

  const suspended = (): Event =>
    Event.restore({ ...wedding().toProps(), clientSuspendedAt: AT })

  const viewerOf = async (
    input: Parameters<typeof identify>[0],
  ): Promise<string | undefined> => {
    const result = await identify(input)
    return result.ok ? result.value.kind : undefined
  }

  beforeEach(() => {
    events = new FakeEventRepository().seed(
      wedding(),
      anEvent({ id: GALA, slug: 'gala-nova', joinCode: 'B4N9PT' }),
    )
    guests = new FakeGuestRepository()
    guests.seed(aGuest({ id: LEA, eventId: WEDDING }))
    memberships = new FakeMembershipRepository().seed(
      { eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: AT },
      { eventId: WEDDING, userId: HELPER, role: 'moderator', grantedAt: AT },
      { eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT },
    )
    clock = new FakeClock()
  })

  // ------------------------------------------------------------------ moderator --

  it.each([
    ['an owner', HOST],
    ['a moderator', HELPER],
  ])('names %s of the event as a moderator', async (_what, userId) => {
    const result = await identify({ userId })

    expect(result).toEqual(ok({ kind: 'moderator', userId }))
  })

  it('puts the moderator before the guest: the broader identity wins on a host who also joined', async () => {
    const result = await identify({ userId: HOST, guestToken: tokenFor(WEDDING, LEA) })

    expect(result.ok && result.value.kind).toBe('moderator')
  })

  it('treats a moderator whose account was switched off as public: roleFor is the only authority', async () => {
    // `roleFor` answers null for a disabled account, the one read every request makes. A cheaper
    // read of the membership row would keep reading pending photographs and originals for an
    // account the host switched off (CLAUDE.md section 8).
    const users = new FakeUserRepository()
    await users.save(aUser({ id: HELPER, email: 'helper@example.test' }).disable(AT))
    memberships = new FakeMembershipRepository({ users }).seed({
      eventId: WEDDING,
      userId: HELPER,
      role: 'moderator',
      grantedAt: AT,
    })

    expect(await viewerOf({ userId: HELPER })).toBe('public')
  })

  it('treats a member of another event as public here, and tells them nothing more', async () => {
    expect(await viewerOf({ userId: STRANGER })).toBe('public')
  })

  it('treats a member of another event who is a guest here as that guest', async () => {
    const result = await identify({ userId: STRANGER, guestToken: tokenFor(WEDDING, LEA) })

    expect(result).toEqual(ok({ kind: 'guest', guestId: LEA }))
  })

  // ---------------------------------------------------------------------- guest --

  it('names the guest a valid token for this event describes', async () => {
    expect(await identify({ guestToken: tokenFor(WEDDING, LEA) })).toEqual(
      ok({ kind: 'guest', guestId: LEA }),
    )
  })

  it.each([
    ['no cookie at all', undefined],
    ['an empty cookie', ''],
  ])('is public with %s, which is a projector holding the wall URL', async (_what, guestToken) => {
    expect(await identify({ guestToken: guestToken as string | undefined })).toEqual(
      ok({ kind: 'public' }),
    )
  })

  it.each([
    ['a token that does not parse', () => 'not-a-token'],
    ['a token past its age', () => tokenFor(WEDDING, LEA, new Date(AT.getTime() - 2 * MAX_AGE_MS))],
    ['a token minted for another event', () => tokenFor(GALA, LEA)],
    ['a token whose guest row was erased', () => tokenFor(WEDDING, asGuestId('guest-erased'))],
  ])('fails open to the public for %s, and does not refuse', async (_what, token) => {
    // Refusing would break the public wall for anyone who ever joined anything: a guest at
    // another wedding may still look at this one's published photographs.
    expect(await identify({ guestToken: token() })).toEqual(ok({ kind: 'public' }))
  })

  it('fails open to the public for a guest the host has revoked', async () => {
    guests.seed(aGuest({ id: asGuestId('guest-gone'), eventId: WEDDING, revokedAt: AT }))

    expect(await viewerOf({ guestToken: tokenFor(WEDDING, asGuestId('guest-gone')) })).toBe(
      'public',
    )
  })

  it('does not stamp the guest as seen: a wall of thumbnails is a read per image', async () => {
    clock.advance(10 * 60 * 1_000)

    await identify({ guestToken: tokenFor(WEDDING, LEA, clock.now()) })

    expect((await guests.findById(WEDDING, LEA))?.lastSeenAt).toEqual(AT)
  })

  // ------------------------------------------------------------------ suspended --

  describe('for the event of a suspended client (roadmap §10.7)', () => {
    it.each([
      ['the public', {}],
      ['a guest', { guestToken: tokenFor(WEDDING, LEA) }],
      ['a member of another event', { userId: STRANGER }],
    ])('answers %s as for an event that is not there', async (_who, input) => {
      const result = await identify({ ...input, event: suspended() })

      expect(!result.ok && result.error.code).toBe('event.notFound')
      expect(!result.ok && result.error.kind).toBe('notFound')
    })

    it('no longer lets its moderators read photographs, and tells them why (launch review S5)', async () => {
      const result = await identify({ userId: HELPER, event: suspended() })

      expect(!result.ok && result.error.code).toBe('client.suspended')
      expect(!result.ok && result.error.kind).toBe('forbidden')
    })
  })

  describe('for an event the operator took down (launch review S5)', () => {
    const down = (): Event =>
      Event.restore({ ...wedding().toProps(), takenDownAt: AT })

    it.each([
      ['the public', {}],
      ['a guest', { guestToken: tokenFor(WEDDING, LEA) }],
      ['its own moderator', { userId: HELPER }],
    ])('answers %s as for an event that is not there', async (_who, input) => {
      const result = await identify({ ...input, event: down() })

      expect(!result.ok && result.error.code).toBe('event.notFound')
    })
  })

  // ---------------------------------------------------------------------- parity --

  describe('asks a guest token what authenticateGuest asks', () => {
    const authenticate = (token: string) =>
      makeAuthenticateGuest({ events, guests, tokens, clock, logger: new CapturingLogger() })({
        token,
        eventSlug: 'camille-et-sacha',
      })

    it.each([
      ['a valid token', () => tokenFor(WEDDING, LEA)],
      ['a token that does not parse', () => 'not-a-token'],
      ['an expired token', () => tokenFor(WEDDING, LEA, new Date(AT.getTime() - 2 * MAX_AGE_MS))],
      ['a token for another event', () => tokenFor(GALA, LEA)],
      ['a token whose guest row was erased', () => tokenFor(WEDDING, asGuestId('guest-erased'))],
      ['a revoked guest', () => tokenFor(WEDDING, asGuestId('guest-gone'))],
    ])('so that for %s a guest here is a guest there', async (_what, token) => {
      // Revoked, seeded for this case only; every other case does not name it.
      guests.seed(aGuest({ id: asGuestId('guest-gone'), eventId: WEDDING, revokedAt: AT }))

      const authenticated = await authenticate(token())
      const viewer = await identify({ guestToken: token() })

      // The two doors differ in what they do with a failure (a refusal, the public) and agree on
      // who is let in. A check added to one and not the other splits the two here.
      expect(viewer.ok && viewer.value.kind === 'guest').toBe(authenticated.ok)
    })
  })
})
