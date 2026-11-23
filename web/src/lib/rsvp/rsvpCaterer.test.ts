import { describe, expect, it } from 'vitest'
import { anRsvp } from '../../testing/renderWithProviders'
import { companionsLabel, mealsLabel, printRowsOf } from './rsvpCaterer'

describe('mealsLabel', () => {
  it('names each menu once, with how many when more than one, as the file does', () => {
    expect(mealsLabel(['Poisson', 'Végé', 'Poisson', 'Poisson'])).toBe('Poisson ×3, Végé')
    expect(mealsLabel(['', 'Végé', ''])).toBe('Végé')
    expect(mealsLabel([])).toBe('')
  })
})

describe('companionsLabel', () => {
  it('lists the first names, the blank ones left out', () => {
    const reply = anRsvp({
      details: {
        companions: ['', 'Inès', 'Hugo'],
        meals: [],
        answers: [],
        moments: [],
        showName: false,
      },
    })

    expect(companionsLabel(reply)).toBe('Inès, Hugo')
  })
})

describe('printRowsOf', () => {
  it('keeps those who come, by name, without regard to case or accents', () => {
    const rows = printRowsOf([
      anRsvp({ id: 'a', name: 'zoé' }),
      anRsvp({ id: 'b', name: 'Émile' }),
      anRsvp({ id: 'c', name: 'Tom', answer: 'maybe' }),
      anRsvp({ id: 'd', name: 'Ana', answer: 'no' }),
      anRsvp({ id: 'e', name: 'Eve', answer: 'waitlist' }),
      anRsvp({ id: 'f', name: 'Bob' }),
    ])

    expect(rows.map((row) => row.name)).toEqual(['Bob', 'Émile', 'zoé'])
  })

  it('does not change the list it is given', () => {
    const given = [anRsvp({ id: 'a', name: 'Zoé' }), anRsvp({ id: 'b', name: 'Bob' })]

    printRowsOf(given)

    expect(given.map((row) => row.name)).toEqual(['Zoé', 'Bob'])
  })
})
