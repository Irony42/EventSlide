import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { aGuest, atPlus } from '../../testing/builders'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { makeRenameGuest, type RenameGuestInput } from './renameGuest'

const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')
const LEA = asGuestId('guest-1')
const SACHA = asGuestId('guest-2')

describe('renameGuest', () => {
  let guests: FakeGuestRepository

  const rename = (input: RenameGuestInput) => makeRenameGuest({ guests })(input)

  /** The common case: a guest renaming themselves at the wedding they joined. */
  const renameSelf = (displayName: string | null, guestId = LEA) =>
    rename({ eventId: WEDDING, actingGuestId: guestId, guestId, displayName })

  beforeEach(() => {
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
