import { describe, expect, it } from 'vitest'
import { proofOf, statsOf } from './rsvpStats'
import { aRsvp } from './testing/rsvpFixtures'

describe('statsOf', () => {
  it('is all zeros for no reply', () => {
    expect(statsOf([])).toEqual({
      yes: { responses: 0, people: 0, adults: 0, kids: 0 },
      maybe: { responses: 0, people: 0 },
      no: { responses: 0 },
      waitlist: { responses: 0, people: 0 },
      diets: [],
      meals: [],
    })
  })

  it('counts replies and people per answer, children apart from adults', () => {
    const stats = statsOf([
      aRsvp({ id: 'a', answer: 'yes', adults: 2, kids: 1 }),
      aRsvp({ id: 'b', answer: 'yes', adults: 1, kids: 0 }),
      aRsvp({ id: 'c', answer: 'maybe', adults: 2, kids: 2 }),
      aRsvp({ id: 'd', answer: 'no' }),
      aRsvp({ id: 'e', answer: 'waitlist', adults: 3, kids: 0 }),
    ])

    expect(stats.yes).toEqual({ responses: 2, people: 4, adults: 3, kids: 1 })
    expect(stats.maybe).toEqual({ responses: 1, people: 4 })
    expect(stats.no).toEqual({ responses: 1 })
    expect(stats.waitlist).toEqual({ responses: 1, people: 3 })
  })

  it('never counts the people of a "no" or of the waiting list among those who come', () => {
    const stats = statsOf([aRsvp({ answer: 'no', adults: 4 }), aRsvp({ answer: 'waitlist' })])

    expect(stats.yes.people).toBe(0)
  })

  it('lists the diets of those who come or may come, with their name, and never a "no"', () => {
    const stats = statsOf([
      aRsvp({ id: 'a', name: 'Léa', answer: 'yes', diet: 'sans gluten' }),
      aRsvp({ id: 'b', name: 'Hugo', answer: 'maybe', diet: 'noix' }),
      aRsvp({ id: 'c', name: 'Inès', answer: 'no', diet: 'oublié' }),
      aRsvp({ id: 'd', name: 'Zoé', answer: 'waitlist', diet: 'lait' }),
      aRsvp({ id: 'e', name: 'Max', answer: 'yes', diet: null }),
    ])

    expect(stats.diets).toEqual([
      { name: 'Léa', diet: 'sans gluten' },
      { name: 'Hugo', diet: 'noix' },
    ])
  })

  it('counts the menus of those who come, most chosen first, then by label', () => {
    const stats = statsOf([
      aRsvp({ id: 'a', details: { meals: ['Viande', 'Poisson'] } }),
      aRsvp({ id: 'b', details: { meals: ['Poisson', 'Poisson'] } }),
      aRsvp({ id: 'c', details: { meals: ['Agneau'] } }),
      aRsvp({ id: 'd', answer: 'maybe', details: { meals: ['Viande'] } }),
    ])

    expect(stats.meals).toEqual([
      { label: 'Poisson', count: 3 },
      { label: 'Agneau', count: 1 },
      { label: 'Viande', count: 1 },
    ])
  })
})

describe('proofOf', () => {
  const rsvps = [
    aRsvp({
      id: 'c',
      name: 'Inès Durand',
      adults: 2,
      kids: 1,
      details: { showName: true },
      createdAt: new Date('2026-11-23T10:00:00Z'),
    }),
    aRsvp({
      id: 'a',
      name: 'Léa Martin',
      details: { showName: true },
      createdAt: new Date('2026-11-22T10:00:00Z'),
    }),
    aRsvp({ id: 'b', name: 'Hugo Petit', createdAt: new Date('2026-11-22T11:00:00Z') }),
    aRsvp({
      id: 'd',
      name: 'Zoé',
      answer: 'maybe',
      details: { showName: true },
    }),
    aRsvp({
      id: 'e',
      name: 'Max',
      answer: 'no',
      details: { showName: true },
    }),
    aRsvp({
      id: 'f',
      name: 'Eva',
      answer: 'waitlist',
      details: { showName: true },
    }),
  ]

  it('shows nothing when the host chose nothing', () => {
    expect(proofOf(rsvps, 'off')).toBeNull()
  })

  it('counts the people who come and names nobody for "count"', () => {
    expect(proofOf(rsvps, 'count')).toEqual({ count: 5, names: [] })
  })

  it('names only guests who agreed, by first word, oldest reply first, never other answers', () => {
    expect(proofOf(rsvps, 'names')).toEqual({ count: 5, names: ['Léa', 'Inès'] })
  })

  it('names at most three, and breaks a tie on the reply by its id', () => {
    const at = new Date('2026-11-22T10:00:00Z')
    const many = ['d', 'a', 'c', 'b'].map((id) =>
      aRsvp({ id, name: `Invité-${id}`, details: { showName: true }, createdAt: at }),
    )

    expect(proofOf(many, 'names')).toEqual({
      count: 4,
      names: ['Invité-a', 'Invité-b', 'Invité-c'],
    })
  })

  it('counts zero when nobody comes', () => {
    expect(proofOf([aRsvp({ answer: 'no' })], 'names')).toEqual({ count: 0, names: [] })
  })
})
