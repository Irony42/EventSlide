import { beforeEach, describe, expect, it } from 'vitest'
import { aHousehold } from '../../../domain/guestRsvps/testing/householdFixtures'
import { asGuestHouseholdId } from '../../../domain/shared/ids'
import { GALA, OWNER, WEDDING, rsvpScene, type RsvpScene } from '../../testing/rsvpScene'

/**
 * The moments of the party (spec 30, lot 4, PR 13): the host's form, a guest's choice, a
 * household's own list, the figures and the spreadsheet. What the form stops asking is **dropped**
 * (a moment id carries no label and never comes back), and a household is only ever asked, and
 * counted at, the moments it is invited to.
 */

const LINK = '7QX0M4TZ2KD9WB3H'
const H1 = asGuestHouseholdId('h-1')
const code = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code

describe('moments (spec 30, lot 4)', () => {
  let scene: RsvpScene
  let token: string

  beforeEach(async () => {
    scene = await rsvpScene()
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
    token = await scene.token()
  })

  const save = (form: Record<string, unknown>) =>
    scene.saveForm({ eventId: WEDDING, actorId: OWNER, form })
  const askMoments = async () => {
    const saved = await save({ moments: [{ label: 'Brunch' }, { label: 'Dîner' }] })
    if (!saved.ok) throw new Error(saved.error.code)
    const [brunch, dinner] = saved.value.settings.form.moments
    if (brunch === undefined || dinner === undefined) throw new Error('moments')
    return { brunch: brunch.id, dinner: dinner.id }
  }
  const seedHousehold = () =>
    scene.households.seed(
      aHousehold({ id: 'h-1', eventId: WEDDING, token: LINK, name: 'Famille Martin', places: 4 }),
    )

  describe('the host’s form', () => {
    it('gives each new moment an id that survives a rename and a reorder', async () => {
      const { brunch, dinner } = await askMoments()

      const renamed = await save({
        moments: [
          { id: dinner, label: 'Grand dîner' },
          { id: brunch, label: 'Brunch' },
        ],
      })

      expect(renamed.ok && renamed.value.settings.form.moments).toEqual([
        { id: dinner, label: 'Grand dîner' },
        { id: brunch, label: 'Brunch' },
      ])
    })

    it('refuses five moments, and a moment id nobody gave', async () => {
      const five = await save({
        moments: ['a', 'b', 'c', 'd', 'e'].map((label) => ({ label })),
      })
      const ghost = await save({ moments: [{ id: 'dddddddd', label: 'Ghost' }] })

      expect(code(five)).toBe('rsvp.momentsInvalid')
      expect(code(ghost)).toBe('rsvp.momentsInvalid')
    })

    it('tells the guest’s page the moments, and nothing when there are none', async () => {
      const before = await scene.view({ token })
      expect(before.ok && before.value.rsvp.form.moments).toEqual([])

      const { brunch } = await askMoments()
      const after = await scene.view({ token })

      expect(after.ok && after.value.rsvp.form.moments.map((moment) => moment.id)).toContain(brunch)
    })
  })

  describe('a guest’s reply', () => {
    it('needs a moment once the form asks for them, and keeps the ones chosen', async () => {
      const { brunch, dinner } = await askMoments()

      const none = await scene.submit({ token, name: 'Léa', answer: 'yes', adults: 2 })
      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 2,
        moments: [dinner, brunch],
      })

      expect(code(none)).toBe('rsvp.momentsRequired')
      expect(sent.ok && sent.value.rsvp.details.moments).toEqual([brunch, dinner])
    })

    it('judges the honeypot like a real reply: moments missing are refused the same way', async () => {
      await askMoments()

      const trap = await scene.submit({
        token,
        name: 'Bot',
        answer: 'yes',
        adults: 1,
        website: 'http://spam',
      })

      expect(code(trap)).toBe('rsvp.momentsRequired')
      expect(await scene.rsvps.listByEvent(WEDDING)).toHaveLength(0)
    })

    it('lets a no through without moments', async () => {
      await askMoments()

      const sent = await scene.submit({ token, name: 'Léa', answer: 'no' })

      expect(sent.ok && sent.value.rsvp.details.moments).toEqual([])
    })

    it('drops the moments the host removed at the guest’s next change, and counts none for them', async () => {
      const { brunch, dinner } = await askMoments()
      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 2,
        moments: [brunch, dinner],
      })
      if (!sent.ok) throw new Error('sent')
      await save({ moments: [{ id: dinner, label: 'Dîner' }] })

      const listed = await scene.list({ eventId: WEDDING, actorId: OWNER })
      expect(listed.ok && listed.value.stats.moments).toEqual([
        {
          id: dinner,
          label: 'Dîner',
          yes: { responses: 1, people: 2 },
          maybe: { responses: 0, people: 0 },
        },
      ])

      const changed = await scene.updateOwn({
        token,
        editToken: sent.value.editToken,
        name: 'Léa',
        answer: 'yes',
        adults: 2,
        // A stale page still offers the removed brunch: ignored, not refused.
        moments: [brunch, dinner],
      })
      expect(changed.ok && changed.value.details.moments).toEqual([dinner])
    })

    it('drops every moment when the form has none any more', async () => {
      const { brunch } = await askMoments()
      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 1,
        moments: [brunch],
      })
      if (!sent.ok) throw new Error('sent')
      await save({ moments: [] })

      const changed = await scene.updateOwn({
        token,
        editToken: sent.value.editToken,
        name: 'Léa',
        answer: 'yes',
        adults: 1,
      })

      expect(changed.ok && changed.value.details.moments).toEqual([])
    })

    it('drops the moments of a reply turned into a no', async () => {
      const { brunch } = await askMoments()
      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 1,
        moments: [brunch],
      })
      if (!sent.ok) throw new Error('sent')

      const changed = await scene.updateOwn({
        token,
        editToken: sent.value.editToken,
        name: 'Léa',
        answer: 'no',
      })

      expect(changed.ok && changed.value.details.moments).toEqual([])
    })
  })

  describe('a household’s moments', () => {
    it('are all the form’s by default, and shown to the household as such', async () => {
      const { brunch, dinner } = await askMoments()
      seedHousehold()

      const viewed = await scene.viewHousehold({ token, householdToken: LINK })

      expect(viewed.ok && viewed.value.moments.map((moment) => moment.id)).toEqual([brunch, dinner])
    })

    it('can be a subset: the household is only asked those, and only those are kept', async () => {
      const { brunch, dinner } = await askMoments()
      seedHousehold()
      const saved = await scene.saveHousehold({
        eventId: WEDDING,
        actorId: OWNER,
        householdId: H1,
        name: 'Famille Martin',
        places: 4,
        moments: [dinner],
      })
      expect(saved.ok && saved.value.household.moments).toEqual([dinner])

      const viewed = await scene.viewHousehold({ token, householdToken: LINK })
      expect(viewed.ok && viewed.value.moments.map((moment) => moment.id)).toEqual([dinner])

      const sent = await scene.submit({
        token,
        householdToken: LINK,
        name: 'Famille Martin',
        answer: 'yes',
        adults: 2,
        moments: [brunch, dinner],
      })
      expect(sent.ok && sent.value.rsvp.details.moments).toEqual([dinner])

      const onlyBrunch = await scene.submit({
        token,
        householdToken: LINK,
        name: 'Famille Martin',
        answer: 'yes',
        adults: 2,
        moments: [brunch],
      })
      expect(code(onlyBrunch)).toBe('rsvp.momentsRequired')
    })

    it('are judged against the form’s moments when the host sets them', async () => {
      const { brunch } = await askMoments()
      seedHousehold()
      const set = (moments: unknown) =>
        scene.saveHousehold({
          eventId: WEDDING,
          actorId: OWNER,
          householdId: H1,
          name: 'Famille Martin',
          places: 4,
          moments,
        })

      expect(code(await set(['dddddddd']))).toBe('household.momentsInvalid')
      expect(code(await set([]))).toBe('household.momentsInvalid')
      const one = await set([brunch])
      expect(one.ok && one.value.household.moments).toEqual([brunch])
    })

    it('stay as they were when a change names none, and go back to all with null', async () => {
      const { dinner } = await askMoments()
      seedHousehold()
      const change = (extra: Record<string, unknown>) =>
        scene.saveHousehold({
          eventId: WEDDING,
          actorId: OWNER,
          householdId: H1,
          name: 'Famille Martin',
          places: 3,
          ...extra,
        })
      await change({ moments: [dinner] })

      const renamed = await change({})
      expect(renamed.ok && renamed.value.household.moments).toEqual([dinner])

      const all = await change({ moments: null })
      expect(all.ok && all.value.household.moments).toBeNull()
    })

    it('start as all for a new household, and a list is refused while the form has no moments', async () => {
      const created = await scene.saveHousehold({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Les Durand',
        places: 2,
      })
      expect(created.ok && created.value.household.moments).toBeNull()

      const refused = await scene.saveHousehold({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Les Durand',
        places: 2,
        moments: ['aaaaaaaa'],
      })
      expect(code(refused)).toBe('household.momentsInvalid')
    })

    it('are empty for the household when the form has none', async () => {
      seedHousehold()

      const viewed = await scene.viewHousehold({ token, householdToken: LINK })

      expect(viewed.ok && viewed.value.moments).toEqual([])
    })

    it('are another event’s business: a household of another event gets no moment of this one', async () => {
      await askMoments()
      scene.households.seed(
        aHousehold({ id: 'h-gala', eventId: GALA, token: '8RY1N5V0A3MEXC4J', places: 2 }),
      )

      const viewed = await scene.viewHousehold({ token, householdToken: '8RY1N5V0A3MEXC4J' })

      expect(code(viewed)).toBe('rsvp.notFound')
    })
  })

  describe('the host’s reply', () => {
    it('is judged by the household’s form once filed under one, and by the form otherwise', async () => {
      const { brunch, dinner } = await askMoments()
      scene.households.seed(
        aHousehold({
          id: 'h-1',
          eventId: WEDDING,
          token: LINK,
          places: 4,
          moments: [dinner],
        }),
      )
      const added = await scene.hostAdd({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Zoé',
        answer: 'yes',
        adults: 2,
        moments: [brunch, dinner],
      })
      if (!added.ok) throw new Error(added.error.code)
      expect(added.value.details.moments).toEqual([brunch, dinner])
      await scene.attachRsvp({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: added.value.id,
        householdId: H1,
      })

      const corrected = await scene.hostUpdate({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: added.value.id,
        name: 'Zoé',
        answer: 'yes',
        adults: 2,
        moments: [brunch, dinner],
      })

      expect(corrected.ok && corrected.value.details.moments).toEqual([dinner])
    })

    it('needs a moment too', async () => {
      await askMoments()

      const added = await scene.hostAdd({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Zoé',
        answer: 'yes',
        adults: 1,
      })

      expect(code(added)).toBe('rsvp.momentsRequired')
    })
  })

  describe('the spreadsheet', () => {
    it('has a column per moment of the form, in the full file and in the caterer’s', async () => {
      const { brunch, dinner } = await askMoments()
      await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 2,
        moments: [brunch, dinner],
      })
      await scene.submit({ token, name: 'Hugo', answer: 'yes', adults: 1, moments: [dinner] })

      const all = await scene.exportCsv({ eventId: WEDDING, actorId: OWNER, view: 'all' })
      const caterer = await scene.exportCsv({ eventId: WEDDING, actorId: OWNER, view: 'caterer' })

      const allLines = all.ok ? all.value.csv.split('\r\n') : []
      expect(allLines[0]).toContain(';Brunch;Dîner;')
      const catererLines = caterer.ok ? caterer.value.csv.split('\r\n') : []
      expect(catererLines).toContain('Total;3;0;2;3;')
    })
  })
})

