import { beforeEach, describe, expect, it } from 'vitest'
import { aHousehold } from '../../../domain/guestRsvps/testing/householdFixtures'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId } from '../../../domain/shared/ids'
import { GALA, OWNER, WEDDING, rsvpScene, type RsvpScene } from '../../testing/rsvpScene'

/**
 * A household's personal link on the guests' side (spec 30, lot 3): the link opens the household's
 * **one** reply, to read, make, change and delete, with no reply token of its own. The page's own
 * door comes first, then the link, bound to the event; the household's places are the ceiling.
 */

const LINK = '7QX0M4TZ2KD9WB3H'
const OTHER_LINK = '8RY1N5V0A3MEXC4J'
const ANSWER = { name: 'Famille Martin', answer: 'yes', adults: 2, kids: 1 }

const code = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code

describe('a household’s own link, on the guest’s side (spec 30, lot 3)', () => {
  let scene: RsvpScene
  let token: string
  let setupSignals = 0

  beforeEach(async () => {
    scene = await rsvpScene()
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
    scene.households.seed(
      aHousehold({ id: 'h-1', eventId: WEDDING, token: LINK, name: 'Famille Martin', places: 4 }),
      aHousehold({ id: 'h-gala', eventId: GALA, token: OTHER_LINK, name: 'Les Gala', places: 2 }),
    )
    token = await scene.token()
    setupSignals = scene.bus.published.length
  })

  const signals = () =>
    scene.bus.published.slice(setupSignals).filter((event) => event.type === 'rsvp.changed')
  const submit = (overrides: Record<string, unknown> = {}) =>
    scene.submit({ token, householdToken: LINK, ...ANSWER, ...overrides })

  describe('viewHousehold', () => {
    it('shows the household its name and places, and no reply before it gives one', async () => {
      const viewed = await scene.viewHousehold({ token, householdToken: LINK })

      expect(viewed.ok && [viewed.value.household.name, viewed.value.household.places]).toEqual([
        'Famille Martin',
        4,
      ])
      expect(viewed.ok && viewed.value.rsvp).toBeNull()
    })

    it('shows the household’s reply once it gave one, and folds a dictated link', async () => {
      await submit({ message: 'À samedi' })

      const viewed = await scene.viewHousehold({ token, householdToken: '7qxo-m4tz 2kd9 wb3h' })

      expect(viewed.ok && viewed.value.rsvp?.message).toBe('À samedi')
    })

    it('reads whatever the window says: closed replies and a finished party are still the household’s to read', async () => {
      await scene.close({ eventId: WEDDING, actorId: OWNER })
      const before = signals().length

      const viewed = await scene.viewHousehold({ token, householdToken: LINK })

      expect(viewed.ok).toBe(true)
      expect(signals()).toHaveLength(before)
    })

    it('answers the page’s neutral 404 first, then rsvp.notFound for a link that opens nothing', async () => {
      const dead = await scene.viewHousehold({ token: 'not-a-token', householdToken: 'nope' })
      const unknown = await scene.viewHousehold({ token, householdToken: '00000000000000AA' })

      expect(code(dead)).toBe('guestInvite.notAvailable')
      expect(code(unknown)).toBe('rsvp.notFound')
    })

    it('opens nothing with another event’s link, a malformed one, an oversized one, or none', async () => {
      for (const householdToken of [OTHER_LINK, 'short', 'X'.repeat(200), undefined, 42, null]) {
        const refused = await scene.viewHousehold({ token, householdToken })
        expect([String(householdToken).slice(0, 8), code(refused)]).toEqual([
          String(householdToken).slice(0, 8),
          'rsvp.notFound',
        ])
      }
    })
  })

  describe('submitRsvp with the link', () => {
    it('stores the household’s reply: source household, filed under it, with no reply token', async () => {
      const sent = await submit()

      expect(sent.ok && sent.value.editToken).toBeNull()
      expect(sent.ok && sent.value.created).toBe(true)
      expect(sent.ok && sent.value.rsvp.toProps()).toMatchObject({
        eventId: WEDDING,
        householdId: 'h-1',
        source: 'household',
        editTokenHash: null,
        name: 'Famille Martin',
        adults: 2,
        kids: 1,
      })
      expect(await scene.rsvps.listByEvent(WEDDING)).toHaveLength(1)
      expect(signals()).toEqual([{ type: 'rsvp.changed', eventId: WEDDING }])
    })

    it('takes the household’s places as the ceiling, not the form’s maximum of 4', async () => {
      await scene.households.update(
        aHousehold({ id: 'h-1', eventId: WEDDING, token: LINK, places: 6 }),
      )

      const six = await submit({ adults: 4, kids: 2 })
      const seven = await submit({ adults: 4, kids: 3 })

      expect(six.ok).toBe(true)
      expect(code(seven)).toBe('rsvp.partyTooBig')
      expect(!seven.ok && seven.error.details).toEqual({ max: 6 })
    })

    it('asks how many even when the form does not: a household of four is not one person', async () => {
      await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        form: { partySize: { enabled: false } },
      })

      const sent = await submit({ adults: 3, kids: 0 })

      expect(sent.ok && sent.value.rsvp.adults).toBe(3)
    })

    it('answers again for the same household by changing its reply, never a second one', async () => {
      await submit({ message: 'Premier mot' })
      scene.clock.advance(60_000)

      const again = await submit({ answer: 'no', message: 'Finalement non' })

      expect(again.ok && again.value.created).toBe(false)
      expect(again.ok && again.value.editToken).toBeNull()
      const stored = await scene.rsvps.listByEvent(WEDDING)
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({
        answer: 'no',
        message: 'Finalement non',
        source: 'household',
      })
      expect(stored[0]?.createdAt).not.toEqual(stored[0]?.updatedAt)
    })

    it('keeps the answers to a question the host removed when the household answers again', async () => {
      await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        form: { questions: [{ label: 'Une allergie ?', kind: 'text' }] },
      })
      const form = await scene.invites.findRsvpSettings(WEDDING)
      const questionId = form?.form.questions[0]?.id ?? ''
      await submit({ answers: [{ questionId, value: 'noix' }] })
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { questions: [] } })

      await submit({ message: 'Encore' })

      const stored = (await scene.rsvps.listByEvent(WEDDING))[0]
      expect(stored?.details.answers).toEqual([
        { questionId, label: 'Une allergie ?', value: 'noix' },
      ])
    })

    it('is a change of the reply the host filed under the household, whoever made it', async () => {
      scene.rsvps.seed(
        aRsvp({
          id: 'r-open',
          eventId: WEDDING,
          householdId: 'h-1',
          editTokenHash: 'kept-digest',
          source: 'open',
        }),
      )

      const sent = await submit()

      expect(sent.ok && sent.value.created).toBe(false)
      const stored = await scene.rsvps.listByEvent(WEDDING)
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({
        id: 'r-open',
        editTokenHash: 'kept-digest',
        source: 'open',
      })
    })

    it('answers for a household that is not this event’s with rsvp.notFound, and writes nothing', async () => {
      const foreign = await submit({ householdToken: OTHER_LINK })
      const unknown = await submit({ householdToken: '00000000000000AA' })

      expect(code(foreign)).toBe('rsvp.notFound')
      expect(code(unknown)).toBe('rsvp.notFound')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
      expect(signals()).toEqual([])
    })

    it('is refused once the window is closed, like any reply, and judges the form first', async () => {
      const nameless = await submit({ name: '' })
      await scene.close({ eventId: WEDDING, actorId: OWNER })
      const closed = await submit()

      expect(code(nameless)).toBe('rsvp.nameEmpty')
      expect(code(closed)).toBe('rsvp.closed')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
    })

    it('gives the honeypot every refusal a real reply gets, the unknown link and the places included', async () => {
      const trapped = await submit({ website: 'http://spam.example' })
      const unknown = await submit({ website: 'x', householdToken: '00000000000000AA' })
      const heavy = await submit({ website: 'x', adults: 5, kids: 0 })

      expect(trapped.ok && trapped.value.created).toBe(true)
      expect(trapped.ok && trapped.value.editToken).toBeNull()
      expect(code(unknown)).toBe('rsvp.notFound')
      expect(code(heavy)).toBe('rsvp.partyTooBig')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
      expect(signals()).toEqual([])
    })

    it('tells the honeypot a household that already answered is a change, and counts its own places once', async () => {
      await scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: {} })
      await submit({ adults: 2, kids: 1 })

      const trapped = await submit({ website: 'x', adults: 4, kids: 0 })

      expect(trapped.ok && trapped.value.created).toBe(false)
      expect((await scene.rsvps.listByEvent(WEDDING))[0]?.people).toBe(3)
    })

    it('counts a household’s old yes out of the places when it changes, as admit does', async () => {
      await scene.invites.saveRsvpSettings(WEDDING, {
        enabled: true,
        deadline: null,
        closedAt: null,
        form: { ...(await scene.invites.findRsvpSettings(WEDDING))!.form, capacity: 4 },
      })
      await submit({ adults: 4, kids: 0 })

      const same = await submit({ website: 'x', adults: 4, kids: 0 })

      expect(same.ok).toBe(true)
    })
  })

  describe('the household’s one reply, read, changed and deleted with the link', () => {
    const own = (overrides: Record<string, unknown> = {}) => ({
      token,
      editToken: undefined,
      householdToken: LINK,
      ...overrides,
    })

    it('reads the reply, and says rsvp.notFound while there is none', async () => {
      expect(code(await scene.getOwn(own()))).toBe('rsvp.notFound')
      await submit({ message: 'Mot' })

      const read = await scene.getOwn(own())

      expect(read.ok && read.value.message).toBe('Mot')
    })

    it('changes it by the household’s form, keeping its filing and its source', async () => {
      // Six places against the form's maximum of 4: only the household's own ceiling lets 5 through.
      await scene.households.update(
        aHousehold({ id: 'h-1', eventId: WEDDING, token: LINK, places: 6 }),
      )
      await submit()
      scene.clock.advance(1_000)

      const changed = await scene.updateOwn({ ...own(), ...ANSWER, adults: 5, kids: 0 })
      const tooMany = await scene.updateOwn({ ...own(), ...ANSWER, adults: 5, kids: 2 })

      expect(changed.ok && changed.value.toProps()).toMatchObject({
        householdId: 'h-1',
        source: 'household',
        adults: 5,
        updatedAt: scene.clock.now(),
      })
      expect(code(tooMany)).toBe('rsvp.partyTooBig')
      expect((await scene.rsvps.listByEvent(WEDDING))[0]?.adults).toBe(5)
    })

    it('does not make a reply from a change: with none yet it is rsvp.notFound, and with one deleted meanwhile too', async () => {
      const none = await scene.updateOwn({ ...own(), ...ANSWER })
      await submit()
      const find = scene.rsvps.findByHousehold.bind(scene.rsvps)
      scene.rsvps.findByHousehold = async (eventId, householdId) => {
        const found = await find(eventId, householdId)
        if (found !== null) await scene.rsvps.delete(eventId, found.id)
        return found
      }

      const raced = await scene.updateOwn({ ...own(), ...ANSWER })

      expect(code(none)).toBe('rsvp.notFound')
      expect(code(raced)).toBe('rsvp.notFound')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
    })

    it('is refused for a change once the window is closed, and still reads and deletes', async () => {
      await submit()
      await scene.close({ eventId: WEDDING, actorId: OWNER })

      const changed = await scene.updateOwn({ ...own(), ...ANSWER })
      const read = await scene.getOwn(own())
      const deleted = await scene.deleteOwn(own())

      expect(code(changed)).toBe('rsvp.closed')
      expect(read.ok).toBe(true)
      expect(deleted.ok).toBe(true)
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
    })

    it('deletes the reply and announces it, and the household can answer afresh', async () => {
      await submit()
      const before = signals().length

      await scene.deleteOwn(own())

      expect(signals()).toHaveLength(before + 1)
      const again = await submit()
      expect(again.ok && again.value.created).toBe(true)
    })

    it('deletes idempotently: an unknown link, another event’s link and a reply already gone are all the same success', async () => {
      await submit()
      await scene.deleteOwn(own())
      const before = signals().length

      for (const householdToken of [LINK, OTHER_LINK, '00000000000000AA', 'junk']) {
        const result = await scene.deleteOwn(own({ householdToken }))
        expect([householdToken, result.ok]).toEqual([householdToken, true])
      }

      expect(signals()).toHaveLength(before)
    })

    it('never deletes the reply of a household with another event’s link', async () => {
      await submit()

      await scene.deleteOwn(own({ householdToken: OTHER_LINK }))

      expect(await scene.rsvps.listByEvent(WEDDING)).toHaveLength(1)
      expect(await scene.rsvps.listByEvent(asEventId('evt-gala'))).toEqual([])
    })

    it('uses the household’s link when both keys are sent, and the reply token when only it is', async () => {
      const open = await scene.submit({ token, ...ANSWER, name: 'Léa' })
      await submit()
      const editToken = open.ok ? open.value.editToken : null

      const both = await scene.getOwn({ token, editToken, householdToken: LINK })
      const reply = await scene.getOwn({ token, editToken })

      expect(both.ok && both.value.name).toBe('Famille Martin')
      expect(reply.ok && reply.value.name).toBe('Léa')
    })

    it('refuses everything while the page cannot be served', async () => {
      await scene.disable({ eventId: WEDDING, actorId: OWNER })

      for (const result of [
        await scene.getOwn(own()),
        await scene.updateOwn({ ...own(), ...ANSWER }),
        await scene.deleteOwn(own()),
        await scene.viewHousehold({ token, householdToken: LINK }),
        await submit(),
      ]) {
        expect(code(result)).toBe('guestInvite.notAvailable')
      }
    })
  })
})
