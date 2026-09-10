import { beforeEach, describe, expect, it } from 'vitest'
import type { Event } from '../../../domain/events/event'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { err, type Result } from '../../../domain/shared/result'
import type { GuestTokenClaims, GuestTokenService } from '../../ports/guestTokenService'
import { AT, anEvent } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeJoinEvent, type JoinEventInput } from './joinEvent'

/**
 * A device token a test can read: `token|<eventId>|<guestId>|<issuedAt ms>`.
 *
 * Local to this file rather than shared, because the only thing worth asserting about
 * the real service is the HMAC, and a double cannot fake a signature into meaning
 * anything — `hmacTokenService` has its own ring-3 tests. What a join owes is that the
 * token names the event the code resolved to and the guest row it just created, and
 * that is legible here.
 */
class FakeGuestTokenService implements GuestTokenService {
  issue({ eventId, guestId, issuedAt }: GuestTokenClaims): string {
    return `token|${eventId}|${guestId}|${issuedAt.getTime()}`
  }

  /** Joining only issues. A verify that always refuses fails loudly if that changes. */
  verify(): Result<GuestTokenClaims, DomainError> {
    return err(DomainError.unauthenticated('guestToken.malformed'))
  }
}

const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')

/** Both codes carry a `0`, so an `O` typed for a zero is a case this suite can state. */
const WEDDING_CODE = 'H0K2QM'
const GALA_CODE = 'R40T9W'

const aWedding = (status: EventStatus = 'live'): Event =>
  anEvent({ id: WEDDING, slug: 'camille-et-sacha', joinCode: WEDDING_CODE, status })

const aGala = (): Event =>
  anEvent({ id: GALA, slug: 'gala-nova', name: 'Gala Nova', joinCode: GALA_CODE })