describe('moments that no longer mean anything (spec 30, lot 4)', () => {
  let scene: RsvpScene
  let token: string

  beforeEach(async () => {
    scene = await rsvpScene()
    await scene.enable({ eventId: WEDDING, actorId: OWNER })
    await scene.saveForm({ eventId: WEDDING, actorId: OWNER, enabled: true })
    token = await scene.token()
  })

  const askTwo = async () => {
    const saved = await scene.saveForm({
      eventId: WEDDING,
      actorId: OWNER,
      form: { moments: [{ label: 'Brunch' }, { label: 'Dîner' }] },
    })
    if (!saved.ok) throw new Error(saved.error.code)
    const [brunch, dinner] = saved.value.settings.form.moments
    return { brunch: brunch?.id ?? '', dinner: dinner?.id ?? '' }
  }

  it('asks a household whose moments were all removed every moment, and counts it', async () => {
    const { brunch } = await askTwo()
    scene.households.seed(
      aHousehold({ id: 'h-1', eventId: WEDDING, token: LINK, places: 4, moments: ['removed0'] }),
    )

    const viewed = await scene.viewHousehold({ token, householdToken: LINK })
    const sent = await scene.submit({
      token,
      householdToken: LINK,
      name: 'Famille Martin',
      answer: 'yes',
      adults: 2,
      moments: [brunch],
    })

    expect(viewed.ok && viewed.value.moments).toHaveLength(2)
    expect(sent.ok && sent.value.rsvp.details.moments).toEqual([brunch])
  })

  it('shows and counts a household reply only at the moments its household is invited to', async () => {
    const { brunch, dinner } = await askTwo()
    scene.households.seed(
      aHousehold({
        id: 'h-1',
        eventId: WEDDING,
        token: LINK,
        places: 4,
        moments: [brunch, dinner],
      }),
    )
    await scene.submit({
      token,
      householdToken: LINK,
      name: 'Famille Martin',
      answer: 'yes',
      adults: 2,
      moments: [brunch, dinner],
    })
    await scene.saveHousehold({
      eventId: WEDDING,
      actorId: OWNER,
      householdId: asGuestHouseholdId('h-1'),
      name: 'Famille Martin',
      places: 4,
      moments: [dinner],
    })

    const listed = await scene.list({ eventId: WEDDING, actorId: OWNER })
    const exported = await scene.exportCsv({ eventId: WEDDING, actorId: OWNER, view: 'caterer' })

    expect(listed.ok && listed.value.stats.moments.map((moment) => moment.yes.people)).toEqual([
      0, 2,
    ])
    expect(listed.ok && listed.value.rsvps[0]?.details.moments).toEqual([dinner])
    expect(exported.ok && exported.value.csv).toContain('Famille Martin;2;0;;2')
  })

  it('counts apart the yes replies with no moment, and lets the host save one without forcing a moment', async () => {
    const sent = await scene.submit({ token, name: 'Léa', answer: 'yes', adults: 2 })
    if (!sent.ok) throw new Error('sent')
    await askTwo()

    const listed = await scene.list({ eventId: WEDDING, actorId: OWNER })
    expect(listed.ok && listed.value.stats.noMoment).toEqual({ responses: 1, people: 2 })

    const corrected = await scene.hostUpdate({
      eventId: WEDDING,
      actorId: OWNER,
      rsvpId: sent.value.rsvp.id,
      name: 'Léa Martin',
      answer: 'yes',
      adults: 2,
    })
    expect(corrected.ok).toBe(true)
    // The guest herself is still asked for one.
    const guest = await scene.updateOwn({
      token,
      editToken: sent.value.editToken,
      name: 'Léa',
      answer: 'yes',
      adults: 2,
    })
    expect(code(guest)).toBe('rsvp.momentsRequired')
  })

  it('still forces a moment on a host correction when the reply has one that exists', async () => {
    const { brunch } = await askTwo()
    const sent = await scene.submit({
      token,
      name: 'Léa',
      answer: 'yes',
      adults: 1,
      moments: [brunch],
    })
    if (!sent.ok) throw new Error('sent')

    const corrected = await scene.hostUpdate({
      eventId: WEDDING,
      actorId: OWNER,
      rsvpId: sent.value.rsvp.id,
      name: 'Léa',
      answer: 'yes',
      adults: 1,
    })

    expect(code(corrected)).toBe('rsvp.momentsRequired')
  })
})
