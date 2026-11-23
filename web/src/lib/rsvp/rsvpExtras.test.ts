import { describe, expect, it } from 'vitest'
import { aGuestOwnRsvp, aGuestRsvpPage, aRsvpSettings } from '../../testing/renderWithProviders'
import {
  EMPTY_DRAFT,
  draftOf,
  draftOfHostReply,
  inputOf,
  peopleOfDraft,
  personName,
} from './rsvpDraft'
import { linesOf, questionsInput } from './rsvpExtras'
import { applyInput, mergeInputs, previewPage } from './rsvpSettings'
import { recapLines } from './rsvpTexts'
import { fr } from '../i18n/fr'

const FORM = {
  ...aGuestRsvpPage().form,
  companionNames: true,
  meals: { enabled: true, options: ['Poisson', 'Végé'] },
  questions: [
    { id: 'q1', label: 'Un chant ?', kind: 'text' as const },
    { id: 'q2', label: 'Voiture ?', kind: 'choice' as const, options: ['Oui', 'Non'] },
  ],
}
const YES = { ...EMPTY_DRAFT, answer: 'yes' as const, name: 'Léa Martin', adults: 2, kids: 1 }

describe('linesOf', () => {
  it('reads one entry per line, trimmed, the empty ones dropped', () => {
    expect(linesOf('  Poisson \n\n Végé\n   \n')).toEqual(['Poisson', 'Végé'])
    expect(linesOf('')).toEqual([])
  })
})

describe('questionsInput', () => {
  it('keeps the id of a saved question and sends none for a new one', () => {
    expect(
      questionsInput([
        { id: 'q1', label: 'Un chant ?', kind: 'text' },
        { id: '', label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] },
        { id: 'q3', label: 'Autre', kind: 'choice' },
      ]),
    ).toEqual([
      { id: 'q1', label: 'Un chant ?', kind: 'text' },
      { label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] },
      { id: 'q3', label: 'Autre', kind: 'choice', options: [] },
    ])
  })
})

describe('the guest’s draft, lot 2', () => {
  it('sends the companions of the other people, the menus chosen and an answer per question', () => {
    const input = inputOf(
      {
        ...YES,
        companions: ['Hugo', 'Inès', 'Trop'],
        meals: ['Poisson', '', 'Végé', 'Extra'],
        answers: { q1: 'Oh' },
      },
      FORM,
    )

    expect(input).toMatchObject({
      companions: ['Hugo', 'Inès'],
      meals: ['Poisson', '', 'Végé'],
      answers: [
        { questionId: 'q1', value: 'Oh' },
        { questionId: 'q2', value: '' },
      ],
    })
  })

  it('sends no menu for a maybe and nothing of the lot for a no or for a form that does not ask', () => {
    expect(inputOf({ ...YES, answer: 'maybe', meals: ['Poisson'] }, FORM)).not.toHaveProperty(
      'meals',
    )
    expect(inputOf({ ...YES, answer: 'no' }, FORM)).toEqual({
      name: 'Léa Martin',
      answer: 'no',
      message: null,
    })
    const plain = inputOf(
      { ...YES, companions: ['Hugo'], meals: ['Poisson'], answers: { q1: 'x' } },
      aGuestRsvpPage().form,
    )
    expect(plain).not.toHaveProperty('companions')
    expect(plain).not.toHaveProperty('meals')
    expect(plain).not.toHaveProperty('answers')
  })

  it('counts one person when the form does not ask how many', () => {
    const form = { ...FORM, partySize: { enabled: false, max: 4 } }

    expect(peopleOfDraft(YES, form)).toBe(1)
    expect(peopleOfDraft(YES, { ...FORM, kidsSeparate: false })).toBe(2)
    expect(peopleOfDraft(YES, FORM)).toBe(3)
    expect(peopleOfDraft({ ...YES, answer: 'no' }, FORM)).toBe(0)
    expect(inputOf({ ...YES, companions: ['Hugo'] }, form)).toMatchObject({ companions: [] })
  })

  it('names a person by the first name typed, or by the fallback', () => {
    const draft = { ...YES, companions: ['  Hugo ', ''] }

    expect(personName(draft, 0, 'Personne 1')).toBe('Léa')
    expect(personName(draft, 1, 'Personne 2')).toBe('Hugo')
    expect(personName(draft, 2, 'Personne 3')).toBe('Personne 3')
    expect(personName({ ...YES, name: '' }, 0, 'Personne 1')).toBe('Personne 1')
  })

  it('starts a change from what the reply holds, a guest’s or a host’s', () => {
    const reply = aGuestOwnRsvp({
      companions: ['Hugo'],
      meals: ['Poisson'],
      answers: [{ questionId: 'q1', label: 'Un chant ?', value: 'Oh' }],
    })

    expect(draftOf(reply, FORM)).toMatchObject({
      companions: ['Hugo'],
      meals: ['Poisson'],
      answers: { q1: 'Oh' },
    })
    expect(
      draftOfHostReply(
        {
          id: 'r1',
          name: 'Zoé',
          answer: 'yes',
          adults: 2,
          kids: 0,
          diet: null,
          message: null,
          source: 'host',
          details: {
            companions: ['Max'],
            meals: ['Végé'],
            answers: [{ questionId: 'q1', label: 'Un chant ?', value: 'Sol' }],
            moments: [],
            showName: false,
          },
          createdAt: '2026-11-20T10:00:00.000Z',
          updatedAt: '2026-11-20T10:00:00.000Z',
        },
        FORM,
      ),
    ).toMatchObject({ companions: ['Max'], meals: ['Végé'], answers: { q1: 'Sol' } })
  })
})

