import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import { anRsvp, anRsvpStats, aRsvpSettings } from '../../testing/renderWithProviders'
import {
  answerTone,
  barLegend,
  barLine,
  barOf,
  countsOf,
  latestLine,
  latestOf,
  peopleCell,
  peopleDetail,
  peopleOf,
  repliesLabel,
  subline,
  tabsOf,
  unseenLabel,
  visibleRsvps,
  windowAction,
  yesDetail,
} from './rsvpList'

const text = fr.rsvp.list
/** A sentence as a reader sees it: the no-break spaces are spaces. */
const plain = (sentence: string): string => sentence.replaceAll(String.fromCodePoint(0x00a0), ' ')

const lea = anRsvp({ id: 'a', name: 'Léa Martin', answer: 'yes', adults: 2, kids: 1 })
const tom = anRsvp({ id: 'b', name: 'Tom', answer: 'maybe', adults: 1, kids: 0 })
const ana = anRsvp({ id: 'c', name: 'Ana', answer: 'no', adults: 1, kids: 0 })
const waiting = anRsvp({ id: 'd', name: 'Zoé', answer: 'waitlist' })

describe('the tabs and what each holds', () => {
  it('offers a "peut-être" tab only while "peut-être" is offered', () => {
    expect(tabsOf(true)).toEqual(['all', 'yes', 'maybe', 'no'])
    expect(tabsOf(false)).toEqual(['all', 'yes', 'no'])
  })

  it('counts each answer, a reply on the waiting list belonging to "all" alone', () => {
    expect(countsOf([lea, tom, ana, waiting])).toEqual({ all: 4, yes: 1, maybe: 1, no: 1 })
    expect(countsOf([])).toEqual({ all: 0, yes: 0, maybe: 0, no: 0 })
  })

  it('keeps the replies of a tab, in the order given', () => {
    expect(visibleRsvps([lea, tom, ana], 'all', '')).toEqual([lea, tom, ana])
    expect(visibleRsvps([lea, tom, ana], 'maybe', '')).toEqual([tom])
    expect(visibleRsvps([lea, tom, ana], 'no', '')).toEqual([ana])
  })

  it('searches the name, whatever the case and the spaces around, and a companion’s', () => {
    expect(visibleRsvps([lea, tom], 'all', '  mART ')).toEqual([lea])
    const withCompanion = anRsvp({
      id: 'e',
      name: 'Paul',
      details: { companions: ['Jeanne'], meals: [], answers: [], moments: [], showName: false },
    })
    expect(visibleRsvps([lea, withCompanion], 'all', 'jeanne')).toEqual([withCompanion])
  })

  it('applies the tab and the search together', () => {
    expect(visibleRsvps([lea, tom, ana], 'yes', 'tom')).toEqual([])
  })
})

describe('the people a reply brings', () => {
  it('brings nobody when the answer is no, adults and children otherwise', () => {
    expect(peopleOf(lea)).toBe(3)
    expect(peopleOf(ana)).toBe(0)
  })

  it('says the people column: the adults, with the children if any, nothing for a no', () => {
    expect(peopleCell(lea, text)).toBe('2 + 1 enf.')
    expect(peopleCell(tom, text)).toBe('1')
    expect(peopleCell(ana, text)).toBe(text.none)
  })

  it('says the detail: adults and children in their plural', () => {
    expect(peopleDetail(lea, text)).toBe('2 adultes, 1 enfant')
    expect(peopleDetail(tom, text)).toBe('1 adulte')
    expect(peopleDetail(anRsvp({ adults: 2, kids: 2 }), text)).toBe('2 adultes, 2 enfants')
  })
})

