import { beforeEach, describe, expect, it } from 'vitest'
import {
  asClientId,
  asEventId,
  asGuestbookEntryId,
  asPhotoId,
  asUserId,
} from '../../../domain/shared/ids'
import { aClient, aGuestbookEntry, anEvent, aPhoto, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeOffboardClient } from '../clients/offboardClient'
import { makeResumeClient } from '../clients/resumeClient'
import { makeSuspendClient } from '../clients/suspendClient'
import type { TakedownAct } from '../notices/notifyTakedown'
import { makeSetEventTakedown } from './setEventTakedown'
import { makeSetGuestbookTakedown } from './setGuestbookTakedown'
import { makeSetPhotoTakedown } from './setPhotoTakedown'

/**
 * The operator's acts that may tell the host (spec 32, A4), seen from the use case: **told after the act, once, with the reason for
 * the host, unless the operator left "Prévenir l'hôte" unticked; never for an act that changed nothing, never for a restore, and a
 * reason that is too long refuses the act before anything is read or written.**
 */

const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const NOW = atPlus(86_400_000)
const EVENT = asEventId('event-1')
const CLIENT = asClientId('client-1')
const AUDIT_REASON = 'Signalement reçu, retrait conservatoire'
const HOST_REASON = 'Contenu contraire aux conditions d’utilisation.'

