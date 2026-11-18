import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import { isVoiceOpen } from '../../../domain/events/eventGuestbookVoiceSettings'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asClientId, asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, anEvent, atPlus } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import type { InvalidateExport } from '../exports/invalidateAlbumExport'
import { makeOpenGuestbookVoice, type OpenGuestbookVoice } from './openGuestbookVoice'

/**
 * "Ouvrir maintenant" (spec 25, rule 10): the owner's alone, one fact written (`opensAt = now`),
 * idempotent, audited without content, and the archive retired before the settings change.
 */

const EVENT = asEventId('event-1')
const OWNER = asUserId('user-owner')
const MODERATOR = asUserId('user-moderator')
const STRANGER = asUserId('user-stranger')
const CLIENT = asClientId('client-1')

const host = (userId: typeof OWNER): PhotoActor => ({ kind: 'host', userId })

describe('openGuestbookVoice', () => {
  let clients: FakeClientRepository
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let audit: FakeAuditLog
  let bus: RecordingEventBus
  let clock: FakeClock
  /** What happened, in order, across the archive, the audit log and the event's own row. */
  let log: string[]
  let retired: string[]
  let open: OpenGuestbookVoice

  const sealed = (over: { opensAtMs?: number | null; status?: 'live' | 'closed' } = {}) =>
    anEvent({
      id: 'event-1',
      clientId: CLIENT,
      ...(over.status === undefined ? {} : { status: over.status }),
      settings: {
        allowGuestbook: true,
        guestbookVoice: { enabled: true, sealed: true, opensAtMs: over.opensAtMs ?? null },
      },
    })

  const stored = async () => {
    const event = await events.findById(EVENT)
    if (event === null) throw new Error('the event is gone')
    return event
  }

  const run = (actor: PhotoActor = host(OWNER)) => open({ eventId: EVENT, actor })

  beforeEach(() => {
    // Linked, as in production: an event names a client that has to exist.
    clients = new FakeClientRepository().seed(aClient({ id: 'client-1' }))
    events = new FakeEventRepository({ clients })
    memberships = new FakeMembershipRepository()
    audit = new FakeAuditLog().withAccounts(OWNER, MODERATOR)
    bus = new RecordingEventBus()
    clock = new FakeClock(atPlus(5_000))
    log = []
    retired = []

    const save = events.save.bind(events)
    events.save = async (event) => {
      log.push('settings saved')
      return save(event)
    }
    const record = audit.record.bind(audit)
    audit.record = async (entry) => {
      log.push('audited')
      return record(entry)
    }
    const invalidateExport: InvalidateExport = async (_eventId, reason) => {
      log.push('archive retired')
      retired.push(reason)
    }

    open = makeOpenGuestbookVoice({ events, memberships, audit, bus, clock, invalidateExport })
    memberships.seed(
      { eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT },
    )
    events.seed(sealed())
  })

  it('writes opensAt = the server’s now, and the secret is lifted from that very instant', async () => {
    const result = await run()

    expect(result.ok).toBe(true)
    const event = await stored()
    expect(event.settings.guestbookVoice.opensAtMs).toBe(atPlus(5_000).getTime())
    expect(
      isVoiceOpen(event.settings.guestbookVoice, event, atPlus(5_000), event.settings.reveal),
    ).toBe(true)
    expect(
      isVoiceOpen(event.settings.guestbookVoice, event, atPlus(4_999), event.settings.reveal),
    ).toBe(false)
  })

  it('keeps the host’s other choices: it writes the one field and nothing else', async () => {
    await run()

    expect((await stored()).settings.guestbookVoice).toMatchObject({ enabled: true, sealed: true })
    expect((await stored()).settings.allowGuestbook).toBe(true)
  })

  it('brings a time still in the future forward to now, which is the one move the setting allows', async () => {
    events.seed(sealed({ opensAtMs: atPlus(3_600_000).getTime() }))

    await run()

    expect((await stored()).settings.guestbookVoice.opensAtMs).toBe(atPlus(5_000).getTime())
  })

  describe('who may', () => {
    it('refuses a moderator with 403 auth.forbidden: a DJ the couple lent a laptop to must not spoil the surprise', async () => {
      const result = await run(host(MODERATOR))

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'forbidden',
        'auth.forbidden',
      ])
      expect((await stored()).settings.guestbookVoice.opensAtMs).toBeNull()
      expect(audit.all()).toEqual([])
      expect(bus.published).toEqual([])
    })

    it('refuses a guest outright', async () => {
      const result = await run({ kind: 'guest', guestId: asGuestId('guest-1') })

      expect(!result.ok && result.error.code).toBe('auth.forbidden')
    })

    it('answers a stranger as for an event that does not exist', async () => {
      const result = await run(host(STRANGER))

      expect(!result.ok && result.error.code).toBe('event.notFound')
    })

    it('answers event.notFound for an event nobody holds', async () => {
      const result = await open({ eventId: asEventId('nowhere'), actor: host(OWNER) })

      expect(!result.ok && result.error.code).toBe('event.notFound')
    })
  })

  describe('idempotent: opening what is open is no act', () => {
    it('answers ok and writes nothing the second time, whoever taps', async () => {
      await run()
      const first = await stored()
      log.length = 0

      clock.advance(60_000)
      const again = await run()

      expect(again.ok).toBe(true)
      expect((await stored()).settings.guestbookVoice.opensAtMs).toBe(
        first.settings.guestbookVoice.opensAtMs,
      )
      expect(log).toEqual([])
      expect(audit.all()).toHaveLength(1)
      expect(bus.published).toHaveLength(1)
    })

    it('does nothing for a book that was never sealed', async () => {
      events.seed(
        anEvent({
          id: 'event-1',
          settings: { allowGuestbook: true, guestbookVoice: { enabled: true } },
        }),
      )

      const result = await run()

      expect(result.ok).toBe(true)
      expect(log).toEqual([])
      expect(audit.all()).toEqual([])
    })

    it('does nothing for an event that is closed, whose secret lifted by itself', async () => {
      events.seed(sealed({ status: 'closed' }))

      const result = await run()

      expect(result.ok).toBe(true)
      expect(log).toEqual([])
      expect((await stored()).settings.guestbookVoice.opensAtMs).toBeNull()
    })

    it('does nothing when the time the host chose has already come', async () => {
      events.seed(sealed({ opensAtMs: AT.getTime() }))

      const result = await run()

      expect(result.ok).toBe(true)
      expect(log).toEqual([])
      expect((await stored()).settings.guestbookVoice.opensAtMs).toBe(AT.getTime())
    })
  })

  describe('what it leaves behind', () => {
    it('writes one audit line: who, which event, that it happened, and no content', async () => {
      await run()

      expect(audit.all()).toEqual([
        {
          seq: 1,
          at: atPlus(5_000),
          actor: { kind: 'member', userId: OWNER, label: null },
          action: 'event.voiceOpened',
          subject: { type: 'event', id: 'event-1' },
          clientId: CLIENT,
          details: {},
        },
      ])
    })

    it('retires the verified archive: one written while the secret was on does not hold the recordings', async () => {
      await run()

      expect(retired).toEqual(['guestbookChanged'])
    })

    it('does it before the settings change, so an archive never outlives the secret it was written under', async () => {
      await run()

      expect(log).toEqual(['audited', 'archive retired', 'settings saved'])
    })

    it('tells the console, and only the console: guestbook.voice is a moderation-only signal', async () => {
      await run()

      expect(bus.published).toEqual([{ type: 'guestbook.voice', eventId: EVENT }])
    })
  })

  it('is refused 403 client.suspended to the owner of a suspended client, before anything is written', async () => {
    clients.seed(aClient({ id: 'client-1', suspendedAt: AT }))

    const result = await run()

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'forbidden',
      'client.suspended',
    ])
    expect(log).toEqual([])
  })

  it('refuses the act, and writes nothing, when the audit log would refuse its line', async () => {
    // An id the log refuses (it holds ids of letters, digits, _ and -): the line is built before
    // anything moves, so the opening does not happen without a record of it.
    const odd = asEventId('event 1')
    events.seed(
      anEvent({
        id: 'event 1',
        slug: 'autre-soiree',
        joinCode: 'ZZ9ZZ9',
        settings: { allowGuestbook: true, guestbookVoice: { enabled: true, sealed: true } },
      }),
    )
    memberships.seed({ eventId: odd, userId: OWNER, role: 'owner', grantedAt: AT })

    const result = await open({ eventId: odd, actor: host(OWNER) })

    expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
    expect(log).toEqual([])
    expect(bus.published).toEqual([])
  })

  it('refuses an event archived in the instant between its two readings, which no opening can change', async () => {
    const find = events.findById.bind(events)
    let reads = 0
    events.findById = async (id) => {
      reads += 1
      const event = await find(id)
      return reads === 1 || event === null
        ? event
        : Event.restore({ ...event.toProps(), status: 'archived' })
    }

    const result = await run()

    expect(!result.ok && result.error.code).toBe('event.immutable')
    expect((await stored()).settings.guestbookVoice.opensAtMs).toBeNull()
    expect(bus.published).toEqual([])
  })

  it('refuses nothing it cannot explain: an event that vanishes during the awaits is event.notFound', async () => {
    const find = events.findById.bind(events)
    let reads = 0
    events.findById = async (id) => {
      reads += 1
      return reads === 1 ? find(id) : null
    }

    const result = await run()

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