describe('the confirmation, lot 2', () => {
  it('says the companions, the menus and every answer given, and skips the empty ones', () => {
    const lines = recapLines(
      aGuestOwnRsvp({
        adults: 2,
        companions: ['Hugo', 'Inès'],
        meals: ['Poisson'],
        answers: [
          { questionId: 'q1', label: 'Un chant ?', value: 'Oh' },
          { questionId: 'q2', label: 'Voiture ?', value: '' },
        ],
      }),
      FORM,
      fr.rsvp.guest,
    )

    expect(lines).toContain(fr.rsvp.guest.recapCompanions('Hugo, Inès'))
    expect(lines).toContain(fr.rsvp.guest.recapMeals('Poisson'))
    expect(lines).toContain(fr.rsvp.guest.recapAnswer('Un chant ?', 'Oh'))
    expect(lines.join('')).not.toContain('Voiture')
  })
})

describe('the settings, lot 2', () => {
  it('lays the companions, the menus and the questions of a save over the server’s word', () => {
    const settings = aRsvpSettings()

    const next = applyInput(settings, {
      form: {
        companionNames: true,
        meals: { enabled: true, options: ['A', 'B'] },
        questions: [
          { label: 'Un chant ?', kind: 'text' },
          { id: 'q2', label: 'V', kind: 'choice', options: ['x', 'y'] },
        ],
      },
    })

    expect(next.form.companionNames).toBe(true)
    expect(next.form.meals).toEqual({ enabled: true, options: ['A', 'B'] })
    expect(next.form.questions).toEqual([
      { id: '', label: 'Un chant ?', kind: 'text' },
      { id: 'q2', label: 'V', kind: 'choice', options: ['x', 'y'] },
    ])
    expect(applyInput(next, { form: { meals: { enabled: false } } }).form.meals).toEqual({
      enabled: false,
      options: ['A', 'B'],
    })
    expect(applyInput(next, {}).form.questions).toEqual(next.form.questions)
  })

  it('merges a burst of menu choices field by field, and the later questions win whole', () => {
    expect(
      mergeInputs(
        { form: { meals: { enabled: true }, questions: [{ label: 'A', kind: 'text' }] } },
        { form: { meals: { options: ['x', 'y'] }, questions: [] } },
      ),
    ).toEqual({ form: { meals: { enabled: true, options: ['x', 'y'] }, questions: [] } })
    expect(mergeInputs({ form: { meals: { enabled: true } } }, {})).toEqual({
      form: { meals: { enabled: true } },
    })
  })

  it('shows the guest’s page with the companions, the menus and the questions as chosen', () => {
    const settings = applyInput(aRsvpSettings({ enabled: true }), {
      form: { companionNames: true, meals: { enabled: true, options: ['A', 'B'] } },
    })

    expect(previewPage(settings).form).toMatchObject({
      companionNames: true,
      meals: { enabled: true, options: ['A', 'B'] },
      questions: [],
    })
  })
})

