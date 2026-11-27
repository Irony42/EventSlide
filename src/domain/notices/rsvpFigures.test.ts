import { describe, expect, it } from 'vitest'
import type { RsvpStats } from '../guestRsvps/rsvpStats'
import { rsvpFiguresOf } from './rsvpFigures'

const STATS: RsvpStats = {
  yes: { responses: 3, people: 7, adults: 5, kids: 2 },
  maybe: { responses: 1, people: 2 },
  no: { responses: 4 },
  waitlist: { responses: 1, people: 3 },
  diets: [
    { name: 'Camille Durand', diet: 'allergique aux arachides' },
    { name: 'Marc', diet: 'sans gluten' },
  ],
  meals: [
    { label: 'Poisson', count: 4 },
    { label: 'Végétarien', count: 2 },
    { label: 'Mon texte libre, Camille', count: 1 },
  ],
  noReply: { households: 12, places: 30 },
  moments: [
    {
      id: 'm1',
      label: 'Brunch',
      yes: { responses: 1, people: 2 },
      maybe: { responses: 0, people: 0 },
    },
  ],
  noMoment: { responses: 0, people: 0 },
}

describe('rsvpFiguresOf', () => {
  it('keeps the counts a host reads on the page', () => {
    const figures = rsvpFiguresOf(STATS, ['Poisson', 'Végétarien'])

    expect(figures.yes).toEqual({ responses: 3, people: 7, adults: 5, kids: 2 })
    expect(figures.maybe).toEqual({ responses: 1, people: 2 })
    expect(figures.no).toEqual({ responses: 4 })
    expect(figures.waitlist).toEqual({ responses: 1, people: 3 })
    expect(figures.noReplyHouseholds).toBe(12)
  })

  it('reduces the diets to a number: no name and no word of a guest', () => {
    const figures = rsvpFiguresOf(STATS, ['Poisson'])

    expect(figures.dietCount).toBe(2)
    const text = JSON.stringify(figures)
    expect(text).not.toContain('Camille')
    expect(text).not.toContain('arachides')
    expect(text).not.toContain('gluten')
  })

  it('keeps only the menus the host wrote, so a text typed by a guest never rides in a mail', () => {
    const figures = rsvpFiguresOf(STATS, ['Poisson', 'Végétarien'])

    expect(figures.meals).toEqual([
      { label: 'Poisson', count: 4 },
      { label: 'Végétarien', count: 2 },
    ])
  })

  it('leaves out a menu the host has since removed', () => {
    expect(rsvpFiguresOf(STATS, ['Végétarien']).meals).toEqual([{ label: 'Végétarien', count: 2 }])
  })

  it('has no field for the moments, nor for the places kept', () => {
    expect(Object.keys(rsvpFiguresOf(STATS, [])).sort()).toEqual([
      'dietCount',
      'maybe',
      'meals',
      'no',
      'noReplyHouseholds',
      'waitlist',
      'yes',
    ])
  })
})
