import { beforeEach, describe, expect, it } from 'vitest'
import { aHousehold } from '../../../domain/guestRsvps/testing/householdFixtures'
import { OWNER, WEDDING, rsvpScene, type RsvpScene } from '../../testing/rsvpScene'

/**
 * Limited places and the waiting list (spec 30, lot 4, PR 14). The host fixes a number of people;
 * a `yes` that would pass it becomes a waiting-list entry, decided inside `admit` (the honeypot
 * mirrors it); the waiting list takes no place and appears in no public or caterer figure; the
 * host promotes by hand.
 */

const LINK = '7QX0M4TZ2KD9WB3H'
const code = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code

describe('limited places (spec 30, lot 4)', () => {
  let scene: RsvpScene
  let token: string

  beforeEach(async () => {
    scene = await rsvpScene()
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
    token = await scene.token()
  })

  const limit = (capacity: unknown) =>
    scene.saveForm({ eventId: WEDDING, actorId: OWNER, form: { capacity } })
  const yes = (name: string, adults: number, extra: Record<string, unknown> = {}) =>
    scene.submit({ token, name, answer: 'yes', adults, ...extra })
  const stateOfPage = async () => {
    const page = await scene.view({ token })
    return page.ok ? page.value.rsvp.state : undefined
  }

  describe('the host’s setting', () => {
    it('saves and lifts the capacity, audited once, and refuses a number out of bounds', async () => {
      const set = await limit(3)
      expect(set.ok && set.value.settings.form.capacity).toBe(3)
      expect(code(await limit(0))).toBe('rsvp.capacityInvalid')
      expect(code(await limit(2001))).toBe('rsvp.capacityInvalid')
      const lifted = await limit(null)
      expect(lifted.ok && lifted.value.settings.form.capacity).toBeNull()
    })
  })

  describe('what the page says before anybody answers', () => {
    it('says the places are limited, never the number nor how many are taken', async () => {
      const before = await scene.view({ token })
      await limit(40)
      await yes('Léa', 2)
      const after = await scene.view({ token })

      expect(before.ok && before.value.rsvp.form.limited).toBe(false)
      expect(after.ok && after.value.rsvp.form.limited).toBe(true)
      expect(JSON.stringify(after.ok && after.value.rsvp)).not.toContain('40')
    })
  })

  describe('a guest’s yes', () => {
    it('is admitted while the places last, whole, and goes on the waiting list when it would pass them', async () => {
      await limit(3)

      const first = await yes('Léa', 2)
      const second = await yes('Hugo', 2)
      const third = await yes('Inès', 1)

      expect([first, second, third].map((sent) => sent.ok && sent.value.rsvp.answer)).toEqual([
        'yes',
        'waitlist',
        'yes',
      ])
      expect(await scene.rsvps.yesPeople(WEDDING)).toBe(3)
    })

    it('says full once the places are taken, and still takes a reply', async () => {
      await limit(2)
      expect(await stateOfPage()).toBe('open')

      await yes('Léa', 2)

      expect(await stateOfPage()).toBe('full')
      const late = await yes('Hugo', 1)
      expect(late.ok && late.value.rsvp.answer).toBe('waitlist')
    })

    it('does not hold back a maybe or a no, whatever the places', async () => {
      await limit(1)
      await yes('Léa', 1)

      const maybe = await scene.submit({ token, name: 'Tom', answer: 'maybe', adults: 4 })
      const no = await scene.submit({ token, name: 'Zoé', answer: 'no' })

      expect([maybe, no].map((sent) => sent.ok && sent.value.rsvp.answer)).toEqual(['maybe', 'no'])
    })

    it('is judged by the same rule for the honeypot, which stores nothing', async () => {
      await limit(1)
      await yes('Léa', 1)

      const trapped = await yes('Bot', 1, { website: 'http://spam' })

      expect(trapped.ok && trapped.value.rsvp.answer).toBe('waitlist')
      expect(await scene.rsvps.count(WEDDING)).toBe(1)
    })

    it('takes a household’s people, not one place, against the capacity', async () => {
      await limit(4)
      scene.households.seed(
        aHousehold({ id: 'h-1', eventId: WEDDING, token: LINK, name: 'Famille Martin', places: 4 }),
      )
      await yes('Léa', 2)

      const sent = await scene.submit({
        token,
        householdToken: LINK,
        name: 'Famille Martin',
        answer: 'yes',
        adults: 3,
      })

      expect(sent.ok && sent.value.rsvp.answer).toBe('waitlist')
    })
  })

  describe('a guest’s own change', () => {
    it('keeps a waiting-list entry on the list when the guest says yes again, even if places are free', async () => {
      await limit(1)
      const first = await yes('Léa', 1)
      const waiting = await yes('Hugo', 1)
      if (!first.ok || !waiting.ok) throw new Error('sent')
      await scene.hostDelete({ eventId: WEDDING, actorId: OWNER, rsvpId: first.value.rsvp.id })

      const again = await scene.updateOwn({
        token,
        editToken: waiting.value.editToken,
        name: 'Hugo',
        answer: 'yes',
        adults: 1,
      })

      expect(again.ok && again.value.answer).toBe('waitlist')
    })

    it('lets the waiting-list guest change to a maybe or a no, and say yes again afterwards like a new yes', async () => {
      await limit(1)
      await yes('Léa', 1)
      const waiting = await yes('Hugo', 1)
      if (!waiting.ok) throw new Error('sent')
      const change = (answer: string) =>
        scene.updateOwn({
          token,
          editToken: waiting.value.editToken,
          name: 'Hugo',
          answer,
          adults: 1,
        })

      const maybe = await change('maybe')
      const back = await change('yes')

      expect(maybe.ok && maybe.value.answer).toBe('maybe')
      // The places are still taken: this yes is a new one, and waits.
      expect(back.ok && back.value.answer).toBe('waitlist')
    })

    it('refuses a confirmed yes that grows past the places left, rsvp.full, and touches nothing stored', async () => {
      await limit(3)
      const sent = await yes('Léa', 2)
      if (!sent.ok) throw new Error('sent')
      await yes('Hugo', 1)

      const grown = await scene.updateOwn({
        token,
        editToken: sent.value.editToken,
        name: 'Léa',
        answer: 'yes',
        adults: 3,
      })

      expect(code(grown)).toBe('rsvp.full')
      const stored = await scene.rsvps.findById(WEDDING, sent.value.rsvp.id)
      expect([stored?.answer, stored?.adults]).toEqual(['yes', 2])
      expect(await scene.rsvps.yesPeople(WEDDING)).toBe(3)
    })

    it('lets a confirmed yes grow into the places that are left', async () => {
      await limit(4)
      const sent = await yes('Léa', 2)
      if (!sent.ok) throw new Error('sent')
      await yes('Hugo', 1)

      const grown = await scene.updateOwn({
        token,
        editToken: sent.value.editToken,
        name: 'Léa',
        answer: 'yes',
        adults: 3,
      })

      expect(grown.ok && grown.value.answer).toBe('yes')
    })

    it('never evicts a held yes that edits its note after the host lowered the capacity under it', async () => {
      await limit(5)
      const sent = await yes('Léa', 4)
      if (!sent.ok) throw new Error('sent')
      await limit(2)

      const same = await scene.updateOwn({
        token,
        editToken: sent.value.editToken,
        name: 'Léa Martin',
        answer: 'yes',
        adults: 4,
        diet: 'sans gluten',
      })
      const fewer = await scene.updateOwn({
        token,
        editToken: sent.value.editToken,
        name: 'Léa Martin',
        answer: 'yes',
        adults: 3,
      })

      expect([same, fewer].map((reply) => reply.ok && reply.value.answer)).toEqual(['yes', 'yes'])
      expect(await scene.rsvps.yesPeople(WEDDING)).toBe(3)
    })

    it('judges the honeypot like a household’s real change: the same rsvp.full', async () => {
      await limit(3)
      scene.households.seed(
        aHousehold({ id: 'h-1', eventId: WEDDING, token: LINK, name: 'Famille Martin', places: 4 }),
      )
      await scene.submit({
        token,
        householdToken: LINK,
        name: 'Famille Martin',
        answer: 'yes',
        adults: 2,
      })
      await yes('Hugo', 1)
      const grow = (extra: Record<string, unknown>) =>
        scene.submit({
          token,
          householdToken: LINK,
          name: 'Famille Martin',
          answer: 'yes',
          adults: 3,
          ...extra,
        })

      const real = await grow({})
      const trapped = await grow({ website: 'x' })

      expect([code(real), code(trapped)]).toEqual(['rsvp.full', 'rsvp.full'])
    })
  })

  describe('the waiting list in what others see', () => {
    it('is never in the public count, nor the names, nor the people at a moment', async () => {
      const form = await scene.saveForm({
        eventId: WEDDING,
        actorId: OWNER,
        form: { capacity: 1, visibility: 'names', moments: [{ label: 'Brunch' }] },
      })
      if (!form.ok) throw new Error(form.error.code)
      const brunch = form.value.settings.form.moments[0]?.id ?? ''
      await yes('Léa', 1, { showName: true, moments: [brunch] })
      await yes('Hugo', 3, { showName: true, moments: [brunch] })

      const page = await scene.view({ token })
      const listed = await scene.list({ eventId: WEDDING, actorId: OWNER })
      const exported = await scene.exportCsv({ eventId: WEDDING, actorId: OWNER, view: 'caterer' })

      expect(page.ok && page.value.rsvp.proof).toEqual({ count: 1, names: ['Léa'] })
      expect(listed.ok && listed.value.stats.waitlist).toEqual({ responses: 1, people: 3 })
      expect(listed.ok && listed.value.stats.yes.people).toBe(1)
      expect(listed.ok && listed.value.stats.moments[0]?.yes.people).toBe(1)
      expect(listed.ok && listed.value.stats.noMoment).toEqual({ responses: 0, people: 0 })
      expect(exported.ok && exported.value.csv).not.toContain('Hugo')
      expect(exported.ok && exported.value.csv).toContain('Total;1;0;')
    })
  })

  describe('the host', () => {
    it('promotes a waiting-list reply with a yes, not held to the capacity, and keeps one on the list when it is sent back unchanged', async () => {
      await limit(1)
      await yes('Léa', 1)
      const waiting = await yes('Hugo', 2)
      if (!waiting.ok) throw new Error('sent')
      const correct = (answer: string) =>
        scene.hostUpdate({
          eventId: WEDDING,
          actorId: OWNER,
          rsvpId: waiting.value.rsvp.id,
          name: 'Hugo',
          answer,
          adults: 2,
        })

      const kept = await correct('waitlist')
      const promoted = await correct('yes')

      expect(kept.ok && kept.value.answer).toBe('waitlist')
      expect(promoted.ok && promoted.value.answer).toBe('yes')
      expect(await scene.rsvps.yesPeople(WEDDING)).toBe(3)
    })

    it('adds a reply over the capacity as a yes: the host decides', async () => {
      await limit(1)
      await yes('Léa', 1)

      const added = await scene.hostAdd({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Zoé',
        answer: 'yes',
        adults: 2,
      })

      expect(added.ok && added.value.answer).toBe('yes')
      const stored = await scene.rsvps.listByEvent(WEDDING)
      expect(stored.find((reply) => reply.name === 'Zoé')?.answer).toBe('yes')
    })

    it('lowering the capacity under the people already coming evicts nobody', async () => {
      await limit(5)
      await yes('Léa', 4)

      await limit(2)

      expect(await scene.rsvps.yesPeople(WEDDING)).toBe(4)
      expect(await stateOfPage()).toBe('full')
    })
  })
})
