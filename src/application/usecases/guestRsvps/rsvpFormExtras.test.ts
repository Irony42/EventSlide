import { beforeEach, describe, expect, it } from 'vitest'
import { OWNER, WEDDING, rsvpScene, type RsvpScene } from '../../testing/rsvpScene'

/**
 * The lot 2 form (spec 30): the companions' names, the menus and three questions of the host's own,
 * through the host's save, a guest's reply, a change, the host's correction and the spreadsheet.
 */

const MENUS = { enabled: true, options: ['Poisson', 'Végé'] }

describe('the form extras (spec 30, lot 2)', () => {
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
  const questionsOf = async () => {
    const view = await scene.getForm({ eventId: WEDDING, actorId: OWNER })
    return view.ok ? view.value.settings.form.questions : []
  }
  const asked = async () => {
    const saved = await save({
      companionNames: true,
      meals: MENUS,
      questions: [
        { label: 'Un chant ?', kind: 'text' },
        { label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] },
      ],
    })
    if (!saved.ok) throw new Error(saved.error.code)
    return saved.value.settings.form.questions
  }

  describe('saveRsvpForm', () => {
    it('gives every new question an id drawn from the id generator, and keeps it across saves', async () => {
      const [first, second] = await asked()

      expect(first?.id).toMatch(/^[0-9a-f]{8}$/)
      expect(second?.id).toMatch(/^[0-9a-f]{8}$/)
      expect(first?.id).not.toBe(second?.id)

      const renamed = await save({
        questions: [
          { id: first?.id, label: 'Votre chanson ?', kind: 'text' },
          { id: second?.id, label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] },
        ],
      })
      expect(renamed.ok && renamed.value.settings.form.questions.map((q) => q.id)).toEqual([
        first?.id,
        second?.id,
      ])
    })

    it('refuses an id the form does not hold, and saves nothing', async () => {
      await asked()

      const refused = await save({ questions: [{ id: 'deadbeef', label: 'X', kind: 'text' }] })

      expect(!refused.ok && refused.error.code).toBe('rsvp.questionsInvalid')
      expect(await questionsOf()).toHaveLength(2)
    })

    it('refuses a menu that is on with one option', async () => {
      const refused = await save({ meals: { enabled: true, options: ['Seul'] } })

      expect(!refused.ok && refused.error.code).toBe('rsvp.mealsInvalid')
    })
  })

  describe('a guest’s reply', () => {
    it('keeps the companions, the menus and the answers, with the labels of the day', async () => {
      const [q1, q2] = await asked()

      const sent = await scene.submit({
        token,
        name: 'Léa Martin',
        answer: 'yes',
        adults: 2,
        kids: 1,
        companions: ['Hugo', 'Inès'],
        meals: ['Poisson', 'Végé', 'Végé'],
        answers: [
          { questionId: q1?.id, value: 'Le Temps des cerises' },
          { questionId: q2?.id, value: 'Oui' },
        ],
      })

      expect(sent.ok && sent.value.rsvp.details).toMatchObject({
        companions: ['Hugo', 'Inès'],
        meals: ['Poisson', 'Végé', 'Végé'],
        answers: [
          { questionId: q1?.id, label: 'Un chant ?', value: 'Le Temps des cerises' },
          { questionId: q2?.id, label: 'Voiture ?', value: 'Oui' },
        ],
      })
      const stored = await scene.rsvps.listByEvent(WEDDING)
      expect(stored[0]?.details.meals).toEqual(['Poisson', 'Végé', 'Végé'])
    })

    it('is judged by the form of the moment: a menu the host removed is refused', async () => {
      await asked()
      await save({ meals: { options: ['Viande', 'Végé'] } })

      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 1,
        meals: ['Poisson'],
      })

      expect(!sent.ok && sent.error.code).toBe('rsvp.mealNotOffered')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
    })

    it('judges the honeypot’s reply like a real one: an unknown menu is refused', async () => {
      await asked()

      const trapped = await scene.submit({
        token,
        website: 'x',
        name: 'Bot',
        answer: 'yes',
        adults: 1,
        meals: ['Burger'],
      })

      expect(!trapped.ok && trapped.error.code).toBe('rsvp.mealNotOffered')
    })

    it('keeps what the form no longer asks when the guest changes the reply', async () => {
      const [q1, q2] = await asked()
      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 2,
        companions: ['Hugo'],
        meals: ['Poisson', 'Végé'],
        answers: [
          { questionId: q1?.id, value: 'Un chant' },
          { questionId: q2?.id, value: 'Non' },
        ],
      })
      if (!sent.ok) throw new Error('sent')
      // The host removes the first question, the menus and the companions' names.
      await save({
        companionNames: false,
        meals: { enabled: false },
        questions: [{ id: q2?.id, label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] }],
      })

      const changed = await scene.updateOwn({
        token,
        editToken: sent.value.editToken,
        name: 'Léa',
        answer: 'yes',
        adults: 2,
        answers: [{ questionId: q2?.id, value: 'Oui' }],
      })

      expect(changed.ok && changed.value.details).toMatchObject({
        companions: ['Hugo'],
        meals: ['Poisson', 'Végé'],
        answers: [
          { questionId: q2?.id, label: 'Voiture ?', value: 'Oui' },
          { questionId: q1?.id, label: 'Un chant ?', value: 'Un chant' },
        ],
      })
      const stored = await scene.rsvps.listByEvent(WEDDING)
      expect(stored[0]?.details.answers).toHaveLength(2)
    })

    it('empties the extras when the guest turns the reply into a no', async () => {
      await asked()
      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 2,
        companions: ['Hugo'],
        meals: ['Poisson'],
      })
      if (!sent.ok) throw new Error('sent')

      const changed = await scene.updateOwn({
        token,
        editToken: sent.value.editToken,
        name: 'Léa',
        answer: 'no',
      })

      expect(changed.ok && changed.value.details).toMatchObject({
        companions: [],
        meals: [],
        answers: [],
      })
    })
  })

  describe('the host’s reply', () => {
    it('is judged by the same form, and keeps what the form no longer asks when corrected', async () => {
      const [q1] = await asked()
      const added = await scene.hostAdd({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Zoé',
        answer: 'yes',
        adults: 2,
        companions: ['Max'],
        meals: ['Végé'],
        answers: [{ questionId: q1?.id, value: 'Sol' }],
      })
      if (!added.ok) throw new Error(added.error.code)
      await save({ companionNames: false, meals: { enabled: false }, questions: [] })

      const corrected = await scene.hostUpdate({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: added.value.id,
        name: 'Zoé Martin',
        answer: 'yes',
        adults: 2,
      })

      expect(corrected.ok && corrected.value.details).toMatchObject({
        companions: ['Max'],
        meals: ['Végé'],
        answers: expect.arrayContaining([
          { questionId: q1?.id, label: 'Un chant ?', value: 'Sol' },
        ]),
      })
    })

    it('refuses a repeated answer, and ignores one to a question the form does not ask', async () => {
      const [q1] = await asked()
      const add = (answers: unknown) =>
        scene.hostAdd({
          eventId: WEDDING,
          actorId: OWNER,
          name: 'Zoé',
          answer: 'yes',
          adults: 1,
          answers,
        })

      const repeated = await add([
        { questionId: q1?.id, value: 'a' },
        { questionId: q1?.id, value: 'b' },
      ])
      const stale = await add([{ questionId: 'zzzzzzzz', value: 'x' }])

      expect(!repeated.ok && repeated.error.code).toBe('rsvp.answersInvalid')
      expect(stale.ok).toBe(true)
    })
  })

  describe('a guest on a stale page, and the answers of a removed question', () => {
    it('is told the menu is no longer offered, and nothing is stored', async () => {
      await asked()
      await save({ meals: { options: ['Viande', 'Végé'] } })

      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 1,
        meals: ['Poisson'],
      })

      expect(!sent.ok && sent.error.code).toBe('rsvp.mealNotOffered')
      expect(await scene.rsvps.listByEvent(WEDDING)).toEqual([])
    })

    it('keeps the answer to a removed question through a no and back to a yes', async () => {
      const [q1, q2] = await asked()
      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 1,
        answers: [{ questionId: q1?.id, value: 'Un chant' }],
      })
      if (!sent.ok) throw new Error('sent')
      await save({
        questions: [{ id: q2?.id, label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] }],
      })
      const own = { token, editToken: sent.value.editToken, name: 'Léa', adults: 1 }

      const declined = await scene.updateOwn({ ...own, answer: 'no' })
      const back = await scene.updateOwn({ ...own, answer: 'yes' })

      expect(declined.ok && declined.value.details.answers).toEqual([
        { questionId: q1?.id, label: 'Un chant ?', value: 'Un chant' },
      ])
      expect(back.ok && back.value.details.answers).toContainEqual({
        questionId: q1?.id,
        label: 'Un chant ?',
        value: 'Un chant',
      })
    })

    it('keeps it through a no typed by the host too', async () => {
      const [q1] = await asked()
      const added = await scene.hostAdd({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Zoé',
        answer: 'yes',
        adults: 1,
        answers: [{ questionId: q1?.id, value: 'Sol' }],
      })
      if (!added.ok) throw new Error('added')
      await save({ questions: [] })

      const declined = await scene.hostUpdate({
        eventId: WEDDING,
        actorId: OWNER,
        rsvpId: added.value.id,
        name: 'Zoé',
        answer: 'no',
      })

      expect(declined.ok && declined.value.details.answers).toEqual([
        { questionId: q1?.id, label: 'Un chant ?', value: 'Sol' },
      ])
    })

    it('tells the page the menus while they are on', async () => {
      await asked()

      const page = await scene.view({ token })

      expect(page.ok && page.value.rsvp.form.meals).toEqual({
        enabled: true,
        options: MENUS.options,
      })
    })

    it('does not tell the page the menus while they are switched off', async () => {
      await asked()
      await save({ meals: { enabled: false } })

      const page = await scene.view({ token })

      expect(page.ok && page.value.rsvp.form.meals).toEqual({ enabled: false, options: [] })
    })

    it('keeps a menu with its person: a blank one in the middle stays blank', async () => {
      await asked()

      const sent = await scene.submit({
        token,
        name: 'Léa',
        answer: 'yes',
        adults: 3,
        companions: ['', 'Inès'],
        meals: ['', 'Végé'],
      })

      expect(sent.ok && sent.value.rsvp.details).toMatchObject({
        companions: ['', 'Inès'],
        meals: ['', 'Végé'],
      })
      const stored = await scene.rsvps.listByEvent(WEDDING)
      expect(stored[0]?.details.meals).toEqual(['', 'Végé'])
    })
  })

  describe('the spreadsheet', () => {
    it('writes the caterer’s file with the columns the form asks: menus off, diet off, neither is written', async () => {
      await asked()
      await scene.hostAdd({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Zoé',
        answer: 'yes',
        adults: 2,
        diet: 'noix',
        meals: ['Végé'],
      })
      const header = async () => {
        const exported = await scene.exportCsv({
          eventId: WEDDING,
          actorId: OWNER,
          view: 'caterer',
        })
        return exported.ok ? (exported.value.csv.split(String.fromCharCode(13, 10))[0] ?? '') : ''
      }
      expect(await header()).toContain('Menus;Allergies ou régime')

      await save({ meals: { enabled: false } })
      expect(await header()).not.toContain('Menus')

      await save({ diet: false })
      expect(await header()).toBe(String.fromCharCode(0xfeff) + 'Nom;Adultes;Enfants')
    })

    it('writes a column per question of the form and the companions and menus', async () => {
      const [q1] = await asked()
      await scene.hostAdd({
        eventId: WEDDING,
        actorId: OWNER,
        name: 'Zoé',
        answer: 'yes',
        adults: 2,
        companions: ['Max'],
        meals: ['Végé'],
        answers: [{ questionId: q1?.id, value: 'Sol' }],
      })

      const exported = await scene.exportCsv({ eventId: WEDDING, actorId: OWNER, view: 'all' })

      const lines = exported.ok ? exported.value.csv.split('\r\n') : []
      expect(lines[0]).toContain(
        'Accompagnants;Menus;Allergies ou régime;Un chant ?;Voiture ?;Message',
      )
      expect(lines[1]).toContain(';Max;Végé;;Sol;;')
    })
  })
})
