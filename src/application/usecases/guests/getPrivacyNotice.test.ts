import { beforeEach, describe, expect, it } from 'vitest'
import { privacyNoticeFor } from '../../../domain/privacy/privacyNotice'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { aGuest, anEvent, anEventSettings, atPlus } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { makeGetPrivacyNotice, type GetPrivacyNotice } from './getPrivacyNotice'

const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')
const LEA = asGuestId('guest-1')

/** The notice a wedding configured like this one produces, for stating what was read. */
const noticeOf = (retentionDays: number | null) =>
  privacyNoticeFor(anEventSettings({ retentionDays }))

describe('getPrivacyNotice', () => {
  let events: FakeEventRepository
  let guests: FakeGuestRepository
  let getPrivacyNotice: GetPrivacyNotice

  beforeEach(() => {
    events = new FakeEventRepository().seed(
      anEvent({
        id: WEDDING,
        slug: 'mariage',
        joinCode: 'H7K2QM',
        settings: { retentionDays: 30 },
      }),
      anEvent({ id: GALA, slug: 'gala', joinCode: 'Z3N9PT', settings: { retentionDays: null } }),
    )
    guests = new FakeGuestRepository()
    getPrivacyNotice = makeGetPrivacyNotice({ events, guests })
  })

  it('answers the notice the event is configured to give', async () => {
    guests.seed(aGuest({ id: LEA, eventId: WEDDING }))

    const result = await getPrivacyNotice({ eventId: WEDDING, guestId: LEA })

    expect(result.ok && result.value.notice).toEqual(noticeOf(30))
  })

  it('reports a guest who has never read it as not having acknowledged it', async () => {
    guests.seed(aGuest({ id: LEA, eventId: WEDDING }))

    const result = await getPrivacyNotice({ eventId: WEDDING, guestId: LEA })

    expect(result.ok && result.value.acknowledgement).toBe('none')
  })

  it('reports a guest who read the notice in force as done with it', async () => {
    guests.seed(
      aGuest({
        id: LEA,
        eventId: WEDDING,
        noticeAcknowledgement: { revision: noticeOf(30).revision, at: atPlus(1_000) },
      }),
    )

    const result = await getPrivacyNotice({ eventId: WEDDING, guestId: LEA })

    expect(result.ok && result.value.acknowledgement).toBe('current')
  })

  it('asks again once the host has changed the retention period since the guest read it', async () => {
    // The re-ask rule, through the orchestration: the guest's row still says 30 days, the
    // event now keeps the album forever, and nothing but this comparison tells the phone.
    guests.seed(
      aGuest({
        id: LEA,
        eventId: WEDDING,
        noticeAcknowledgement: { revision: noticeOf(30).revision, at: atPlus(1_000) },
      }),
    )
    const wedding = await events.findById(WEDDING)
    const changed = wedding?.withSettings(anEventSettings({ retentionDays: null }))
    if (changed === undefined || !changed.ok) throw new Error('test setup: settings refused')
    await events.save(changed.value)

    const result = await getPrivacyNotice({ eventId: WEDDING, guestId: LEA })

    expect(result.ok && result.value.acknowledgement).toBe('outdated')
    expect(result.ok && result.value.notice.retentionDays).toBeNull()
  })

  it('refuses a guest of another event, whose id names nobody here', async () => {
    guests.seed(aGuest({ id: LEA, eventId: GALA }))

    const result = await getPrivacyNotice({ eventId: WEDDING, guestId: LEA })

    expect(!result.ok && result.error.code).toBe('guest.notFound')
  })

  it('refuses an event that does not exist', async () => {
    const result = await getPrivacyNotice({ eventId: asEventId('nope'), guestId: LEA })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
