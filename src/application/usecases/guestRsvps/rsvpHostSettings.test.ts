import { beforeEach, describe, expect, it } from 'vitest'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId } from '../../../domain/shared/ids'
import {
  ARCHIVED,
  CLOSED,
  DRAFT,
  FROZEN,
  GALA,
  MODERATOR,
  OWNER,
  STRANGER,
  WEDDING,
  rsvpScene,
  type RsvpScene,
} from '../../testing/rsvpScene'

/**
 * The host's side of the replies settings (spec 30): what they ask, until when, the closing by
 * hand, and the door every one of these goes through (the owner's, as the invitation's).
 */

describe('replies settings (spec 30)', () => {
  let scene: RsvpScene

  beforeEach(async () => {
    scene = await rsvpScene()
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
  })

  const lines = async () => (await scene.audit.list({ limit: 20 })).items.map((line) => line.action)
  /** The audit lines since the invitation was saved by the scene itself. */
  const actsAfterSetup = async () =>
    (await lines()).filter((action) => !action.startsWith('event.guestInvite'))
  const signals = () => scene.bus.published.filter((event) => event.type === 'rsvp.changed')

  describe('getRsvpForm', () => {
    it('answers the defaults, switched off, for an invitation that saved no setting', async () => {
      const view = await scene.getForm({ eventId: WEDDING, actorId: OWNER })

      expect(view.ok && view.value.settings).toMatchObject({
        enabled: false,
        deadline: null,
        closedAt: null,
      })
      expect(view.ok && view.value.state).toBe('off')
      expect(view.ok && view.value.invite).not.toBeNull()
    })

    it('answers the defaults and no state while the event has no invitation, creating nothing', async () => {
      const bare = await rsvpScene({ invited: false })

      const view = await bare.getForm({ eventId: WEDDING, actorId: OWNER })

      expect(view.ok && view.value.invite).toBeNull()
      expect(view.ok && view.value.state).toBeNull()
      expect(view.ok && view.value.closesAt).toBeNull()
      expect(await bare.invites.findByEvent(WEDDING)).toBeNull()
    })

    it('says when replies stop on their own, and the state of the window', async () => {
      await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        enabled: true,
        deadline: '2026-12-05',
      })

      const view = await scene.getForm({ eventId: WEDDING, actorId: OWNER })

      expect(view.ok && view.value.state).toBe('open')
      expect(view.ok && view.value.closesAt?.toISOString()).toBe('2026-12-05T23:00:00.000Z')
    })

    it('says when the replies will be erased once there is one, and not before', async () => {
      const before = await scene.getForm({ eventId: WEDDING, actorId: OWNER })
      await scene.hostAdd({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Léa',
        answer: 'yes',
        adults: 1,
      })
      const after = await scene.getForm({ eventId: WEDDING, actorId: OWNER })

      expect(before.ok && before.value.erasedAt).toBeNull()
      // 60 days after the start of the invitation (13 December), the event never having closed.
      expect(after.ok && after.value.erasedAt?.toISOString()).toBe('2027-02-11T18:00:00.000Z')
    })

    it('names no date of erasure while no clock runs: an undated invitation, an event never closed', async () => {
      const undated = await rsvpScene({ invited: false })
      await undated.save({ eventId: WEDDING, actorId: OWNER, title: 'Fête' })
      undated.rsvps.seed(aRsvp({ eventId: WEDDING }))

      const view = await undated.getForm({ eventId: WEDDING, actorId: OWNER })

      expect(view.ok && view.value.erasedAt).toBeNull()
      expect(view.ok && view.value.closesAt).toBeNull()
    })

    it('reads on a closed event, and refuses a suspended client as the invitation does', async () => {
      const frozen = await scene.getForm({ eventId: FROZEN, actorId: OWNER })

      expect((await scene.getForm({ eventId: CLOSED, actorId: OWNER })).ok).toBe(true)
      expect(!frozen.ok && frozen.error.code).toBe('client.suspended')
    })
  })

  describe('saveRsvpForm', () => {
    it('saves the switch, the deadline and the form, and answers what a read would', async () => {
      const saved = await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        enabled: true,
        deadline: '2026-12-05',
        form: { maybe: false, partySize: { max: 6 } },
      })

      const read = await scene.invites.findRsvpSettings(WEDDING)
      expect(read).toMatchObject({ enabled: true, deadline: '2026-12-05' })
      expect(read?.form).toMatchObject({ maybe: false, partySize: { enabled: true, max: 6 } })
      expect(saved.ok && saved.value.settings).toEqual(read)
      expect(await actsAfterSetup()).toEqual(['event.rsvpFormSaved'])
    })

    it('leaves what it is not given as it was, and null clears the deadline', async () => {
      await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        enabled: true,
        deadline: '2026-12-05',
      })

      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { diet: false } })
      expect(await scene.invites.findRsvpSettings(WEDDING)).toMatchObject({
        enabled: true,
        deadline: '2026-12-05',
      })

      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, deadline: null })
      expect((await scene.invites.findRsvpSettings(WEDDING))?.deadline).toBeNull()
    })

    it('judges every field with the domain and writes, audits and announces nothing on a refusal', async () => {
      const late = await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        deadline: '2027-01-01',
      })
      const bad = await scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { maybe: 'oui' } })

      expect(!late.ok && late.error.code).toBe('rsvp.deadlineAfterStart')
      expect(!bad.ok && bad.error.code).toBe('rsvp.formInvalid')
      expect(await scene.invites.findRsvpSettings(WEDDING)).toMatchObject({ enabled: false })
      expect(await actsAfterSetup()).toEqual([])
      expect(signals()).toHaveLength(0)
    })

    it('writes, audits and announces nothing for a save that changes nothing', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
      const before = signals().length

      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER })

      expect(await actsAfterSetup()).toEqual(['event.rsvpFormSaved'])
      expect(signals()).toHaveLength(before)
    })

    it('announces a change without any content', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })

      expect(signals()).toEqual([{ type: 'rsvp.changed', eventId: WEDDING }])
    })

    it('does not lift the closing by hand, nor touch the invitation text or token', async () => {
      await scene.close({ eventId: WEDDING, actorId: OWNER })
      const invite = await scene.invites.findByEvent(WEDDING)

      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })

      expect((await scene.invites.findRsvpSettings(WEDDING))?.closedAt).not.toBeNull()
      expect(await scene.invites.findByEvent(WEDDING)).toEqual(invite)
    })

    it('needs the invitation: an event with none is told so, and nothing is created', async () => {
      const bare = await rsvpScene({ invited: false })

      const saved = await bare.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })

      expect(!saved.ok && saved.error.code).toBe('rsvp.inviteRequired')
      expect(await bare.invites.findByEvent(WEDDING)).toBeNull()
    })
  })

  describe('closeRsvps and reopenRsvps', () => {
    it('closes by hand at the instant of the click, audits it and announces it', async () => {
      const closed = await scene.close({ eventId: WEDDING, actorId: OWNER })

      expect(closed.ok && closed.value.settings.closedAt).toEqual(scene.clock.now())
      expect(closed.ok && closed.value.state).toBe('off')
      expect(await actsAfterSetup()).toEqual(['event.rsvpsClosed'])
      expect(signals()).toHaveLength(1)
    })

    it('says the replies are closed when they are asked and the host closed them', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })

      const closed = await scene.close({ eventId: WEDDING, actorId: OWNER })

      expect(closed.ok && closed.value.state).toBe('closed')
    })

    it('keeps the first closing when closed twice, and writes nothing the second time', async () => {
      const first = await scene.close({ eventId: WEDDING, actorId: OWNER })
      scene.clock.advance(60_000)

      const second = await scene.close({ eventId: WEDDING, actorId: OWNER })

      expect(second.ok && second.value.settings.closedAt).toEqual(
        first.ok ? first.value.settings.closedAt : null,
      )
      expect(await actsAfterSetup()).toEqual(['event.rsvpsClosed'])
      expect(signals()).toHaveLength(1)
    })

    it('reopens, and reopening what is open is no act', async () => {
      await scene.reopen({ eventId: WEDDING, actorId: OWNER })
      expect(await actsAfterSetup()).toEqual([])

      await scene.close({ eventId: WEDDING, actorId: OWNER })
      const reopened = await scene.reopen({ eventId: WEDDING, actorId: OWNER })

      expect(reopened.ok && reopened.value.settings.closedAt).toBeNull()
      expect((await actsAfterSetup()).reverse()).toEqual([
        'event.rsvpsClosed',
        'event.rsvpsReopened',
      ])
    })

    it('needs the invitation', async () => {
      const bare = await rsvpScene({ invited: false })

      const closed = await bare.close({ eventId: WEDDING, actorId: OWNER })
      const reopened = await bare.reopen({ eventId: WEDDING, actorId: OWNER })

      expect(!closed.ok && closed.error.code).toBe('rsvp.inviteRequired')
      expect(!reopened.ok && reopened.error.code).toBe('rsvp.inviteRequired')
    })
  })

  describe('who may', () => {
    const asks = (): Record<
      string,
      (eventId: typeof WEDDING, actorId: typeof OWNER) => Promise<{ ok: boolean }>
    > => ({
      getForm: (eventId, actorId) => scene.getForm({ eventId, actorId }),
      saveForm: (eventId, actorId) => scene.saveForm({ eventId, actorId, enabled: true }),
      close: (eventId, actorId) => scene.close({ eventId, actorId }),
      reopen: (eventId, actorId) => scene.reopen({ eventId, actorId }),
      list: (eventId, actorId) => scene.list({ eventId, actorId }),
      hostAdd: (eventId, actorId) =>
        scene.hostAdd({ eventId, actorId, name: 'Léa', answer: 'yes', adults: 1 }),
      hostUpdate: (eventId, actorId) =>
        scene.hostUpdate({
          eventId,
          actorId,
          rsvpId: scene.ids.guestRsvpId(),
          name: 'Léa',
          answer: 'yes',
          adults: 1,
        }),
      hostDelete: (eventId, actorId) =>
        scene.hostDelete({ eventId, actorId, rsvpId: scene.ids.guestRsvpId() }),
      exportCsv: (eventId, actorId) => scene.exportCsv({ eventId, actorId, view: 'all' }),
      markSeen: (eventId, actorId) => scene.markSeen({ eventId, actorId }),
    })

    const code = (outcome: unknown): string | undefined => {
      const result = outcome as { ok: boolean; error?: { code: string } }
      return result.ok ? undefined : result.error?.code
    }

    it('tells a stranger the event does not exist, whatever they ask', async () => {
      for (const [name, ask] of Object.entries(asks())) {
        expect([name, code(await ask(WEDDING, STRANGER))]).toEqual([name, 'event.notFound'])
      }
    })

    it('tells a moderator it is the owner’s, whatever they ask', async () => {
      for (const [name, ask] of Object.entries(asks())) {
        expect([name, code(await ask(WEDDING, MODERATOR))]).toEqual([name, 'auth.forbidden'])
      }
    })

    it('tells the owner of another event the event does not exist', async () => {
      for (const [name, ask] of Object.entries(asks())) {
        expect([name, code(await ask(GALA, OWNER))]).toEqual([name, 'event.notFound'])
      }
      expect(code(await scene.getForm({ eventId: asEventId('evt-nowhere'), actorId: OWNER }))).toBe(
        'event.notFound',
      )
    })

    it('refuses every write on an archived event, and every write of a suspended client', async () => {
      for (const name of ['saveForm', 'close', 'reopen', 'hostAdd', 'hostUpdate', 'hostDelete']) {
        const ask = asks()[name]
        expect([name, code(await ask?.(ARCHIVED, OWNER))]).toEqual([
          name,
          'guestInvite.eventArchived',
        ])
        expect([name, code(await ask?.(FROZEN, OWNER))]).toEqual([name, 'client.suspended'])
      }
    })

    it('still reads, lists, exports and marks seen on a closed event and on a draft', async () => {
      for (const name of ['getForm', 'list', 'exportCsv', 'markSeen']) {
        const ask = asks()[name]
        expect([name, code(await ask?.(FROZEN, OWNER))]).toEqual([name, 'client.suspended'])
        expect([name, code(await ask?.(CLOSED, OWNER))]).toEqual([name, undefined])
        expect([name, code(await ask?.(DRAFT, OWNER))]).toEqual([name, undefined])
      }
    })

    it('answers an event the operator took down as if it were not there', async () => {
      await scene.events.setTakenDown(WEDDING, scene.clock.now())

      for (const name of ['getForm', 'list', 'saveForm', 'hostAdd']) {
        expect([name, code(await asks()[name]?.(WEDDING, OWNER))]).toEqual([name, 'event.notFound'])
      }
    })
  })
})
