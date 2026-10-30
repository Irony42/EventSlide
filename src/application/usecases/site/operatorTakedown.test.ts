import { beforeEach, describe, expect, it } from 'vitest'
import { AUDIT_REASON_MAX_LENGTH } from '../../../domain/audit/auditReason'
import { asEventId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import type { AuditRecorder } from '../../ports/auditLog'
import { anEvent, aPhoto, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeSetEventPurgeHold, type SetEventPurgeHold } from './setEventPurgeHold'
import { makeSetEventTakedown, type SetEventTakedown } from './setEventTakedown'
import { makeSetPhotoTakedown, type SetPhotoTakedown } from './setPhotoTakedown'

/**
 * The operator's "remove without viewing" acts (launch review S5, G8-03): by id, with a mandatory
 * reason, idempotent, write-ahead, announced to the screens where one is hidden, and **never in
 * the client's own trail**. What each lever does at the surfaces is held where the surfaces are
 * (`takedown.container.test.ts`); what is held here is the act.
 */

const EVENT = asEventId('event-1')
const PHOTO = asPhotoId('photo-1')
const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const NOW = atPlus(86_400_000)
const REASON = 'Signalement reçu, retrait conservatoire'

describe('the operator takedown acts', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let audit: FakeAuditLog
  let bus: RecordingEventBus
  let takeDownPhoto: SetPhotoTakedown
  let takeDownEvent: SetEventTakedown
  let holdPurge: SetEventPurgeHold

  beforeEach(() => {
    events = new FakeEventRepository().seed(anEvent({ id: 'event-1', clientId: null }))
    photos = new FakePhotoRepository().seed(aPhoto({ id: 'photo-1', eventId: 'event-1' }))
    audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    bus = new RecordingEventBus()
    const clock = new FakeClock(NOW)
    takeDownPhoto = makeSetPhotoTakedown({ photos, audit, bus, clock })
    takeDownEvent = makeSetEventTakedown({ events, audit, bus, clock })
    holdPurge = makeSetEventPurgeHold({ events, audit, clock })
  })

  const photoDown = async () => (await photos.locate(PHOTO))?.takenDownAt ?? null
  const eventState = async () => {
    const event = await events.findById(EVENT)
    return { down: event?.takenDownAt ?? null, held: event?.purgeHeldAt ?? null }
  }

  describe('setPhotoTakedown', () => {
    it('takes the photograph down at the injected instant, writes one line that names no client, and tells the screens', async () => {
      const result = await takeDownPhoto({
        photoId: PHOTO,
        down: true,
        reason: REASON,
        actor: OPERATOR,
      })

      expect(result.ok).toBe(true)
      expect(await photoDown()).toEqual(NOW)
      expect(await photos.findById(EVENT, PHOTO)).toBeNull()
      expect(audit.all()).toEqual([
        {
          seq: 1,
          at: NOW,
          actor: { kind: 'operator', userId: OPERATOR.userId, label: null },
          action: 'photo.takenDown',
          subject: { type: 'photo', id: 'photo-1' },
          clientId: null,
          details: { reason: REASON },
        },
      ])
      expect(bus.published).toEqual([{ type: 'photo.takenDown', eventId: EVENT, photoId: PHOTO }])
    })

    it('puts it back, with its own line and its own signal', async () => {
      await takeDownPhoto({ photoId: PHOTO, down: true, reason: REASON, actor: OPERATOR })

      const result = await takeDownPhoto({
        photoId: PHOTO,
        down: false,
        reason: REASON,
        actor: OPERATOR,
      })

      expect(result.ok).toBe(true)
      expect(await photoDown()).toBeNull()
      expect((await photos.findById(EVENT, PHOTO))?.id).toBe(PHOTO)
      expect(audit.all().map((row) => row.action)).toEqual(['photo.takenDown', 'photo.restored'])
      expect(bus.published.map((signal) => signal.type)).toEqual([
        'photo.takenDown',
        'photo.restored',
      ])
    })

    it('is idempotent in both directions: nothing new is written, announced or re-stamped', async () => {
      await takeDownPhoto({ photoId: PHOTO, down: false, reason: REASON, actor: OPERATOR })
      await takeDownPhoto({ photoId: PHOTO, down: true, reason: REASON, actor: OPERATOR })
      await makeSetPhotoTakedown({
        photos,
        audit,
        bus,
        clock: new FakeClock(atPlus(NOW.getTime() * 2)),
      })({
        photoId: PHOTO,
        down: true,
        reason: REASON,
        actor: OPERATOR,
      })

      expect(await photoDown()).toEqual(NOW)
      expect(audit.all()).toHaveLength(1)
      expect(bus.published).toHaveLength(1)
    })

    it('answers 404 photo.notFound for an id no photograph holds, and writes nothing', async () => {
      const result = await takeDownPhoto({
        photoId: asPhotoId('ghost'),
        down: true,
        reason: REASON,
        actor: OPERATOR,
      })

      expect(!result.ok && result.error.code).toBe('photo.notFound')
      expect(audit.all()).toEqual([])
    })

    it.each([
      ['a blank one', '   '],
      ['one with a line break', 'a\nb'],
      ['an address', 'see ops@example.test'],
      ['one past the bound', 'x'.repeat(AUDIT_REASON_MAX_LENGTH + 1)],
    ])('refuses %s with audit.reasonInvalid, before looking anything up', async (_what, reason) => {
      const result = await takeDownPhoto({
        photoId: asPhotoId('ghost'),
        down: true,
        reason,
        actor: OPERATOR,
      })

      expect(!result.ok && result.error.code).toBe('audit.reasonInvalid')
      expect(await photoDown()).toBeNull()
    })

    it('refuses an actor that makes no sense, and takes nothing down: no act without a name behind it', async () => {
      const result = await takeDownPhoto({
        photoId: PHOTO,
        down: true,
        reason: REASON,
        actor: { kind: 'operator' },
      })

      expect(!result.ok && result.error.code).toBe('audit.actorUserRequired')
      expect(await photoDown()).toBeNull()
      expect(bus.published).toEqual([])
    })

    it('records before it moves: a failure to write the line leaves the photograph up', async () => {
      const broken: AuditRecorder = {
        record: async () => {
          throw new Error('disk full')
        },
      }
      const failing = makeSetPhotoTakedown({
        photos,
        audit: broken,
        bus,
        clock: new FakeClock(NOW),
      })

      await expect(
        failing({ photoId: PHOTO, down: true, reason: REASON, actor: OPERATOR }),
      ).rejects.toThrow('disk full')

      expect(await photoDown()).toBeNull()
    })
  })

  describe('setEventTakedown', () => {
    it('takes the event down and back, one line and one signal each', async () => {
      await takeDownEvent({ eventId: EVENT, down: true, reason: REASON, actor: OPERATOR })
      expect((await eventState()).down).toEqual(NOW)

      await takeDownEvent({ eventId: EVENT, down: false, reason: REASON, actor: OPERATOR })

      expect((await eventState()).down).toBeNull()
      expect(
        audit.all().map((row) => [row.action, row.subject, row.clientId, row.details]),
      ).toEqual([
        ['event.takenDown', { type: 'event', id: 'event-1' }, null, { reason: REASON }],
        ['event.restored', { type: 'event', id: 'event-1' }, null, { reason: REASON }],
      ])
      expect(bus.published).toEqual([
        { type: 'event.takenDown', eventId: EVENT },
        { type: 'event.restored', eventId: EVENT },
      ])
    })

    it('is idempotent, and leaves the retention clock and the hold alone', async () => {
      await takeDownEvent({ eventId: EVENT, down: false, reason: REASON, actor: OPERATOR })
      await takeDownEvent({ eventId: EVENT, down: true, reason: REASON, actor: OPERATOR })
      await takeDownEvent({ eventId: EVENT, down: true, reason: REASON, actor: OPERATOR })

      expect(await eventState()).toEqual({ down: NOW, held: null })
      expect(audit.all()).toHaveLength(1)
    })

    it('answers 404 event.notFound for an unknown id, and 400 for a blank reason first', async () => {
      const unknown = await takeDownEvent({
        eventId: asEventId('ghost'),
        down: true,
        reason: REASON,
        actor: OPERATOR,
      })
      const blank = await takeDownEvent({
        eventId: EVENT,
        down: true,
        reason: ' ',
        actor: OPERATOR,
      })

      expect(!unknown.ok && unknown.error.code).toBe('event.notFound')
      expect(!blank.ok && blank.error.code).toBe('audit.reasonInvalid')
      expect(audit.all()).toEqual([])
    })

    it('refuses an actor that makes no sense, and takes nothing down', async () => {
      const result = await takeDownEvent({
        eventId: EVENT,
        down: true,
        reason: REASON,
        actor: { kind: 'operator' },
      })

      expect(!result.ok && result.error.code).toBe('audit.actorUserRequired')
      expect((await eventState()).down).toBeNull()
    })
  })

  describe('setEventPurgeHold', () => {
    it('holds and releases, one line each, and tells no screen', async () => {
      await holdPurge({ eventId: EVENT, held: true, reason: REASON, actor: OPERATOR })
      expect((await eventState()).held).toEqual(NOW)

      await holdPurge({ eventId: EVENT, held: false, reason: REASON, actor: OPERATOR })

      expect((await eventState()).held).toBeNull()
      expect(audit.all().map((row) => row.action)).toEqual([
        'event.purgeHeld',
        'event.purgeReleased',
      ])
      expect(audit.all().every((row) => row.clientId === null)).toBe(true)
      expect(bus.published).toEqual([])
    })

    it('is idempotent, and hides nothing', async () => {
      await holdPurge({ eventId: EVENT, held: false, reason: REASON, actor: OPERATOR })
      await holdPurge({ eventId: EVENT, held: true, reason: REASON, actor: OPERATOR })
      await holdPurge({ eventId: EVENT, held: true, reason: REASON, actor: OPERATOR })

      expect(await eventState()).toEqual({ down: null, held: NOW })
      expect(audit.all()).toHaveLength(1)
      expect((await events.findById(EVENT))?.servesWall()).toBe(true)
    })

    it('answers 404 for an unknown event and 400 for a bad reason, and refuses a nameless actor', async () => {
      const unknown = await holdPurge({
        eventId: asEventId('ghost'),
        held: true,
        reason: REASON,
        actor: OPERATOR,
      })
      const bad = await holdPurge({ eventId: EVENT, held: true, reason: '', actor: OPERATOR })
      const nameless = await holdPurge({
        eventId: EVENT,
        held: true,
        reason: REASON,
        actor: { kind: 'operator' },
      })

      expect(!unknown.ok && unknown.error.code).toBe('event.notFound')
      expect(!bad.ok && bad.error.code).toBe('audit.reasonInvalid')
      expect(!nameless.ok && nameless.error.code).toBe('audit.actorUserRequired')
      expect((await eventState()).held).toBeNull()
    })
  })
})
