import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { aGuest, anEvent, atPlus } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { makeRenameGuest, type RenameGuestInput } from './renameGuest'

const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')
const LEA = asGuestId('guest-1')
const SACHA = asGuestId('guest-2')

describe('renameGuest', () => {
  let guests: FakeGuestRepository
  let events: FakeEventRepository

  const rename = (input: RenameGuestInput) => makeRenameGuest({ guests, events })(input)

  /** The common case: a guest renaming themselves at the wedding they joined. */
  const renameSelf = (displayName: string | null, guestId = LEA) =>
    rename({ eventId: WEDDING, actingGuestId: guestId, guestId, displayName })

  beforeEach(() => {
    events = new FakeEventRepository().seed(
      anEvent({ id: WEDDING, slug: 'mariage', joinCode: 'H7K2QM', status: 'live' }),
      anEvent({ id: GALA, slug: 'gala', joinCode: 'B4N9PT', status: 'live' }),
    )
    guests = new FakeGuestRepository().seed(
      aGuest({ id: LEA, eventId: WEDDING, displayName: 'Léa' }),
      aGuest({ id: SACHA, eventId: WEDDING, displayName: 'Sacha' }),
    )
  })

  // ------------------------------------------------------------------- renaming --

  it('stores the new name, which is what the wall will show', async () => {
    await renameSelf('Léa B.')

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.label()).toBe('Léa B.')
  })

  it('returns the renamed guest, so the phone shows the name the server kept', async () => {
    const result = await renameSelf('Léa B.')

    expect(result.ok && result.value.label()).toBe('Léa B.')
  })

  /** Second thoughts about being named on a screen in front of a room. */
  it.each([
    { given: 'null', displayName: null },
    { given: 'nothing but spaces', displayName: '   ' },
  ])('takes the name off the wall when the guest sends $given', async ({ displayName }) => {
    await renameSelf(displayName)

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.label()).toBeNull()
  })

  it('refuses a name longer than the wall can show', async () => {
    const result = await renameSelf('Léa'.repeat(20))

    expect(!result.ok && result.error.code).toBe('displayName.tooLong')
  })

  it('keeps the stored name when the new one is refused', async () => {
    await renameSelf('Léa'.repeat(20))

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.label()).toBe('Léa')
  })

  // ---------------------------------------------------------- only while it is live --

  /**
   * The name is printed on the wall of a closed event, unmoderated. Once the host closes it the credit
   * under the photographs they approved is fixed: the refusal is the one an upload gets, and the rule
   * is the upload's own (`acceptsUploads()`), so the two cannot disagree.
   */
  it.each(['closed', 'archived', 'draft'] as const)(
    'refuses a rename once the event is %s, with the 409 an upload gets',
    async (status) => {
      await events.delete(WEDDING)
      events.seed(anEvent({ id: WEDDING, slug: 'mariage', joinCode: 'H7K2QM', status }))

      const result = await renameSelf('Léa B.')

      expect(!result.ok && result.error.kind).toBe('conflict')
      expect(!result.ok && result.error.code).toBe('event.notAcceptingUploads')
      expect(!result.ok && result.error.details).toEqual({ status })
    },
  )

  it('keeps the name as the host last saw it when the event is closed', async () => {
    await events.delete(WEDDING)
    events.seed(anEvent({ id: WEDDING, slug: 'mariage', joinCode: 'H7K2QM', status: 'closed' }))

    await renameSelf('Léa B.')

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.label()).toBe('Léa')
  })

  it('asks who is renaming before it asks about the event, so a closed event is not a probe of guest ids', async () => {
    await events.delete(WEDDING)
    events.seed(anEvent({ id: WEDDING, slug: 'mariage', joinCode: 'H7K2QM', status: 'closed' }))

    const result = await rename({
      eventId: WEDDING,
      actingGuestId: LEA,
      guestId: SACHA,
      displayName: 'Un autre nom',
    })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
  })

  it('refuses a rename at the event of a suspended client, as an upload there is refused', async () => {
    // `acceptsUploads()` is false while the client is suspended: the rule is the upload's own, not a
    // copy of its status test.
    await events.delete(WEDDING)
    events.seed(
      Event.restore({
        ...anEvent({ id: WEDDING, slug: 'mariage', joinCode: 'H7K2QM', status: 'live' }).toProps(),
        clientSuspendedAt: atPlus(0),
      }),
    )

    const result = await renameSelf('Léa B.')

    expect(!result.ok && result.error.code).toBe('event.notAcceptingUploads')
  })

  it('asks about the event before it reads any guest row', async () => {
    await events.delete(WEDDING)
    events.seed(anEvent({ id: WEDDING, slug: 'mariage', joinCode: 'H7K2QM', status: 'closed' }))
    const absent = asGuestId('guest-inconnu')

    const result = await renameSelf('Léa B.', absent)

    expect(!result.ok && result.error.code).toBe('event.notAcceptingUploads')
  })

  it('answers an event that is not there as such', async () => {
    await events.delete(WEDDING)

    const result = await renameSelf('Léa B.')

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  // ---------------------------------------------------------------- theirs only --

  /**
   * The name is projected under a photo in front of a room, so editing someone else's
   * would be a way to put words under another guest's picture.
   */
  it('refuses a guest renaming another guest', async () => {
    const result = await rename({
      eventId: WEDDING,
      actingGuestId: LEA,
      guestId: SACHA,
      displayName: 'Un autre nom',
    })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('leaves the other guest untouched when a rename is refused', async () => {
    await rename({
      eventId: WEDDING,
      actingGuestId: LEA,
      guestId: SACHA,
      displayName: 'Un autre nom',
    })

    const stored = await guests.findById(WEDDING, SACHA)
    expect(stored?.label()).toBe('Sacha')
  })

  // ----------------------------------------------------------------- one event --

  it('cannot reach a guest of another event, even holding that guest id', async () => {
    const atTheGala = asGuestId('guest-gala')
    guests.seed(aGuest({ id: atTheGala, eventId: GALA, displayName: 'Sam' }))

    const result = await rename({
      eventId: WEDDING,
      actingGuestId: atTheGala,
      guestId: atTheGala,
      displayName: 'Un autre nom',
    })

    expect(!result.ok && result.error.code).toBe('guest.notFound')
  })

  it('renames the row at the event in the request, never the same id elsewhere', async () => {
    guests.seed(aGuest({ id: LEA, eventId: GALA, displayName: 'Léa au gala' }))

    await rename({ eventId: GALA, actingGuestId: LEA, guestId: LEA, displayName: 'Léa B.' })

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.label()).toBe('Léa')
  })

  it('answers a guest id that does not exist with guest.notFound', async () => {
    const result = await renameSelf('Léa B.', asGuestId('guest-inconnu'))

    expect(!result.ok && result.error.code).toBe('guest.notFound')
  })

  // ----------------------------------------------------------------- revocation --

  it('refuses a guest the host has revoked', async () => {
    guests.seed(aGuest({ id: LEA, eventId: WEDDING, displayName: 'Léa', revokedAt: atPlus(1_000) }))

    const result = await renameSelf('Léa B.')

    expect(!result.ok && result.error.code).toBe('guest.revoked')
  })

  it('keeps the name of a revoked guest as the host last saw it', async () => {
    guests.seed(aGuest({ id: LEA, eventId: WEDDING, displayName: 'Léa', revokedAt: atPlus(1_000) }))

    await renameSelf('Léa B.')

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.label()).toBe('Léa')
  })
})