describe('the latest replies', () => {
  it('puts the newest first and stops at the count', () => {
    const old = anRsvp({ id: 'o', updatedAt: '2026-11-19T10:00:00.000Z' })
    const mid = anRsvp({ id: 'm', updatedAt: '2026-11-20T10:00:00.000Z' })
    const recent = anRsvp({ id: 'r', updatedAt: '2026-11-21T10:00:00.000Z' })

    expect(latestOf([old, recent, mid], 2).map((reply) => reply.id)).toEqual(['r', 'm'])
  })

  it('does not reorder what it was given', () => {
    const given = [anRsvp({ id: 'x', updatedAt: '2026-11-19T10:00:00.000Z' }), anRsvp({ id: 'y' })]

    latestOf(given, 5)

    expect(given.map((reply) => reply.id)).toEqual(['x', 'y'])
  })

  it('says each line by the answer, with how many when more than one come', () => {
    expect(latestLine(lea, text)).toBe('Léa Martin vient à 3')
    expect(latestLine(anRsvp({ name: 'Paul', adults: 1, kids: 0 }), text)).toBe('Paul vient')
    expect(latestLine(tom, text)).toBe('Tom viendra peut-être')
    expect(latestLine(ana, text)).toBe('Ana ne vient pas')
  })
})

describe('the bar', () => {
  const stats = anRsvpStats({
    yes: { responses: 2, people: 6, adults: 4, kids: 2 },
    maybe: { responses: 1, people: 3 },
    no: { responses: 1 },
  })

  it('draws the people who come, who might, and the replies that decline, as shares of the whole', () => {
    const bar = barOf(stats, true)

    expect(bar.map((segment) => [segment.kind, segment.value])).toEqual([
      ['yes', 6],
      ['maybe', 3],
      ['no', 1],
    ])
    expect(bar.map((segment) => segment.percent)).toEqual([60, 30, 10])
  })

  it('leaves the "peut-être" out when it is not offered', () => {
    const bar = barOf(stats, false)

    expect(bar.map((segment) => segment.kind)).toEqual(['yes', 'no'])
    expect(bar[0]?.percent).toBeCloseTo((6 / 7) * 100)
  })

  it('is empty, never full, with no reply', () => {
    expect(barOf(anRsvpStats(), true).map((segment) => segment.percent)).toEqual([0, 0, 0])
  })

  it('says the line over it, with the "peut-être" total only if they are asked', () => {
    expect(plain(barLine(stats, true, text))).toBe(
      '6 personnes attendues, jusqu’à 9 avec les « peut-être »',
    )
    expect(barLine(stats, false, text)).toBe('6 personnes attendues')
    expect(
      barLine(anRsvpStats({ yes: { responses: 1, people: 1, adults: 1, kids: 0 } }), false, text),
    ).toBe('1 personne attendue')
  })
})

describe('the words around the figures', () => {
  it('counts replies in their plural', () => {
    expect(repliesLabel(0, text)).toBe('0 réponses')
    expect(repliesLabel(1, text)).toBe('1 réponse')
    expect(repliesLabel(2, text)).toBe('2 réponses')
  })

  it('says the line under the title: replies, the deadline, whether they are closed', () => {
    expect(subline(3, null, false, text)).toBe('3 réponses')
    expect(subline(1, '1 décembre', false, text)).toBe('1 réponse · date limite le 1 décembre')
    expect(subline(2, '1 décembre', true, text)).toBe(
      '2 réponses · date limite le 1 décembre · réponses fermées',
    )
  })

  it('says what the "yes" tile says under its figure, with the children told apart or not', () => {
    const stats = anRsvpStats({ yes: { responses: 2, people: 5, adults: 3, kids: 2 } })

    expect(yesDetail(stats, true, text)).toBe('2 réponses · 3 adultes, 2 enfants')
    expect(yesDetail(stats, false, text)).toBe('2 réponses')
    expect(
      yesDetail(anRsvpStats({ yes: { responses: 1, people: 2, adults: 1, kids: 1 } }), true, text),
    ).toBe('1 réponse · 1 adulte, 1 enfant')
  })

  it('reads the badge of the menu out with its noun in the plural', () => {
    expect(unseenLabel(1, text)).toBe('1 nouvelle réponse')
    expect(unseenLabel(3, text)).toBe('3 nouvelles réponses')
  })

  it('gives each answer its tone, the waiting list none', () => {
    expect(answerTone('yes')).toBe('success')
    expect(answerTone('maybe')).toBe('warning')
    expect(answerTone('no')).toBe('danger')
    expect(answerTone('waitlist')).toBe('neutral')
  })
})

