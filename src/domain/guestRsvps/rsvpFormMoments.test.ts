import { describe, expect, it } from 'vitest'
import { DEFAULT_RSVP_FORM, applyFormPatch, type RsvpForm } from './rsvpForm'
import {
  MOMENTS_MAX,
  applyMomentsPatch,
  momentsOfHousehold,
  parseHouseholdMoments,
  restoreHouseholdMoments,
  restoreMoments,
} from './rsvpFormMoments'

let counter = 0
const mint = (): string => `0000000${(counter += 1)}`.slice(-8)
const moments = (raw: unknown, current: RsvpForm['moments'] = []) =>
  applyMomentsPatch(current, raw, mint)
const code = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code

const BRUNCH = { id: 'aaaaaaaa', label: 'Brunch' }
const DINNER = { id: 'bbbbbbbb', label: 'Dîner' }
const BALL = { id: 'cccccccc', label: 'Bal' }
const FORM_MOMENTS = [BRUNCH, DINNER, BALL]

describe('applyMomentsPatch', () => {
  it('mints an id for a new moment, cleaned to one line, in the order sent', () => {
    const result = moments([{ label: '  Brunch\n' }, { label: 'Dîner' }])

    expect(result.ok && result.value.map((moment) => moment.label)).toEqual(['Brunch', 'Dîner'])
    expect(result.ok && new Set(result.value.map((moment) => moment.id)).size).toBe(2)
  })

  it('keeps the id of a moment that is renamed or moved, and refuses an id nobody knows', () => {
    const renamed = moments(
      [
        { id: DINNER.id, label: 'Grand dîner' },
        { id: BRUNCH.id, label: 'Brunch' },
      ],
      [BRUNCH, DINNER],
    )
    expect(renamed.ok && renamed.value).toEqual([{ id: DINNER.id, label: 'Grand dîner' }, BRUNCH])
    expect(code(moments([{ id: 'dddddddd', label: 'Ghost' }], [BRUNCH]))).toBe(
      'rsvp.momentsInvalid',
    )
  })

  it('accepts none, exactly four, and refuses five', () => {
    const labels = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `M${i}` }))
    expect(moments([]).ok).toBe(true)
    expect(moments(labels(MOMENTS_MAX)).ok).toBe(true)
    expect(code(moments(labels(MOMENTS_MAX + 1)))).toBe('rsvp.momentsInvalid')
  })

  it.each([
    ['not a list', 'x'],
    ['an item that is not an object', ['x']],
    ['an unknown key', [{ label: 'A', surprise: 1 }]],
    ['an empty label', [{ label: '   ' }]],
    ['a label that is not text', [{ label: 4 }]],
    ['a label of 41 characters', [{ label: 'x'.repeat(41) }]],
    ['two labels that differ by case', [{ label: 'Brunch' }, { label: 'BRUNCH' }]],
    [
      'the same id twice',
      [
        { id: BRUNCH.id, label: 'A' },
        { id: BRUNCH.id, label: 'B' },
      ],
    ],
    ['an id that is not text', [{ id: 4, label: 'A' }]],
  ])('refuses %s', (_name, raw) => {
    expect(code(moments(raw, [BRUNCH]))).toBe('rsvp.momentsInvalid')
  })

  it('accepts a label of exactly 40 characters', () => {
    expect(moments([{ label: 'x'.repeat(40) }]).ok).toBe(true)
  })

  it('is applied by the form patch, and an absent field leaves the moments as they were', () => {
    const set = applyFormPatch(DEFAULT_RSVP_FORM, { moments: [{ label: 'Brunch' }] }, mint)
    if (!set.ok) throw new Error('set')
    expect(set.value.moments).toHaveLength(1)
    const kept = applyFormPatch(set.value, { maybe: false }, mint)
    expect(kept.ok && kept.value.moments).toEqual(set.value.moments)
  })
})

describe('restoreMoments', () => {
  it('keeps the moments that hold, at most four, and drops bad ids, bad labels and doubles', () => {
    const raw = [
      BRUNCH,
      { id: 'zzzzzzzz', label: 'Bad id' },
      { id: 'dddddddd', label: '' },
      { id: 'eeeeeeee', label: 'brunch' },
      BRUNCH,
      'x',
      DINNER,
      BALL,
      { id: '11111111', label: 'Four' },
      { id: '22222222', label: 'Five' },
    ]

    expect(restoreMoments(raw)).toEqual([BRUNCH, DINNER, BALL, { id: '11111111', label: 'Four' }])
    expect(restoreMoments('x')).toEqual([])
  })
})

describe('momentsOfHousehold', () => {
  it('is all the form moments for null, and only the invited ones, in the form order, otherwise', () => {
    expect(momentsOfHousehold(FORM_MOMENTS, null)).toEqual(FORM_MOMENTS)
    expect(momentsOfHousehold(FORM_MOMENTS, [BALL.id, BRUNCH.id])).toEqual([BRUNCH, BALL])
  })

  it('loses a moment the form no longer has', () => {
    expect(momentsOfHousehold([BRUNCH], [BRUNCH.id, DINNER.id])).toEqual([BRUNCH])
    expect(momentsOfHousehold([], [DINNER.id])).toEqual([])
  })
})

describe('parseHouseholdMoments', () => {
  it('takes null as all, and a list of known ids in the form order', () => {
    expect(parseHouseholdMoments(null, FORM_MOMENTS)).toEqual({ ok: true, value: null })
    const some = parseHouseholdMoments([BALL.id, BRUNCH.id], FORM_MOMENTS)
    expect(some.ok && some.value).toEqual([BRUNCH.id, BALL.id])
  })

  it('stores every moment as null, so a moment added later reaches the household too', () => {
    const all = parseHouseholdMoments([BALL.id, DINNER.id, BRUNCH.id], FORM_MOMENTS)
    expect(all.ok && all.value).toBeNull()
  })

  it.each([
    ['an empty list', []],
    ['a moment the form does not have', ['dddddddd']],
    ['a double', [BRUNCH.id, BRUNCH.id]],
    ['something that is not an id', [4]],
    ['something that is not a list', 'x'],
    ['five ids', ['a', 'b', 'c', 'd', 'e']],
  ])('refuses %s', (_name, raw) => {
    expect(code(parseHouseholdMoments(raw, FORM_MOMENTS))).toBe('household.momentsInvalid')
  })

  it('refuses a list when the form has no moments, and accepts null', () => {
    expect(code(parseHouseholdMoments([BRUNCH.id], []))).toBe('household.momentsInvalid')
    expect(parseHouseholdMoments(null, []).ok).toBe(true)
  })
})

describe('restoreHouseholdMoments', () => {
  it('reads the ids that hold, once, and brings the rest back to "all"', () => {
    expect(restoreHouseholdMoments([BRUNCH.id, BRUNCH.id, 'bad', 4, DINNER.id])).toEqual([
      BRUNCH.id,
      DINNER.id,
    ])
    expect(restoreHouseholdMoments(['bad'])).toBeNull()
    expect(restoreHouseholdMoments('x')).toBeNull()
    expect(restoreHouseholdMoments(null)).toBeNull()
  })

  it('keeps at most four ids', () => {
    const ids = ['11111111', '22222222', '33333333', '44444444', '55555555']
    expect(restoreHouseholdMoments(ids)).toEqual(ids.slice(0, 4))
  })
})
