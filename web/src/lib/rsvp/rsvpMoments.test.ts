import { describe, expect, it } from 'vitest'
import {
  aGuestOwnRsvp,
  aGuestRsvpPage,
  aHousehold,
  anRsvp,
  aRsvpSettings,
} from '../../testing/renderWithProviders'
import { fr } from '../i18n/fr'
import { formForReply, invitedMomentsLabel } from './households'
import {
  EMPTY_DRAFT,
  draftOf,
  draftOfHostReply,
  householdForm,
  inputOf,
  toggleMoment,
} from './rsvpDraft'
import { momentsLabel } from './rsvpCaterer'
import { momentsInput } from './rsvpExtras'
import { applyInput, mergeInputs, previewPage } from './rsvpSettings'
import { momentLabels, recapLines } from './rsvpTexts'

const BRUNCH = { id: 'aaaaaaaa', label: 'Brunch' }
const DINNER = { id: 'bbbbbbbb', label: 'Dîner' }
const FORM = { ...aGuestRsvpPage().form, moments: [BRUNCH, DINNER] }
const YES = { ...EMPTY_DRAFT, answer: 'yes' as const, name: 'Léa Martin', adults: 2 }

describe('the guest’s moments', () => {
  it('ticks and unticks a moment', () => {
    const ticked = toggleMoment(EMPTY_DRAFT, BRUNCH.id)
    expect(ticked.moments).toEqual([BRUNCH.id])
    expect(toggleMoment(ticked, DINNER.id).moments).toEqual([BRUNCH.id, DINNER.id])
    expect(toggleMoment(ticked, BRUNCH.id).moments).toEqual([])
  })

  it('sends the moments ticked, in the form order, and only the ones the form still offers', () => {
    const input = inputOf({ ...YES, moments: [DINNER.id, 'removed0', BRUNCH.id] }, FORM)

    expect(input.moments).toEqual([BRUNCH.id, DINNER.id])
  })

  it('sends nothing of moments when the form has none, and nothing for a no', () => {
    expect(inputOf({ ...YES, moments: [BRUNCH.id] }, aGuestRsvpPage().form)).not.toHaveProperty(
      'moments',
    )
    expect(inputOf({ ...YES, answer: 'no', moments: [BRUNCH.id] }, FORM)).not.toHaveProperty(
      'moments',
    )
  })

  it('opens a change on the moments still offered, the removed ones blanked from the draft', () => {
    const reply = aGuestOwnRsvp({ moments: [BRUNCH.id, 'removed0'] })

    expect(draftOf(reply, FORM).moments).toEqual([BRUNCH.id])
    expect(draftOf(reply, aGuestRsvpPage().form).moments).toEqual([])
  })

  it('reads the moments of a reply the host corrects', () => {
    const reply = anRsvp({
      details: { companions: [], meals: [], answers: [], moments: [DINNER.id], showName: false },
    })

    expect(draftOfHostReply(reply, FORM).moments).toEqual([DINNER.id])
  })

  it('gives a household the moments it is invited to, among the form’s', () => {
    const form = householdForm(FORM, { places: 3, moments: [DINNER, { id: 'removed0' }] })

    expect(form.moments).toEqual([DINNER])
    expect(form.partySize).toEqual({ enabled: true, max: 3 })
  })

  it('words the moments of a confirmation by their labels, never an id', () => {
    const lines = recapLines(
      aGuestOwnRsvp({ moments: [DINNER.id, 'removed0'] }),
      FORM,
      fr.rsvp.guest,
    )

    expect(lines).toContain(`Moments : Dîner`)
    expect(lines.join(' ')).not.toContain('removed0')
    expect(
      recapLines(aGuestOwnRsvp({ answer: 'no', moments: [DINNER.id] }), FORM, fr.rsvp.guest),
    ).not.toContain(`Moments : Dîner`)
  })

  it('lists the labels of the moments named, in the form order', () => {
    expect(momentLabels([DINNER.id, BRUNCH.id], FORM)).toEqual(['Brunch', 'Dîner'])
  })
})

describe('the host’s moments', () => {
  it('sends an id for a saved moment and none for a new one', () => {
    expect(
      momentsInput([
        { id: BRUNCH.id, label: 'Brunch' },
        { id: '', label: 'Bal' },
      ]),
    ).toEqual([{ id: BRUNCH.id, label: 'Brunch' }, { label: 'Bal' }])
  })

  it('lays the moments over the settings while a save is on its way, a new one with no id yet', () => {
    const settings = aRsvpSettings()

    const next = applyInput(settings, { form: { moments: [{ label: 'Bal' }] } })

    expect(next.form.moments).toEqual([{ id: '', label: 'Bal' }])
    expect(applyInput(settings, { enabled: true }).form.moments).toEqual(settings.form.moments)
  })

  it('merges two inputs by letting the later moments win', () => {
    const merged = mergeInputs(
      { form: { moments: [{ label: 'A' }] } },
      { form: { moments: [{ label: 'B' }] } },
    )

    expect(merged.form?.moments).toEqual([{ label: 'B' }])
  })

  it('shows the moments in the preview of the guest’s page', () => {
    const settings = aRsvpSettings()

    expect(
      previewPage({ ...settings, form: { ...settings.form, moments: [BRUNCH] } }).form.moments,
    ).toEqual([BRUNCH])
  })

  it('words a reply’s moments by the labels the form has today', () => {
    const reply = anRsvp({
      details: {
        companions: [],
        meals: [],
        answers: [],
        moments: [DINNER.id, 'removed0'],
        showName: false,
      },
    })

    expect(momentsLabel(reply, FORM)).toBe('Dîner')
    expect(momentsLabel({ ...reply, answer: 'no' }, FORM)).toBe('')
  })
})

describe('a household and its moments', () => {
  const reply = (householdId: string | null) => anRsvp({ householdId })

  it('judges a reply filed under a household by the moments that household is invited to', () => {
    const household = aHousehold({ id: 'h-1', moments: [DINNER.id] })

    expect(formForReply(FORM, reply('h-1'), [household]).moments).toEqual([DINNER])
  })

  it('keeps the form for a reply under nobody, an unknown household or one invited to all', () => {
    expect(formForReply(FORM, reply(null), [aHousehold({ id: 'h-1', moments: [DINNER.id] })])).toBe(
      FORM,
    )
    expect(formForReply(FORM, reply('ghost'), [aHousehold({ id: 'h-1' })])).toBe(FORM)
    expect(formForReply(FORM, reply('h-1'), [aHousehold({ id: 'h-1', moments: null })])).toBe(FORM)
    expect(formForReply(FORM, null, [])).toBe(FORM)
  })

  it('says "all" for the default and the labels of the form’s moments otherwise', () => {
    expect(invitedMomentsLabel(aHousehold({ moments: null }), FORM.moments, 'Tous')).toBe('Tous')
    expect(
      invitedMomentsLabel(aHousehold({ moments: [DINNER.id, 'removed0'] }), FORM.moments, 'Tous'),
    ).toBe('Dîner')
  })
})
