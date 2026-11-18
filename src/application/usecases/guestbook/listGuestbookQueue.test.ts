import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import { aGuest, aGuestbookEntry, aVoiceEntry, anEvent, atPlus, AT } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { makeListGuestbookQueue, type ListGuestbookQueue } from './listGuestbookQueue'

const EVENT = asEventId('event-1')
const MODERATOR = asUserId('user-2')
const moderator: PhotoActor = { kind: 'host', userId: MODERATOR }
const guest: PhotoActor = { kind: 'guest', guestId: asGuestId('guest-1') }

describe('listGuestbookQueue', () => {
  let events: FakeEventRepository
  let guestbook: FakeGuestbookRepository
  let guests: FakeGuestRepository
  let memberships: FakeMembershipRepository
  let list: ListGuestbookQueue

  beforeEach(() => {
    events = new FakeEventRepository()
    guestbook = new FakeGuestbookRepository()
    guests = new FakeGuestRepository()
    memberships = new FakeMembershipRepository()
    list = makeListGuestbookQueue({
      events,
      guestbook,
      guests,
      memberships,
      clock: new FakeClock(),
    })
    events.seed(anEvent({ id: 'event-1' }))
    memberships.seed({ eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT })
    guests.seed(aGuest({ id: 'guest-1', displayName: 'Léa' }))
  })

  const run = (input: { status?: 'pending' | 'published' | null; limit?: number } = {}) =>
    list({ eventId: EVENT, status: null, limit: 100, actor: moderator, ...input })

  const ids = async (input: Parameters<typeof run>[0] = {}): Promise<string[]> => {
    const result = await run(input)
    return result.ok ? result.value.items.map((row) => row.entry.id) : []
  }

  it('puts the oldest pending message first, then the published ones, with the author name', async () => {
    guestbook.seed(
      aGuestbookEntry({ id: 'pub', guestId: 'guest-1', moderation: 'auto', createdAt: atPlus(1) }),
      aGuestbookEntry({ id: 'new', guestId: 'guest-1', createdAt: atPlus(5) }),
      aGuestbookEntry({ id: 'old', guestId: 'guest-1', createdAt: atPlus(2) }),
    )

    const result = await run()

    expect(result.ok && result.value.items.map((row) => row.entry.id)).toEqual([
      'old',
      'new',
      'pub',
    ])
    expect(result.ok && result.value.items[0]?.authorName).toBe('Léa')
  })

  it('says null for an author who gave no name or whose row is gone, never an invented one', async () => {
    guests.seed(aGuest({ id: 'guest-2', displayName: null }))
    guestbook.seed(
      aGuestbookEntry({ id: 'a', guestId: 'guest-2' }),
      aGuestbookEntry({ id: 'b', guestId: 'guest-gone', createdAt: atPlus(1) }),
    )

    const result = await run()

    expect(result.ok && result.value.items.map((row) => row.authorName)).toEqual([null, null])
  })

  it('filters by status, and counts pending over the whole book, not the tab', async () => {
    guestbook.seed(
      aGuestbookEntry({ id: 'pub', moderation: 'auto' }),
      aGuestbookEntry({ id: 'w1', createdAt: atPlus(1) }),
      aGuestbookEntry({ id: 'w2', createdAt: atPlus(2) }),
    )

    const result = await run({ status: 'published' })

    expect(result.ok && result.value.items.map((row) => row.entry.id)).toEqual(['pub'])
    expect(result.ok && result.value.pendingCount).toBe(2)
  })

  it('applies the limit after the order, so a limit never pushes the oldest pending off the page', async () => {
    guestbook.seed(
      aGuestbookEntry({ id: 'pub', moderation: 'auto', createdAt: atPlus(9) }),
      aGuestbookEntry({ id: 'w1', createdAt: atPlus(1) }),
      aGuestbookEntry({ id: 'w2', createdAt: atPlus(2) }),
    )

    expect(await ids({ limit: 1 })).toEqual(['w1'])
  })

  it('shows another event no message of this one, and never an operator-removed one', async () => {
    guestbook.seed(
      aGuestbookEntry({ id: 'mine' }),
      aGuestbookEntry({ id: 'theirs', eventId: 'event-2' }),
      aGuestbookEntry({ id: 'down', createdAt: atPlus(1) }),
    )
    guestbook.takeDown(EVENT, 'down' as never, AT)

    expect(await ids()).toEqual(['mine'])
  })

  it('refuses a guest, a stranger, a missing event and a suspended client', async () => {
    const code = async (promise: ReturnType<typeof run>) => {
      const result = await promise
      return result.ok ? null : result.error.code
    }
    expect(await code(list({ eventId: EVENT, status: null, limit: 1, actor: guest }))).toBe(
      'auth.forbidden',
    )
    expect(
      await code(
        list({
          eventId: EVENT,
          status: null,
          limit: 1,
          actor: { kind: 'host', userId: asUserId('user-99') },
        }),
      ),
    ).toBe('event.notFound')
    expect(
      await code(list({ eventId: asEventId('nope'), status: null, limit: 1, actor: moderator })),
    ).toBe('event.notFound')

    events.seed(Event.restore({ ...anEvent({ id: 'event-1' }).toProps(), clientSuspendedAt: AT }))
    expect(await code(run())).toBe('client.suspended')
  })

  it('still reads an archived event, which is a record', async () => {
    events.seed(anEvent({ id: 'event-1', status: 'archived' }))
    guestbook.seed(aGuestbookEntry({ id: 'm' }))

    expect(await ids()).toEqual(['m'])
  })

  it('lists a voice message with no text, and leaves out one whose processing failed', async () => {
    guestbook.seed(
      aVoiceEntry({ id: 'v-ready', state: 'ready', guestId: 'guest-1', createdAt: atPlus(1) }),
      aVoiceEntry({
        id: 'v-failed',
        state: 'failed',
        guestId: 'guest-1',
        createdAt: atPlus(2),
        sourceHash: 'b'.repeat(64),
      }),
      aGuestbookEntry({ id: 'text', guestId: 'guest-1', createdAt: atPlus(3) }),
    )

    const result = await run()

    expect(result.ok && result.value.items.map((row) => row.entry.id)).toEqual(['v-ready', 'text'])
    expect(result.ok && result.value.items[0]?.entry.text).toBeNull()
    expect(result.ok && result.value.pendingCount).toBe(2)
  })

  describe('voice messages (spec 25)', () => {
    const voice = (id: string, state: 'reserved' | 'queued' | 'running' | 'ready' | 'failed') =>
      aVoiceEntry({
        id,
        state,
        guestId: 'guest-1',
        sourceHash: Buffer.from(id).toString('hex').padEnd(64, '0'),
        createdAt: atPlus(1),
      })

    it('lists a voice only once ready, and counts the ones still being processed apart', async () => {
      guestbook.seed(
        voice('v-ready', 'ready'),
        voice('v-reserved', 'reserved'),
        voice('v-queued', 'queued'),
        voice('v-running', 'running'),
        voice('v-failed', 'failed'),
        aGuestbookEntry({ id: 'text', guestId: 'guest-1', createdAt: atPlus(3) }),
      )

      const result = await run()

      expect(result.ok && result.value.items.map((row) => row.entry.id)).toEqual([
        'v-ready',
        'text',
      ])
      expect(result.ok && result.value.voice.processing).toBe(3)
    })

    it('does not count a voice that cannot be decided yet as waiting for a decision', async () => {
      guestbook.seed(
        voice('v-ready', 'ready'),
        voice('v-queued', 'queued'),
        voice('v-running', 'running'),
      )

      const result = await run()

      expect(result.ok && result.value.pendingCount).toBe(1)
    })

    it('says none are processing when there is no voice at all', async () => {
      guestbook.seed(aGuestbookEntry({ id: 'text', guestId: 'guest-1' }))

      const result = await run()

      expect(result.ok && result.value.voice).toEqual({
        processing: 0,
        sealed: false,
        opensAtMs: null,
        nowMs: AT.getTime(),
      })
    })

    it('says the secret is on while it is, with the instant it was set to lift and the server’s now', async () => {
      events.seed(
        anEvent({
          id: 'event-1',
          settings: {
            allowGuestbook: true,
            guestbookVoice: { enabled: true, sealed: true, opensAtMs: AT.getTime() + 60_000 },
          },
        }),
      )

      const result = await run()

      expect(result.ok && result.value.voice).toEqual({
        processing: 0,
        sealed: true,
        opensAtMs: AT.getTime() + 60_000,
        nowMs: AT.getTime(),
      })
    })

    it('says the secret is lifted once the event is over, whatever time was set', async () => {
      events.seed(
        anEvent({
          id: 'event-1',
          status: 'closed',
          settings: { allowGuestbook: true, guestbookVoice: { enabled: true, sealed: true } },
        }),
      )

      const result = await run()

      expect(result.ok && result.value.voice.sealed).toBe(false)
    })
  })
})
