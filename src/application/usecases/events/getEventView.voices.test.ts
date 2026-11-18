import { describe, expect, it } from 'vitest'
import type { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import { asEventId } from '../../../domain/shared/ids'
import { AT, aGuestbookEntry, aVoiceEntry, anEvent } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakePurgeNoticeLedger } from '../../testing/fakePurgeNoticeLedger'
import { makeGetEventLimits } from './getEventLimits'
import { makeGetEventView } from './getEventView'

/**
 * What the album's deletion band says about the voice messages (spec 25, section 10): in the last
 * week before the date, how many recordings are still kept secret (they would leave unheard) and
 * how many wait for a decision (they will not be in the album). The wedding model turns the voices
 * on with a manual moderation, so a host who has not decided the lot loses the rest in silence.
 */

const WEDDING = asEventId('evt-wedding')
const DAY = 86_400_000

/** A closed wedding that closed at `AT` and is purged 30 days later. */
const closedWedding = () =>
  anEvent({
    id: WEDDING,
    slug: 'mariage',
    status: 'closed',
    closedAt: AT,
    settings: { retentionDays: 30, allowGuestbook: true, guestbookVoice: { enabled: true } },
  })

const aWorld = () => {
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ clients })
  const guestbook = new FakeGuestbookRepository()
  const clock = new FakeClock(AT)
  let reads = 0
  const listByStatuses = guestbook.listByStatuses.bind(guestbook)
  guestbook.listByStatuses = async (...args) => {
    reads += 1
    return listByStatuses(...args)
  }
  const getEventView = makeGetEventView({
    events,
    clients,
    notices: new FakePurgeNoticeLedger().withEvents(WEDDING),
    guestbook,
    clock,
    capNoticeDays: 30,
    getEventLimits: makeGetEventLimits({ clients }),
  })
  return { getEventView, events, clients, guestbook, clock, reads: () => reads }
}

const voice = (
  id: string,
  moderation: 'manual' | 'auto',
  state: 'ready' | 'queued' = 'ready',
): GuestbookEntry =>
  aVoiceEntry({ id, eventId: WEDDING, guestId: `guest-${id}`, state, moderation })

describe('getEventView: the voice messages the purge would lose (spec 25)', () => {
  it('counts the recordings waiting for a decision in the last week, and no secret one once the event is closed', async () => {
    const { getEventView, events, guestbook, clock } = aWorld()
    const wedding = closedWedding()
    events.seed(wedding)
    guestbook.seed(voice('v1', 'manual'), voice('v2', 'manual'), voice('v3', 'auto'))
    clock.advance(25 * DAY)

    const { purge } = await getEventView({ event: wedding })

    expect(purge.voices).toEqual({ secret: 0, pending: 2 })
  })

  it('counts no secret recording for a closed event, even one that asked for secrecy: the end of the party lifts it', async () => {
    const { getEventView, events, guestbook, clock } = aWorld()
    const wedding = anEvent({
      id: WEDDING,
      slug: 'mariage',
      status: 'closed',
      closedAt: AT,
      settings: {
        retentionDays: 30,
        allowGuestbook: true,
        guestbookVoice: { enabled: true, sealed: true },
      },
    })
    events.seed(wedding)
    guestbook.seed(voice('v1', 'auto'), voice('v2', 'auto'), voice('v3', 'manual'))
    clock.advance(25 * DAY)

    // A purge date exists only for a closed or archived event, which is when the secret is lifted:
    // the figure is the safety net of a rule that may one day change, and the wiring is this test's.
    expect((await getEventView({ event: wedding })).purge.voices).toEqual({ secret: 0, pending: 1 })
  })

  it('leaves out a recording still being processed and a written message: only a ready recording can be decided', async () => {
    const { getEventView, events, guestbook, clock } = aWorld()
    const wedding = closedWedding()
    events.seed(wedding)
    guestbook.seed(
      voice('v1', 'manual', 'queued'),
      aGuestbookEntry({ id: 'w1', eventId: WEDDING, guestId: 'guest-w', moderation: 'manual' }),
    )
    clock.advance(25 * DAY)

    expect((await getEventView({ event: wedding })).purge.voices).toEqual({ secret: 0, pending: 0 })
  })

  it('starts exactly a week before the date, and not a day earlier', async () => {
    const { getEventView, events, guestbook, clock } = aWorld()
    const wedding = closedWedding()
    events.seed(wedding)
    guestbook.seed(voice('v1', 'manual'))

    clock.advance(22 * DAY)
    const eightDays = await getEventView({ event: wedding })
    clock.advance(1 * DAY)
    const sevenDays = await getEventView({ event: wedding })

    expect(eightDays.purge.voices).toEqual({ secret: 0, pending: 0 })
    expect(sevenDays.purge.voices).toEqual({ secret: 0, pending: 1 })
  })

  it('reads no book before that week, and none for an album with no date', async () => {
    const { getEventView, events, guestbook, clock, reads } = aWorld()
    const wedding = closedWedding()
    const keptForever = anEvent({
      id: asEventId('evt-keep'),
      slug: 'garde',
      joinCode: 'KEEP12',
      status: 'closed',
      closedAt: AT,
      settings: { retentionDays: null },
    })
    events.seed(wedding, keptForever)
    guestbook.seed(voice('v1', 'manual'))

    await getEventView({ event: wedding })
    clock.advance(40 * DAY)
    await getEventView({ event: keptForever })

    expect(reads()).toBe(0)
  })

  it('says nothing once the date has arrived: that is the purge’s business', async () => {
    const { getEventView, events, guestbook, clock } = aWorld()
    const wedding = closedWedding()
    events.seed(wedding)
    guestbook.seed(voice('v1', 'manual'))
    clock.advance(31 * DAY)

    expect((await getEventView({ event: wedding })).purge.voices).toEqual({ secret: 0, pending: 0 })
  })

  it('counts another event’s recordings nowhere', async () => {
    const { getEventView, events, guestbook, clock } = aWorld()
    const wedding = closedWedding()
    events.seed(wedding)
    guestbook.seed(
      aVoiceEntry({
        id: 'v-other',
        eventId: 'evt-other',
        guestId: 'guest-x',
        state: 'ready',
        moderation: 'manual',
      }),
    )
    clock.advance(25 * DAY)

    expect((await getEventView({ event: wedding })).purge.voices).toEqual({ secret: 0, pending: 0 })
  })
})