describe('what the window offers', () => {
  const NOW = Date.parse('2026-11-23T10:00:00.000Z')

  it('offers to close a window that is open, or full', () => {
    expect(windowAction(aRsvpSettings({ enabled: true, state: 'open' }), NOW)).toBe('close')
    expect(windowAction(aRsvpSettings({ enabled: true, state: 'full' }), NOW)).toBe('close')
  })

  it('offers to reopen what the host closed while the day it closes is ahead', () => {
    const closed = aRsvpSettings({
      enabled: true,
      state: 'closed',
      closedAt: '2026-11-22T10:00:00.000Z',
      closesAt: '2026-12-02T00:00:00.000Z',
    })

    expect(windowAction(closed, NOW)).toBe('reopen')
  })

  it('offers to reopen what the host closed when nothing says when it closes', () => {
    const closed = aRsvpSettings({
      enabled: true,
      state: 'closed',
      closedAt: '2026-11-22T10:00:00.000Z',
      closesAt: null,
    })

    expect(windowAction(closed, NOW)).toBe('reopen')
  })

  it('says the date must move when the host closed it and the day has gone by', () => {
    const closed = aRsvpSettings({
      enabled: true,
      state: 'closed',
      closedAt: '2026-11-01T10:00:00.000Z',
      closesAt: '2026-11-02T00:00:00.000Z',
    })

    expect(windowAction(closed, NOW)).toBe('moveDate')
  })

  it('says the date closed it when it is closed and the host did not', () => {
    const closed = aRsvpSettings({
      enabled: true,
      state: 'closed',
      closedAt: null,
      closesAt: '2026-11-02T00:00:00.000Z',
    })

    expect(windowAction(closed, NOW)).toBe('closedByDate')
  })

  it('treats the very instant it closes as gone by', () => {
    const closed = aRsvpSettings({
      enabled: true,
      state: 'closed',
      closedAt: '2026-11-22T10:00:00.000Z',
      closesAt: '2026-11-23T10:00:00.000Z',
    })

    expect(windowAction(closed, NOW)).toBe('moveDate')
  })
})

describe('the search ignores accents', () => {
  it('finds an accented name by its plain spelling, either way round', () => {
    const chloe = anRsvp({ id: 'c', name: 'Chloé Dupont' })

    expect(visibleRsvps([chloe, lea], 'all', 'chloe')).toEqual([chloe])
    expect(
      visibleRsvps([anRsvp({ id: 'z', name: 'Zoe' }), lea], 'all', 'zoé').map((r) => r.id),
    ).toEqual(['z'])
    expect(visibleRsvps([chloe], 'all', 'CHLOÉ')).toEqual([chloe])
  })
})

describe('the bar’s legend', () => {
  const stats = anRsvpStats({
    yes: { responses: 2, people: 6, adults: 4, kids: 2 },
    maybe: { responses: 1, people: 1 },
    no: { responses: 2 },
  })

  it('says each part in its unit: people for who comes and who might, replies for who declines', () => {
    expect(barLegend(stats, true, text).map((item) => plain(item.text))).toEqual([
      'Viennent : 6 personnes',
      'Peut-être : 1 personne',
      'Ne viennent pas : 2 réponses',
    ])
  })

  it('leaves the "peut-être" out when it is not offered', () => {
    expect(barLegend(stats, false, text).map((item) => item.kind)).toEqual(['yes', 'no'])
  })
})
