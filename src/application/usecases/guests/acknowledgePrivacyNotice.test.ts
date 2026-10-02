import { beforeEach, describe, expect, it } from 'vitest'
import { privacyNoticeFor } from '../../../domain/privacy/privacyNotice'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { AT, aClient, aGuest, anEvent, anEventSettings, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import {
  makeAcknowledgePrivacyNotice,
  type AcknowledgePrivacyNotice,
} from './acknowledgePrivacyNotice'

const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')
const LEA = asGuestId('guest-1')

const THIRTY_DAYS = privacyNoticeFor(anEventSettings({ retentionDays: 30 }))
const FOREVER = privacyNoticeFor(anEventSettings({ retentionDays: null }))

describe('acknowledgePrivacyNotice', () => {
  let events: FakeEventRepository
  let guests: FakeGuestRepository
  let clock: FakeClock
  let acknowledge: AcknowledgePrivacyNotice

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
    guests = new FakeGuestRepository().seed(aGuest({ id: LEA, eventId: WEDDING }))
    clock = new FakeClock(atPlus(5_000))
    acknowledge = makeAcknowledgePrivacyNotice({
      events,
      clients: new FakeClientRepository(),
      guests,
      clock,
    })
  })

  it('records on the guest’s row which notice they read, and when', async () => {
    await acknowledge({ eventId: WEDDING, guestId: LEA, revision: THIRTY_DAYS.revision })

    const stored = await guests.findById(WEDDING, LEA)
    expect(stored?.noticeAcknowledgement).toEqual({
      revision: THIRTY_DAYS.revision,
      at: atPlus(5_000),
    })
  })

  it('answers that the guest is now done with the notice, so the phone can show the picker', async () => {
    const result = await acknowledge({
      eventId: WEDDING,
      guestId: LEA,
      revision: THIRTY_DAYS.revision,
    })

    expect(result.ok && result.value).toEqual({ notice: THIRTY_DAYS, acknowledgement: 'current' })
  })

  it('refuses a notice the host has changed since the guest read it, and records nothing', async () => {
    // The guest's screen showed 30 days; the event now keeps the album forever. Storing
    // their tap would be a record that they agreed to a text that is no longer true.
    const result = await acknowledge({
      eventId: WEDDING,
      guestId: LEA,
      revision: FOREVER.revision,
    })

    expect(!result.ok && result.error.code).toBe('privacyNotice.outdated')
    expect((await guests.findById(WEDDING, LEA))?.noticeAcknowledgement).toBeNull()
  })

  it('keeps the first instant when the guest taps twice', async () => {
    await acknowledge({ eventId: WEDDING, guestId: LEA, revision: THIRTY_DAYS.revision })
    clock.advance(60_000)

    await acknowledge({ eventId: WEDDING, guestId: LEA, revision: THIRTY_DAYS.revision })

    expect((await guests.findById(WEDDING, LEA))?.noticeAcknowledgement?.at).toEqual(atPlus(5_000))
  })

  it('refuses a guest the host has removed, and records nothing', async () => {
    guests.seed(aGuest({ id: LEA, eventId: WEDDING, revokedAt: AT }))

    const result = await acknowledge({
      eventId: WEDDING,
      guestId: LEA,
      revision: THIRTY_DAYS.revision,
    })

    expect(!result.ok && result.error.code).toBe('guest.revoked')
    expect((await guests.findById(WEDDING, LEA))?.noticeAcknowledgement).toBeNull()
  })

  it('refuses a guest of another event, whose id names nobody here', async () => {
    guests.seed(aGuest({ id: asGuestId('guest-gala'), eventId: GALA }))

    const result = await acknowledge({
      eventId: WEDDING,
      guestId: asGuestId('guest-gala'),
      revision: THIRTY_DAYS.revision,
    })

    expect(!result.ok && result.error.code).toBe('guest.notFound')
    expect((await guests.findById(GALA, asGuestId('guest-gala')))?.noticeAcknowledgement).toBeNull()
  })

  it('refuses an event that does not exist', async () => {
    const result = await acknowledge({
      eventId: asEventId('nope'),
      guestId: LEA,
      revision: THIRTY_DAYS.revision,
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  // ------------------------------------------ an event of a client with a ceiling --

  describe('for an event of a client with a retention ceiling', () => {
    const CLIENT_EVENT = asEventId('event-client')
    const THE_CEILING = privacyNoticeFor(anEventSettings({ retentionDays: 30 }))

    const build = (): AcknowledgePrivacyNotice => {
      const clients = new FakeClientRepository().seed(
        aClient({ id: 'client-1', ceilings: { maxRetentionDays: 30 } }),
      )
      const clientEvents = new FakeEventRepository({ clients }).seed(
        anEvent({
          id: CLIENT_EVENT,
          slug: 'soiree-cliente',
          joinCode: 'K8M3NP',
          clientId: 'client-1',
          settings: { retentionDays: null },
        }),
      )
      guests.seed(aGuest({ id: asGuestId('guest-2'), eventId: CLIENT_EVENT }))
      return makeAcknowledgePrivacyNotice({ events: clientEvents, clients, guests, clock })
    }

    it('accepts the revision the join handed out, which carries the ceiling and not the host’s “for ever”', async () => {
      const result = await build()({
        eventId: CLIENT_EVENT,
        guestId: asGuestId('guest-2'),
        revision: THE_CEILING.revision,
      })

      expect(result.ok && result.value).toEqual({ notice: THE_CEILING, acknowledgement: 'current' })
    })

    it('does not accept the revision of the host’s own setting, which the notice no longer says', async () => {
      const result = await build()({
        eventId: CLIENT_EVENT,
        guestId: asGuestId('guest-2'),
        revision: FOREVER.revision,
      })

      expect(result.ok).toBe(false)
    })
  })
})