describe('the operator acts that tell the host', () => {
  let told: TakedownAct[]
  let audit: FakeAuditLog
  let photos: FakePhotoRepository
  let guestbook: FakeGuestbookRepository
  let events: FakeEventRepository
  let clients: FakeClientRepository
  const notice = (act: TakedownAct): void => {
    told.push(act)
  }

  beforeEach(() => {
    told = []
    audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    clients = new FakeClientRepository().seed(aClient({ id: 'client-1' }))
    events = new FakeEventRepository({ memberships: new FakeMembershipRepository(), clients }).seed(
      anEvent({ id: 'event-1', clientId: 'client-1' }),
    )
    photos = new FakePhotoRepository().seed(aPhoto({ id: 'photo-1', eventId: 'event-1' }))
    guestbook = new FakeGuestbookRepository().seed(
      aGuestbookEntry({ id: 'entry-1', eventId: 'event-1', moderation: 'auto' }),
    )
  })

  const clock = () => new FakeClock(NOW)
  const bus = () => new RecordingEventBus()
  const photoAct = (patch: Record<string, unknown> = {}) =>
    makeSetPhotoTakedown({ photos, audit, bus: bus(), clock: clock(), notice })({
      photoId: asPhotoId('photo-1'),
      down: true,
      reason: AUDIT_REASON,
      actor: OPERATOR,
      ...patch,
    })
  const guestbookAct = (patch: Record<string, unknown> = {}) =>
    makeSetGuestbookTakedown({ guestbook, audit, bus: bus(), clock: clock(), notice })({
      entryId: asGuestbookEntryId('entry-1'),
      down: true,
      reason: AUDIT_REASON,
      actor: OPERATOR,
      ...patch,
    })
  const eventAct = (patch: Record<string, unknown> = {}) =>
    makeSetEventTakedown({ events, audit, bus: bus(), clock: clock(), notice })({
      eventId: EVENT,
      down: true,
      reason: AUDIT_REASON,
      actor: OPERATOR,
      ...patch,
    })
  const suspendAct = (patch: Record<string, unknown> = {}) =>
    makeSuspendClient({ clients, audit, clock: clock(), notice })({
      clientId: CLIENT,
      actor: OPERATOR,
      ...patch,
    })
  const resumeAct = (patch: Record<string, unknown> = {}) =>
    makeResumeClient({ clients, audit, clock: clock(), notice })({
      clientId: CLIENT,
      actor: OPERATOR,
      ...patch,
    })
  const offboardAct = (patch: Record<string, unknown> = {}) =>
    makeOffboardClient({ clients, events, audit, clock: clock(), notice })({
      clientId: CLIENT,
      actor: OPERATOR,
      graceDays: 30,
      ...patch,
    })

  const withHostReason = { hostReason: HOST_REASON }

  it('tells the host by default, once the act is done, with the host reason and not the audit reason', async () => {
    expect((await photoAct(withHostReason)).ok).toBe(true)
    expect((await guestbookAct(withHostReason)).ok).toBe(true)
    expect((await eventAct(withHostReason)).ok).toBe(true)
    expect((await suspendAct(withHostReason)).ok).toBe(true)
    expect((await resumeAct(withHostReason)).ok).toBe(true)
    expect((await offboardAct(withHostReason)).ok).toBe(true)

    expect(told).toEqual([
      { kind: 'photo', eventId: EVENT, reason: HOST_REASON, at: NOW },
      { kind: 'guestbook', eventId: EVENT, reason: HOST_REASON, at: NOW },
      { kind: 'event', eventId: EVENT, reason: HOST_REASON, at: NOW },
      { kind: 'clientSuspended', clientId: CLIENT, reason: HOST_REASON, at: NOW },
      { kind: 'clientResumed', clientId: CLIENT, reason: HOST_REASON, at: NOW },
      { kind: 'clientOffboarded', clientId: CLIENT, reason: HOST_REASON, at: NOW },
    ])
    expect(JSON.stringify(told)).not.toContain(AUDIT_REASON)
  })

  it('tells with no reason when the operator wrote none for the host', async () => {
    await photoAct()
    await suspendAct()

    expect(told.map((act) => act.reason)).toEqual([null, null])
  })

  it('tells nobody when the operator unticked "Prévenir l\'hôte", and keeps nothing of what was typed', async () => {
    const quiet = { notifyHost: false, hostReason: HOST_REASON }
    await photoAct(quiet)
    await guestbookAct(quiet)
    await eventAct(quiet)
    await suspendAct(quiet)
    await resumeAct(quiet)
    await offboardAct(quiet)

    expect(told).toEqual([])
  })

  it('tells nobody of a restore, nor of an act that changed nothing', async () => {
    await photoAct()
    await photoAct()
    await guestbookAct()
    await guestbookAct()
    await eventAct()
    await eventAct()
    await suspendAct()
    await suspendAct()
    await offboardAct()
    await offboardAct()
    expect(told.map((act) => act.kind)).toEqual([
      'photo',
      'guestbook',
      'event',
      'clientSuspended',
      'clientOffboarded',
    ])

    told = []
    await photoAct({ down: false })
    await guestbookAct({ down: false })
    await eventAct({ down: false })
    expect(told).toEqual([])
  })

  it('tells nothing for a second suspension or a second resumption of the same space', async () => {
    await suspendAct()
    told = []

    await suspendAct()
    expect(told).toEqual([])

    await resumeAct()
    told = []
    await resumeAct()
    expect(told).toEqual([])
  })

  it('refuses a reason for the host that is too long before anything is read or written, whether or not the host is to be told', async () => {
    const tooLong = { hostReason: 'a'.repeat(501) }
    for (const patch of [tooLong, { ...tooLong, notifyHost: false }]) {
      for (const act of [photoAct, guestbookAct, eventAct, suspendAct, resumeAct, offboardAct]) {
        const result = await act(patch)
        expect(!result.ok && result.error.code).toBe('takedown.hostReasonInvalid')
      }
    }

    expect(audit.all()).toEqual([])
    expect(told).toEqual([])
    expect((await photos.locate(asPhotoId('photo-1')))?.takenDownAt).toBeNull()
    expect((await clients.findById(CLIENT))?.isSuspended()).toBe(false)
  })

  it('keeps the act itself working when nobody listens', async () => {
    const result = await makeSetPhotoTakedown({ photos, audit, bus: bus(), clock: clock() })({
      photoId: asPhotoId('photo-1'),
      down: true,
      reason: AUDIT_REASON,
      actor: OPERATOR,
    })

    expect(result.ok).toBe(true)
  })
})