describe('a choice the host changed since the reply was given', () => {
  const reply = aGuestOwnRsvp({
    adults: 2,
    companions: ['', 'Inès'],
    meals: ['Poisson', 'Végé'],
    answers: [
      { questionId: 'q1', label: 'Un chant ?', value: 'Oh' },
      { questionId: 'q2', label: 'Voiture ?', value: 'Peut-être' },
    ],
  })
  const renamed = { ...FORM, meals: { enabled: true, options: ['Viande', 'Végé'] } }

  it('blanks a menu or a choice the form no longer offers, so the screen and the payload agree', () => {
    const draft = draftOf(reply, renamed)

    expect(draft.meals).toEqual(['', 'Végé'])
    expect(draft.answers).toEqual({ q1: 'Oh', q2: '' })
    expect(inputOf({ ...draft, answer: 'yes' }, renamed)).toMatchObject({
      meals: ['', 'Végé'],
      answers: [
        { questionId: 'q1', value: 'Oh' },
        { questionId: 'q2', value: '' },
      ],
    })
  })

  it('does not send a stale menu even when the draft still holds it', () => {
    const input = inputOf({ ...YES, adults: 2, kids: 0, meals: ['Poisson', 'Végé'] }, renamed)

    expect(input.meals).toEqual(['', 'Végé'])
  })

  it('does the same for the host’s correction', () => {
    const host = draftOfHostReply(
      {
        id: 'r1',
        name: 'Zoé',
        answer: 'yes',
        adults: 2,
        kids: 0,
        diet: null,
        message: null,
        source: 'host',
        details: {
          companions: [],
          meals: ['Poisson', 'Végé'],
          answers: [{ questionId: 'q2', label: 'Voiture ?', value: 'Peut-être' }],
          moments: [],
          showName: false,
        },
        createdAt: '2026-11-20T10:00:00.000Z',
        updatedAt: '2026-11-20T10:00:00.000Z',
      },
      renamed,
    )

    expect(host.meals).toEqual(['', 'Végé'])
    expect(host.answers).toEqual({ q2: '' })
  })

  it('keeps each menu with its person: nothing is filtered out of the list', () => {
    const draft = { ...YES, adults: 3, kids: 0, meals: ['', 'Végé', ''] }

    expect(inputOf(draft, FORM).meals).toEqual(['', 'Végé', ''])
    expect(personName({ ...draft, companions: ['', 'Inès'] }, 2, 'Personne 3')).toBe('Inès')
  })

  it('does not name a menu while the menus are off', () => {
    const off = { ...FORM, meals: { enabled: false, options: [] } }

    expect(draftOf(reply, off).meals).toEqual(['', ''])
  })
})

describe('who comes: the guest’s box', () => {
  const NAMES = { ...FORM, visibility: 'names' as const }

  it('sends the tick only for a yes while first names are shown', () => {
    const draft = { ...YES, showName: true }

    expect(inputOf(draft, NAMES)).toMatchObject({ showName: true })
    expect(inputOf({ ...draft, showName: false }, NAMES)).toMatchObject({ showName: false })
    expect(inputOf(draft, { ...FORM, visibility: 'count' })).not.toHaveProperty('showName')
    expect(inputOf(draft, FORM)).not.toHaveProperty('showName')
    expect(inputOf({ ...draft, answer: 'maybe' }, NAMES)).not.toHaveProperty('showName')
    expect(inputOf({ ...draft, answer: 'no' }, NAMES)).not.toHaveProperty('showName')
  })

  it('starts a change from the tick the reply holds, and from none for a new reply', () => {
    expect(draftOf(aGuestOwnRsvp({ showName: true }), NAMES).showName).toBe(true)
    expect(EMPTY_DRAFT.showName).toBe(false)
  })

  it('says in the confirmation that the first name is shown, only when it is', () => {
    const lines = (showName: boolean) =>
      recapLines(aGuestOwnRsvp({ showName }), NAMES, fr.rsvp.guest)

    expect(lines(true)).toContain(fr.rsvp.guest.recapShowName)
    expect(lines(false)).not.toContain(fr.rsvp.guest.recapShowName)
  })

  it('lays the choice of the page over the server’s word, and shows it in the preview', () => {
    const settings = applyInput(aRsvpSettings({ enabled: true }), { form: { visibility: 'names' } })

    expect(settings.form.visibility).toBe('names')
    expect(previewPage(settings).form.visibility).toBe('names')
    expect(applyInput(settings, {}).form.visibility).toBe('names')
  })
})
