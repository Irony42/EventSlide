import { describe, expect, it } from 'vitest'
import { aRsvpSettings } from '../../../testing/renderWithProviders'
import { optionCount, shortDay } from './panelSummaries'

const withForm = (form: Partial<ReturnType<typeof aRsvpSettings>['form']>) =>
  aRsvpSettings({ form: { ...aRsvpSettings().form, ...form } })

describe('the replies’ options counted for the door', () => {
  it('counts the defaults of a party: maybe, the number of people, allergies, a word from the absent', () => {
    expect(optionCount(aRsvpSettings())).toBe(4)
  })

  it('counts nothing when nothing is asked', () => {
    expect(
      optionCount(
        withForm({
          maybe: false,
          partySize: { enabled: false, max: 4 },
          diet: false,
          absentNote: false,
        }),
      ),
    ).toBe(0)
  })

  it('counts each extra switched on, and each question and moment', () => {
    const settings = withForm({
      companionNames: true,
      meals: { enabled: true, options: ['a', 'b'] },
      capacity: 40,
      visibility: 'names',
      questions: [{ id: 'q1', label: 'Une chanson ?', kind: 'text' }],
      moments: [
        { id: 'm1', label: 'Brunch' },
        { id: 'm2', label: 'Soirée' },
      ],
    })

    expect(optionCount(settings)).toBe(4 + 4 + 1 + 2)
  })
})

describe('the short day of a deadline', () => {
  it('writes the calendar day itself, whatever the zone of the browser', () => {
    expect(shortDay('2026-12-06', 'fr')).toBe('6 déc.')
    expect(shortDay('2026-12-06', 'en')).toBe('Dec 6')
  })
})
