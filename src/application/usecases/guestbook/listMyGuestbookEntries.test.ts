import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId, asGuestbookEntryId } from '../../../domain/shared/ids'
import { AT, aGuestbookEntry, aVoiceEntry, anEvent } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeAudioTranscoder } from '../../testing/fakeAudioTranscoder'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { makeListMyGuestbookEntries, type ListMyGuestbookEntries } from './listMyGuestbookEntries'

const EVENT = asEventId('event-1')
const LEA = asGuestId('guest-lea')

describe('listMyGuestbookEntries', () => {
  let events: FakeEventRepository
  let guestbook: FakeGuestbookRepository
  let clock: FakeClock
  let transcoder: FakeAudioTranscoder
  let list: ListMyGuestbookEntries

  beforeEach(() => {
    events = new FakeEventRepository()
    guestbook = new FakeGuestbookRepository()
    clock = new FakeClock()
    events.seed(anEvent({ id: 'event-1', settings: { allowGuestbook: true } }))
    transcoder = new FakeAudioTranscoder()
    list = makeListMyGuestbookEntries({
      events,
      guestbook,
      transcoder,
      clock,
      voiceMaxDurationMs: 45_000,
    })
  })

  const mine = (id: string, moderation: 'manual' | 'auto' = 'manual') =>
    aGuestbookEntry({ id, guestId: 'guest-lea', eventId: 'event-1', text: id, moderation })

  it('lists only the guest own messages of this event, newest first', async () => {
    guestbook.seed(
      aGuestbookEntry({
        id: 'old',
        guestId: 'guest-lea',
        eventId: 'event-1',
        createdAt: new Date(AT.getTime() - 1_000),
      }),
      mine('new'),
      aGuestbookEntry({ id: 'sam', guestId: 'guest-sam', eventId: 'event-1' }),
      aGuestbookEntry({ id: 'other', guestId: 'guest-lea', eventId: 'event-2' }),
    )

    const result = await list({ eventId: EVENT, guestId: LEA })

    expect(result.ok && result.value.items.map((item) => item.entry.id)).toEqual(['new', 'old'])
  })

  it('offers removal while the message is pending, inside the window, and the host allows it', async () => {
    guestbook.seed(mine('m1'))

    const result = await list({ eventId: EVENT, guestId: LEA })

    expect(result.ok && result.value.items[0]?.canDelete).toBe(true)
  })

  it('offers no removal once the message is on the wall', async () => {
    guestbook.seed(mine('m1', 'auto'))

    const result = await list({ eventId: EVENT, guestId: LEA })

    expect(result.ok && result.value.items[0]?.canDelete).toBe(false)
  })

  it('offers no removal when the host switched self-delete off', async () => {
    events.seed(
      anEvent({ id: 'event-1', settings: { allowGuestbook: true, allowGuestSelfDelete: false } }),
    )
    guestbook.seed(mine('m1'))

    const result = await list({ eventId: EVENT, guestId: LEA })

    expect(result.ok && result.value.items[0]?.canDelete).toBe(false)
  })

  it('offers no removal once the grace window is over', async () => {
    guestbook.seed(mine('m1'))
    clock.advance(901_000)

    const result = await list({ eventId: EVENT, guestId: LEA })

    expect(result.ok && result.value.items[0]?.canDelete).toBe(false)
  })

  it('never lists a message the operator took down', async () => {
    guestbook.seed(mine('m1'))
    guestbook.takeDown(EVENT, asGuestbookEntryId('m1'), new Date(0))

    const result = await list({ eventId: EVENT, guestId: LEA })

    expect(result.ok && result.value.items).toEqual([])
  })

  it('says whether published messages are shown on the wall, for the status the author reads', async () => {
    const shown = await list({ eventId: EVENT, guestId: LEA })
    expect(shown.ok && shown.value.onWall).toBe(true)

    events.seed(anEvent({ id: 'event-1', settings: { guestbookOnWall: false } }))
    const hidden = await list({ eventId: EVENT, guestId: LEA })
    expect(hidden.ok && hidden.value.onWall).toBe(false)
  })

  it('says a new message would be taken only when the switch is on and the event takes messages', async () => {
    const on = await list({ eventId: EVENT, guestId: LEA })
    expect(on.ok && on.value.accepting).toBe(true)

    events.seed(anEvent({ id: 'event-1', settings: { allowGuestbook: false } }))
    const off = await list({ eventId: EVENT, guestId: LEA })
    expect(off.ok && off.value.accepting).toBe(false)

    events.seed(anEvent({ id: 'event-1', status: 'archived', settings: { allowGuestbook: true } }))
    const archived = await list({ eventId: EVENT, guestId: LEA })
    expect(archived.ok && archived.value.accepting).toBe(false)
  })

  it('still lists the messages of a closed event, whose window has passed', async () => {
    events.seed(
      anEvent({
        id: 'event-1',
        status: 'closed',
        closedAt: new Date(AT.getTime() - 30 * 86_400_000),
        settings: { allowGuestbook: true },
      }),
    )
    guestbook.seed(mine('m1'))

    const result = await list({ eventId: EVENT, guestId: LEA })

    expect(result.ok && result.value.items).toHaveLength(1)
    expect(result.ok && result.value.accepting).toBe(false)
  })

  it('answers an event that is taken down, or unknown, as not there', async () => {
    const unknown = await list({ eventId: asEventId('nope'), guestId: LEA })
    expect(!unknown.ok && unknown.error.code).toBe('event.notFound')

    await events.setTakenDown(EVENT, new Date(0))
    const down = await list({ eventId: EVENT, guestId: LEA })
    expect(!down.ok && down.error.code).toBe('event.notFound')
  })

  describe('whether a voice message would be taken (voiceAvailable)', () => {
    const voiceOn = (settings: Parameters<typeof anEvent>[0] = {}): void => {
      events.seed(
        anEvent({
          id: 'event-1',
          ...settings,
          settings: {
            allowGuestbook: true,
            guestbookVoice: { enabled: true },
            ...settings.settings,
          },
        }),
      )
    }
    const available = async (): Promise<boolean | null> => {
      const result = await list({ eventId: EVENT, guestId: LEA })
      return result.ok ? result.value.voiceAvailable : null
    }

    it('is true when the book is on, the voice is on, the window is open and the box can encode', async () => {
      voiceOn()

      expect(await available()).toBe(true)
    })

    it('is false while the host has not switched the voice on, which is every event until they do', async () => {
      expect(await available()).toBe(false)
    })

    it('is false when the voice is on but the book is off: the voice depends on it', async () => {
      voiceOn({ settings: { allowGuestbook: false } })

      expect(await available()).toBe(false)
    })

    it('is false on a box with no encoder, whatever the host chose: the button must not be offered', async () => {
      voiceOn()
      transcoder.unavailable()

      expect(await available()).toBe(false)
    })

    it('is false once the closed-event window is over, with the book itself', async () => {
      voiceOn({ status: 'closed' })
      clock.advance(8 * 24 * 3_600_000)

      expect(await available()).toBe(false)
    })
  })

  it('says the longest voice message the box takes, in whole seconds, so the phone stops before a refusal', async () => {
    const result = await list({ eventId: EVENT, guestId: LEA })

    expect(result.ok && result.value.voiceMaxSeconds).toBe(45)
  })

  describe('a voice message', () => {
    const voice = (
      id: string,
      state: 'queued' | 'ready' | 'failed',
      moderation: 'manual' | 'auto',
    ) => aVoiceEntry({ id, state, guestId: 'guest-lea', eventId: 'event-1', moderation })

    it('is listed with no text, a failed one included, since that is how its author learns it did not save', async () => {
      guestbook.seed(voice('v1', 'ready', 'manual'), voice('v2', 'failed', 'manual'))

      const result = await list({ eventId: EVENT, guestId: LEA })

      expect(result.ok && result.value.items.map((item) => item.entry.text)).toEqual([null, null])
      expect(result.ok && result.value.items.map((item) => item.entry.voice?.state).sort()).toEqual(
        ['failed', 'ready'],
      )
    })

    it('can be removed by its author while published on arrival, which a photograph cannot', async () => {
      guestbook.seed(voice('v1', 'ready', 'auto'))

      const result = await list({ eventId: EVENT, guestId: LEA })

      expect(result.ok && result.value.items[0]?.canDelete).toBe(true)
    })

    it('can be removed when it failed, even where the host switched self-removal off', async () => {
      events.seed(
        anEvent({ id: 'event-1', settings: { allowGuestbook: true, allowGuestSelfDelete: false } }),
      )
      guestbook.seed(voice('v1', 'failed', 'manual'), voice('v2', 'ready', 'manual'))

      const result = await list({ eventId: EVENT, guestId: LEA })

      const byId = new Map<string, boolean>(
        result.ok ? result.value.items.map((item) => [item.entry.id, item.canDelete]) : [],
      )
      expect(byId.get('v1')).toBe(true)
      expect(byId.get('v2')).toBe(false)
    })
  })
})
