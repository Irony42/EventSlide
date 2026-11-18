import { beforeEach, describe, expect, it } from 'vitest'
import { AUDIT_REASON_MAX_LENGTH } from '../../../domain/audit/auditReason'
import { asEventId, asGuestbookEntryId, asUserId } from '../../../domain/shared/ids'
import type { AuditRecorder } from '../../ports/auditLog'
import { aGuestbookEntry, aVoiceEntry, atPlus } from '../../testing/builders'
import { FakeGuestbookVoiceRepository } from '../../testing/fakeGuestbookVoiceRepository'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClock } from '../../testing/fakeClock'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeGetSiteGuestbookState } from './getSiteGuestbookState'
import { makeSetGuestbookTakedown, type SetGuestbookTakedown } from './setGuestbookTakedown'

/**
 * The operator's take-down of one guestbook message (spec 01, PR 6), the photograph's shape:
 * by id alone, a bounded reason, one audit line **before** the lever moves, idempotent, and a
 * neutral signal. The operator is never handed the text.
 */

const EVENT = asEventId('event-1')
const ENTRY = asGuestbookEntryId('entry-1')
const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const NOW = atPlus(86_400_000)
const REASON = 'Signalement reçu, retrait conservatoire'

describe('setGuestbookTakedown', () => {
  let guestbook: FakeGuestbookRepository
  let audit: FakeAuditLog
  let bus: RecordingEventBus
  let takeDown: SetGuestbookTakedown

  beforeEach(() => {
    guestbook = new FakeGuestbookRepository().seed(
      aGuestbookEntry({ id: 'entry-1', eventId: 'event-1', moderation: 'auto' }),
    )
    audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    bus = new RecordingEventBus()
    takeDown = makeSetGuestbookTakedown({ guestbook, audit, bus, clock: new FakeClock(NOW) })
  })

  const downAt = async () => (await guestbook.locate(ENTRY))?.takenDownAt ?? null

  it('takes the message down at the injected instant, writes one line naming no client, and tells the screens', async () => {
    const result = await takeDown({ entryId: ENTRY, down: true, reason: REASON, actor: OPERATOR })

    expect(result.ok).toBe(true)
    expect(await downAt()).toEqual(NOW)
    expect(await guestbook.findById(EVENT, ENTRY)).toBeNull()
    expect(audit.all()).toEqual([
      {
        seq: 1,
        at: NOW,
        actor: { kind: 'operator', userId: OPERATOR.userId, label: null },
        action: 'guestbook.takenDown',
        subject: { type: 'guestbook', id: 'entry-1' },
        clientId: null,
        details: { reason: REASON },
      },
    ])
    expect(bus.published).toEqual([{ type: 'guestbook.changed', eventId: EVENT }])
  })

  it('puts it back, with its own line and its own signal', async () => {
    await takeDown({ entryId: ENTRY, down: true, reason: REASON, actor: OPERATOR })

    await takeDown({ entryId: ENTRY, down: false, reason: REASON, actor: OPERATOR })

    expect(await downAt()).toBeNull()
    expect((await guestbook.findById(EVENT, ENTRY))?.id).toBe(ENTRY)
    expect(audit.all().map((row) => row.action)).toEqual([
      'guestbook.takenDown',
      'guestbook.restored',
    ])
    expect(bus.published).toHaveLength(2)
  })

  it('is idempotent in both directions: nothing new is written, announced or re-stamped', async () => {
    await takeDown({ entryId: ENTRY, down: false, reason: REASON, actor: OPERATOR })
    await takeDown({ entryId: ENTRY, down: true, reason: REASON, actor: OPERATOR })
    await makeSetGuestbookTakedown({
      guestbook,
      audit,
      bus,
      clock: new FakeClock(atPlus(NOW.getTime() * 2)),
    })({ entryId: ENTRY, down: true, reason: REASON, actor: OPERATOR })

    expect(await downAt()).toEqual(NOW)
    expect(audit.all()).toHaveLength(1)
    expect(bus.published).toHaveLength(1)
  })

  it('answers 404 guestbook.notFound for an id no message holds, and writes nothing', async () => {
    const result = await takeDown({
      entryId: asGuestbookEntryId('ghost'),
      down: true,
      reason: REASON,
      actor: OPERATOR,
    })

    expect(!result.ok && result.error.code).toBe('guestbook.notFound')
    expect(audit.all()).toEqual([])
  })

  it.each([
    ['a blank one', '   '],
    ['one with a line break', 'a\nb'],
    ['an address', 'see ops@example.test'],
    ['one past the bound', 'x'.repeat(AUDIT_REASON_MAX_LENGTH + 1)],
  ])('refuses %s with audit.reasonInvalid, before looking anything up', async (_what, reason) => {
    const result = await takeDown({ entryId: ENTRY, down: true, reason, actor: OPERATOR })

    expect(!result.ok && result.error.code).toBe('audit.reasonInvalid')
    expect(await downAt()).toBeNull()
  })

  it('refuses an actor with no name behind it, and takes nothing down', async () => {
    const result = await takeDown({
      entryId: ENTRY,
      down: true,
      reason: REASON,
      actor: { kind: 'operator' },
    })

    expect(!result.ok && result.error.code).toBe('audit.actorUserRequired')
    expect(await downAt()).toBeNull()
    expect(bus.published).toEqual([])
  })

  it('records before it moves: a failure to write the line leaves the message up', async () => {
    const broken: AuditRecorder = {
      record: async () => {
        throw new Error('disk full')
      },
    }
    const failing = makeSetGuestbookTakedown({
      guestbook,
      audit: broken,
      bus,
      clock: new FakeClock(NOW),
    })

    await expect(
      failing({ entryId: ENTRY, down: true, reason: REASON, actor: OPERATOR }),
    ).rejects.toThrow('disk full')

    expect(await downAt()).toBeNull()
  })

  it('keeps counting the message for its guest, so taking it down frees no place', async () => {
    await takeDown({ entryId: ENTRY, down: true, reason: REASON, actor: OPERATOR })

    expect(await guestbook.countByGuest(EVENT, aGuestbookEntry().guestId)).toBe(1)
  })
})

