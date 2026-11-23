import { describe, expect, it } from 'vitest'
import type { RsvpFormView } from '../../../application/usecases/guestRsvps/getRsvpForm'
import type { RsvpList } from '../../../application/usecases/guestRsvps/listRsvps'
import { DEFAULT_RSVP_FORM } from '../../../domain/guestRsvps/rsvpForm'
import { DEFAULT_RSVP_SETTINGS } from '../../../domain/guestRsvps/rsvpSettings'
import { statsOf } from '../../../domain/guestRsvps/rsvpStats'
import { aRsvp } from '../../../domain/guestRsvps/testing/rsvpFixtures'
import { anEvent } from '../../../application/testing/builders'
import { toRsvpDto, toRsvpFormResponseDto, toRsvpListResponseDto } from './rsvpPresenters'

/**
 * What the host's replies carry on the wire (spec 30). The lot 2 and 4 fields are not asked yet, so
 * the ring-4 routes never fill them: this is where a populated form and a populated reply are held,
 * so the shape is pinned the day a lot starts to fill them.
 */

const FORM = {
  ...DEFAULT_RSVP_FORM,
  companionNames: true,
  meals: { enabled: true, options: ['Viande', 'Poisson'] },
  questions: [
    { id: 'q1', label: 'Une allergie ?', kind: 'text' as const },
    { id: 'q2', label: 'Plutôt…', kind: 'choice' as const, options: ['Thé', 'Café'] },
  ],
  visibility: 'names' as const,
  capacity: 80,
  moments: [{ id: 'm1', label: 'Brunch' }],
}

const view = (invited: boolean): RsvpFormView => ({
  event: anEvent({}),
  invite: invited ? ({} as RsvpFormView['invite']) : null,
  settings: {
    ...DEFAULT_RSVP_SETTINGS,
    enabled: true,
    deadline: '2026-12-01',
    closedAt: new Date('2026-11-30T10:00:00Z'),
    form: FORM,
  },
  state: invited ? 'closed' : null,
  closesAt: invited ? new Date('2026-12-13T18:00:00Z') : null,
  erasedAt: invited ? new Date('2027-01-12T18:00:00Z') : null,
})

describe('toRsvpFormResponseDto', () => {
  it('carries the switch, the deadline, the closing, the window and every field of the form', () => {
    expect(toRsvpFormResponseDto(view(true))).toEqual({
      rsvpForm: {
        invited: true,
        enabled: true,
        deadline: '2026-12-01',
        closedAt: '2026-11-30T10:00:00.000Z',
        form: {
          maybe: true,
          partySize: { enabled: true, max: 4 },
          kidsSeparate: true,
          diet: true,
          companionNames: true,
          meals: { enabled: true, options: ['Viande', 'Poisson'] },
          questions: [
            { id: 'q1', label: 'Une allergie ?', kind: 'text' },
            { id: 'q2', label: 'Plutôt…', kind: 'choice', options: ['Thé', 'Café'] },
          ],
          visibility: 'names',
          capacity: 80,
          moments: [{ id: 'm1', label: 'Brunch' }],
          absentNote: true,
        },
        state: 'closed',
        closesAt: '2026-12-13T18:00:00.000Z',
        erasedAt: '2027-01-12T18:00:00.000Z',
      },
    })
  })

  it('says there is no invitation, with no state and no date', () => {
    const { rsvpForm } = toRsvpFormResponseDto(view(false))

    expect(rsvpForm).toMatchObject({ invited: false, state: null, closesAt: null, erasedAt: null })
  })
})

describe('toRsvpDto', () => {
  it('carries the details a lot adds, and never the guest’s token digest', () => {
    const dto = toRsvpDto(
      aRsvp({
        id: 'r-1',
        answer: 'yes',
        adults: 2,
        kids: 1,
        diet: 'sans gluten',
        editTokenHash: 'a'.repeat(64),
        householdId: 'h-1',
        details: {
          companions: ['Tom'],
          meals: ['Viande'],
          answers: [{ questionId: 'q1', label: 'Une allergie ?', value: 'noix' }],
          moments: ['Brunch'],
          showName: true,
        },
      }),
    )

    expect(dto.details).toEqual({
      companions: ['Tom'],
      meals: ['Viande'],
      answers: [{ questionId: 'q1', label: 'Une allergie ?', value: 'noix' }],
      moments: ['Brunch'],
      showName: true,
    })
    expect(JSON.stringify(dto)).not.toContain('aaaaaaaa')
    expect(dto).not.toHaveProperty('householdId')
  })
})

describe('toRsvpListResponseDto', () => {
  it('carries the figures of the one function, the diets and the menus included', () => {
    const rsvps = [
      aRsvp({ id: 'r-1', name: 'Léa', diet: 'sans gluten', details: { meals: ['Viande'] } }),
      aRsvp({ id: 'r-2', name: 'Tom', answer: 'maybe', diet: 'végétarien' }),
    ]
    const list: RsvpList = { ...view(true), rsvps, stats: statsOf(rsvps), unseen: 2 }

    const dto = toRsvpListResponseDto(list)

    expect(dto.unseen).toBe(2)
    expect(dto.rsvps.map((rsvp) => rsvp.name)).toEqual(['Léa', 'Tom'])
    expect(dto.stats).toEqual(statsOf(rsvps))
    // A maybe's diet is not told to the caterer: the panel, the file and the list agree.
    expect(dto.stats.diets).toEqual([{ name: 'Léa', diet: 'sans gluten' }])
    expect(dto.stats.meals).toEqual([{ label: 'Viande', count: 1 }])
  })
})
