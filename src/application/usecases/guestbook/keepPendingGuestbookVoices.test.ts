import { beforeEach, describe, expect, it } from 'vitest'
import type { PhotoActor } from '../../../domain/photos/photo'
import {
  asClientId,
  asEventId,
  asGuestId,
  asGuestbookEntryId,
  asUserId,
} from '../../../domain/shared/ids'
import { AT, aClient, aGuestbookEntry, aVoiceEntry, anEvent, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import type { InvalidateExport } from '../exports/invalidateAlbumExport'
import {
  makeKeepPendingGuestbookVoices,
  type KeepPendingGuestbookVoices,
} from './keepPendingGuestbookVoices'

/**
 * "Garder les N messages en attente" (spec 25, question 20): publish the ready voices that wait
 * for a decision, and nothing else.
 */

const EVENT = asEventId('event-1')
const MODERATOR = asUserId('user-moderator')
const STRANGER = asUserId('user-stranger')
const CLIENT = asClientId('client-1')

const host = (userId: typeof MODERATOR): PhotoActor => ({ kind: 'host', userId })
const idOf = (id: string) => asGuestbookEntryId(id)

describe('keepPendingGuestbookVoices', () => {
  let clients: FakeClientRepository
  let events: FakeEventRepository
  let guestbook: FakeGuestbookRepository
  let memberships: FakeMembershipRepository
  let audit: FakeAuditLog
  let bus: RecordingEventBus
  let log: string[]
  let keep: KeepPendingGuestbookVoices

  const statusOf = async (id: string) => (await guestbook.findById(EVENT, idOf(id)))?.status

  const voice = (id: string, state: 'queued' | 'running' | 'ready' | 'failed', extra = {}) =>
    aVoiceEntry({
      id,
      state,
      eventId: 'event-1',
      sourceHash: Buffer.from(id).toString('hex').padEnd(64, '0'),
      ...extra,
    })

  const run = (actor: PhotoActor = host(MODERATOR)) => keep({ eventId: EVENT, actor })

  beforeEach(() => {
    clients = new FakeClientRepository().seed(aClient({ id: 'client-1' }))
    events = new FakeEventRepository({ clients })
    guestbook = new FakeGuestbookRepository()
    memberships = new FakeMembershipRepository()
    audit = new FakeAuditLog().withAccounts(MODERATOR)
    bus = new RecordingEventBus()
    log = []

    const save = guestbook.save.bind(guestbook)
    guestbook.save = async (entry) => {
      log.push(`saved ${entry.id}`)
      return save(entry)
    }
    const invalidateExport: InvalidateExport = async (_eventId, reason) => {
      log.push(`archive retired: ${reason}`)
    }

    keep = makeKeepPendingGuestbookVoices({
      events,
      guestbook,
      memberships,
      audit,
      bus,
      clock: new FakeClock(atPlus(9_000)),
      invalidateExport,
    })
    memberships.seed({ eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT })
    events.seed(anEvent({ id: 'event-1', clientId: CLIENT }))
  })

  it('publishes every ready voice that is waiting, and says how many', async () => {
    guestbook.seed(
      voice('a1', 'ready', { createdAt: atPlus(1) }),
      voice('a2', 'ready', { createdAt: atPlus(2) }),
    )

    const result = await run()

    expect(result.ok && result.value).toEqual({ kept: 2 })
    expect(await statusOf('a1')).toBe('published')
    expect(await statusOf('a2')).toBe('published')
  })

  it('records the moderator as the one who decided, and the instant', async () => {
    guestbook.seed(voice('a1', 'ready'))

    await run()

    expect((await guestbook.findById(EVENT, idOf('a1')))?.review).toEqual({
      kind: 'host',
      userId: MODERATOR,
      at: atPlus(9_000),
    })
  })

  it.each(['queued', 'running', 'failed'] as const)(
    'leaves a voice that is %s alone: there is nothing to listen to, so nothing to keep',
    async (state) => {
      guestbook.seed(voice('a1', state), voice('a2', 'ready', { createdAt: atPlus(1) }))

      const result = await run()

      expect(result.ok && result.value.kept).toBe(1)
      expect(await statusOf('a1')).toBe('pending')
      expect(await statusOf('a2')).toBe('published')
    },
  )

  it('leaves a refused voice refused, and a written message waiting: this is for recordings only', async () => {
    guestbook.seed(
      voice('refused', 'ready'),
      aGuestbookEntry({ id: 'written', eventId: 'event-1' }),
      voice('ok', 'ready', { createdAt: atPlus(1) }),
    )
    const refused = await guestbook.findById(EVENT, idOf('refused'))
    const moved = refused?.reject({ kind: 'host', userId: MODERATOR }, atPlus(3))
    if (moved?.ok !== true) throw new Error('fixture')
    await guestbook.save(moved.value)
    log.length = 0

    const result = await run()

    expect(result.ok && result.value.kept).toBe(1)
    expect(await statusOf('refused')).toBe('rejected')
    expect(await statusOf('written')).toBe('pending')
  })

  it('leaves a voice already published as it was, and does not count it', async () => {
    guestbook.seed(voice('auto', 'ready', { moderation: 'auto' }))

    const result = await run()

    expect(result.ok && result.value.kept).toBe(0)
    expect(log).toEqual([])
  })

  describe('with nothing to keep it is quiet, as a second tap should be', () => {
    it('writes no audit line, retires no archive and says nothing on the bus', async () => {
      guestbook.seed(voice('a1', 'queued'))

      const result = await run()

      expect(result.ok && result.value).toEqual({ kept: 0 })
      expect(audit.all()).toEqual([])
      expect(bus.published).toEqual([])
      expect(log).toEqual([])
    })

    it('is idempotent: the second call keeps nothing more', async () => {
      guestbook.seed(voice('a1', 'ready'))
      await run()

      const again = await run()

      expect(again.ok && again.value.kept).toBe(0)
      expect(audit.all()).toHaveLength(1)
    })
  })

  describe('what it leaves behind', () => {
    beforeEach(() => {
      guestbook.seed(voice('a1', 'ready'), voice('a2', 'ready', { createdAt: atPlus(1) }))
    })

    it('writes one audit line with the number, never a name or a word, and carries the client', async () => {
      await run()

      expect(audit.all()).toEqual([
        {
          seq: 1,
          at: atPlus(9_000),
          actor: { kind: 'member', userId: MODERATOR, label: null },
          action: 'event.voicesKept',
          subject: { type: 'event', id: 'event-1' },
          clientId: CLIENT,
          details: { kept: 2 },
        },
      ])
    })

    it('retires the archive before the first voice is published: a published voice enters it', async () => {
      await run()

      expect(log[0]).toBe('archive retired: guestbookChanged')
      expect(log.filter((line) => line.startsWith('saved '))).toHaveLength(2)
    })

    it('tells the console once, with the signal only the console hears', async () => {
      await run()

      expect(bus.published).toEqual([{ type: 'guestbook.voice', eventId: EVENT }])
    })
  })

  it('refuses the act, and decides nothing, when the audit log would refuse its line', async () => {
    const odd = asEventId('event 1')
    events.seed(anEvent({ id: 'event 1', slug: 'autre-soiree', joinCode: 'ZZ9ZZ9' }))
    memberships.seed({ eventId: odd, userId: MODERATOR, role: 'moderator', grantedAt: AT })
    guestbook.seed(aVoiceEntry({ id: 'odd-1', state: 'ready', eventId: 'event 1' }))

    const result = await keep({ eventId: odd, actor: host(MODERATOR) })

    expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
    expect((await guestbook.findById(odd, idOf('odd-1')))?.status).toBe('pending')
    expect(log).toEqual([])
  })

  describe('who may', () => {
    beforeEach(() => {
      guestbook.seed(voice('a1', 'ready'))
    })

    it('refuses a guest outright', async () => {
      const result = await run({ kind: 'guest', guestId: asGuestId('guest-1') })

      expect(!result.ok && result.error.code).toBe('auth.forbidden')
      expect(await statusOf('a1')).toBe('pending')
    })

    it('answers a stranger as for an event that does not exist', async () => {
      const result = await run(host(STRANGER))

      expect(!result.ok && result.error.code).toBe('event.notFound')
      expect(await statusOf('a1')).toBe('pending')
    })

    it('answers event.notFound for an event nobody holds', async () => {
      const result = await keep({ eventId: asEventId('nowhere'), actor: host(MODERATOR) })

      expect(!result.ok && result.error.code).toBe('event.notFound')
    })

    it('is refused 403 client.suspended to a frozen client’s members, and nothing is decided', async () => {
      clients.seed(aClient({ id: 'client-1', suspendedAt: AT }))

      const result = await run()

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'forbidden',
        'client.suspended',
      ])
      expect(await statusOf('a1')).toBe('pending')
      expect(log).toEqual([])
    })

    it('is refused on an event that does not take decisions any more, as a single decision is', async () => {
      events.seed(anEvent({ id: 'event-1', status: 'archived', clientId: CLIENT }))

      const result = await run()

      expect(!result.ok && result.error.code).toBe('event.notModeratable')
      expect(await statusOf('a1')).toBe('pending')
    })
  })
})