describe('joinEvent', () => {
  let events: FakeEventRepository
  let guests: FakeGuestRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let ids: SequentialIdGenerator

  /** Built per call, so a test may replace a seeded event before it acts. */
  const join = (input: JoinEventInput) =>
    makeJoinEvent({ events, guests, tokens: new FakeGuestTokenService(), ids, clock, bus })(input)

  beforeEach(() => {
    events = new FakeEventRepository().seed(aWedding(), aGala())
    guests = new FakeGuestRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    ids = new SequentialIdGenerator()
  })

  // ------------------------------------------------------------------- joining --

  it('creates a guest at the event the join code names', async () => {
    await join({ joinCode: WEDDING_CODE, displayName: 'Léa' })

    const guest = await guests.findById(WEDDING, asGuestId('guest-1'))
    expect(guest?.label()).toBe('Léa')
  })

  it('stamps a guest who has only scanned the code as seen, so the host counts them', async () => {
    await join({ joinCode: WEDDING_CODE })

    const guest = await guests.findById(WEDDING, asGuestId('guest-1'))
    expect(guest?.lastSeenAt).toEqual(AT)
  })

  it('issues a device token scoped to the joined event and the new guest', async () => {
    const result = await join({ joinCode: WEDDING_CODE })

    expect(result.ok && result.value.token).toBe(`token|event-1|guest-1|${AT.getTime()}`)
  })

  it('announces the join, so the host sees the guest arrive', async () => {
    await join({ joinCode: WEDDING_CODE })

    expect(bus.published).toEqual([
      { type: 'guest.joined', eventId: WEDDING, guestId: asGuestId('guest-1') },
    ])
  })

  it('returns the guest id, the stored name and the event the guest just joined', async () => {
    const result = await join({ joinCode: WEDDING_CODE, displayName: 'Léa' })

    expect(
      result.ok && {
        guestId: result.value.guestId,
        displayName: result.value.displayName,
        slug: result.value.event.slug.value,
      },
    ).toEqual({
      guestId: asGuestId('guest-1'),
      displayName: 'Léa',
      slug: 'camille-et-sacha',
    })
  })

  // ------------------------------------------------------------- reading a card --

  /**
   * The card is read off a table in a dark room and typed on a phone keyboard: nothing
   * capitalises, separators are decoration, and `O` and `0` look identical in most
   * fonts. Every one of these has to reach the same event.
   */
  it.each([
    { typed: 'lowercase', code: 'h0k2qm' },
    { typed: 'dash-separated, as printed', code: 'H0K2-QM' },
    { typed: 'with an O for the digit 0', code: 'HOK2QM' },
    { typed: 'with the spaces of a clumsy paste', code: ' h0k2 qm ' },
  ])('lets in a guest who typed the code $typed', async ({ code }) => {
    const result = await join({ joinCode: code })

    expect(result.ok && result.value.event.id).toBe(WEDDING)
  })

  // ------------------------------------------------------------ the closed door --

  it('answers an unknown code with event.notFound', async () => {
    const result = await join({ joinCode: 'Z9Z9Z9' })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  /**
   * The same answer as an unknown code, deliberately. A distinguishable "not open yet"
   * would confirm that a guessed six-character code belongs to a real event, and this
   * is the one endpoint reachable with no credential at all.
   */
  it.each<EventStatus>(['draft', 'closed', 'archived'])(
    'answers a %s event with event.notFound, indistinguishable from a wrong code',
    async (status) => {
      await events.save(aWedding(status))

      const result = await join({ joinCode: WEDDING_CODE })

      expect(!result.ok && result.error.code).toBe('event.notFound')
    },
  )

  it('creates no guest when the event is not open to guests', async () => {
    await events.save(aWedding('draft'))

    await join({ joinCode: WEDDING_CODE })

    expect(await guests.list(WEDDING)).toEqual([])
  })

  it('announces nothing when the join is refused', async () => {
    await events.save(aWedding('draft'))

    await join({ joinCode: WEDDING_CODE })

    expect(bus.published).toEqual([])
  })

  it('reports the shape of a code that could never exist, which reveals no event', async () => {
    const result = await join({ joinCode: 'H0K2Q' })

    expect(!result.ok && result.error.code).toBe('joinCode.wrongLength')
  })

  // --------------------------------------------------------------------- naming --

  /**
   * Zero friction is the guest surface's only rule: someone holding a drink must get
   * from the QR code to an upload without being asked who they are.
   */
  it.each([
    { given: 'no display name at all', input: { joinCode: WEDDING_CODE } },
    { given: 'an explicit null', input: { joinCode: WEDDING_CODE, displayName: null } },
    {
      given: 'a name of nothing but spaces',
      input: { joinCode: WEDDING_CODE, displayName: '   ' },
    },
  ])('joins anonymously when the guest supplies $given', async ({ input }) => {
    const result = await join(input)

    expect(result.ok && result.value.displayName).toBeNull()
  })

  it('stores no name for a guest who stayed anonymous', async () => {
    await join({ joinCode: WEDDING_CODE, displayName: '   ' })

    const guest = await guests.findById(WEDDING, asGuestId('guest-1'))
    expect(guest?.displayName).toBeNull()
  })

  it('refuses a name longer than the wall can show', async () => {
    const result = await join({ joinCode: WEDDING_CODE, displayName: 'Léa'.repeat(20) })

    expect(!result.ok && result.error.code).toBe('displayName.tooLong')
  })

  it('stores no guest when the domain refuses the name', async () => {
    await join({ joinCode: WEDDING_CODE, displayName: 'Léa'.repeat(20) })

    expect(await guests.list(WEDDING)).toEqual([])
  })

  it('spends no guest id on a name the domain refuses', async () => {
    await join({ joinCode: WEDDING_CODE, displayName: 'Léa'.repeat(20) })

    const result = await join({ joinCode: WEDDING_CODE })

    expect(result.ok && result.value.guestId).toBe(asGuestId('guest-1'))
  })

  // ---------------------------------------------------------------- one event --

  it('joins the event whose code was typed, never the other event on the box', async () => {
    const result = await join({ joinCode: GALA_CODE })

    expect(result.ok && result.value.event.id).toBe(GALA)
  })

  it('creates the guest under the code holder alone, so no wedding guest appears', async () => {
    await join({ joinCode: GALA_CODE })

    expect([(await guests.list(GALA)).length, (await guests.list(WEDDING)).length]).toEqual([1, 0])
  })

  it('announces the arrival on the joined event only', async () => {
    await join({ joinCode: GALA_CODE })

    // The whole recording, not `publishedFor(WEDDING)`: an assertion that one event saw
    // nothing also passes when nothing was announced at all.
    expect(bus.published).toEqual([
      { type: 'guest.joined', eventId: GALA, guestId: asGuestId('guest-1') },
    ])
  })
})