describe('the operator taking a voice message down (spec 25)', () => {
  const VOICE = asGuestbookEntryId('voice-1')

  const scene = () => {
    const guestbook = new FakeGuestbookRepository().seed(
      aVoiceEntry({ id: 'voice-1', eventId: 'event-1', state: 'ready', moderation: 'auto' }),
    )
    const voices = new FakeGuestbookVoiceRepository(guestbook)
    const bus = new RecordingEventBus()
    const audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    const takeDown = makeSetGuestbookTakedown({ guestbook, audit, bus, clock: new FakeClock(NOW) })
    return { guestbook, voices, bus, takeDown }
  }

  it('is told to the console on the voice signal, which the wall never hears, and not on the wall’s', async () => {
    const { bus, takeDown } = scene()

    await takeDown({ entryId: VOICE, down: true, reason: REASON, actor: OPERATOR })

    expect(bus.published).toEqual([{ type: 'guestbook.voice', eventId: EVENT }])
  })

  it('leaves the row, and takes the recording out of every read and of the count of what is open', async () => {
    const { guestbook, voices, takeDown } = scene()
    expect(await voices.countOpenByEvent(EVENT)).toBe(1)

    await takeDown({ entryId: VOICE, down: true, reason: REASON, actor: OPERATOR })

    expect((await guestbook.locate(VOICE))?.takenDownAt).toEqual(NOW)
    expect(await voices.findByEntry(EVENT, VOICE)).toBeNull()
    expect(await guestbook.findById(EVENT, VOICE)).toBeNull()
    expect(await guestbook.listByStatuses(EVENT, ['published'], 10)).toEqual([])
    expect(await voices.countOpenByEvent(EVENT)).toBe(0)
  })

  it('keeps counting it for its guest, as it does a written message', async () => {
    const { guestbook, takeDown } = scene()

    await takeDown({ entryId: VOICE, down: true, reason: REASON, actor: OPERATOR })

    expect(await guestbook.countByGuest(EVENT, aVoiceEntry().guestId)).toBe(1)
  })

  it('puts it back on the same signal', async () => {
    const { bus, voices, takeDown } = scene()
    await takeDown({ entryId: VOICE, down: true, reason: REASON, actor: OPERATOR })

    await takeDown({ entryId: VOICE, down: false, reason: REASON, actor: OPERATOR })

    expect(bus.published.map((event) => event.type)).toEqual(['guestbook.voice', 'guestbook.voice'])
    expect((await voices.findByEntry(EVENT, VOICE))?.id).toBe(VOICE)
  })
})

describe('getSiteGuestbookState', () => {
  it('answers ids and an instant, never the text, and 404s an unknown id', async () => {
    const guestbook = new FakeGuestbookRepository().seed(
      aGuestbookEntry({ id: 'entry-1', eventId: 'event-1', text: 'secret words' }),
    )
    const state = makeGetSiteGuestbookState({ guestbook })

    const found = await state({ entryId: ENTRY })
    const missing = await state({ entryId: asGuestbookEntryId('ghost') })

    expect(found).toEqual({ ok: true, value: { id: ENTRY, eventId: EVENT, takenDownAt: null } })
    expect(JSON.stringify(found)).not.toContain('secret')
    expect(!missing.ok && missing.error.code).toBe('guestbook.notFound')
  })
})
