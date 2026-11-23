import { describe, expect, it } from 'vitest'
import { DEFAULT_RSVP_FORM, applyFormPatch, restoreRsvpForm, type RsvpForm } from './rsvpForm'
import { questionIdFromBytes } from './rsvpFormExtras'

let counter = 0
const mint = (): string => `0000000${(counter += 1)}`.slice(-8)
const patched = (patch: unknown, from: RsvpForm = DEFAULT_RSVP_FORM) =>
  applyFormPatch(from, patch, mint)
const code = (result: ReturnType<typeof patched>): string | undefined =>
  result.ok ? undefined : result.error.code

describe('questionIdFromBytes', () => {
  it('writes four bytes as eight lower-case hex characters, and ignores the rest', () => {
    expect(questionIdFromBytes(new Uint8Array([0, 15, 255, 16, 99]))).toBe('000fff10')
  })
})

describe('the companions switch', () => {
  it('is changed by a boolean and refused otherwise', () => {
    const on = patched({ companionNames: true })
    expect(on.ok && on.value.companionNames).toBe(true)
    expect(code(patched({ companionNames: 'yes' }))).toBe('rsvp.formInvalid')
  })
})

describe('the menus', () => {
  const meals = (value: unknown) => patched({ meals: value })

  it('takes 2 to 6 labels when on, cleaned to one line, and keeps them when switched off', () => {
    const on = meals({ enabled: true, options: ['  Poisson ', 'Viande\n', 'Végé'] })
    expect(on.ok && on.value.meals).toEqual({
      enabled: true,
      options: ['Poisson', 'Viande', 'Végé'],
    })
    if (!on.ok) throw new Error('on')
    const off = patched({ meals: { enabled: false } }, on.value)
    expect(off.ok && off.value.meals).toEqual({
      enabled: false,
      options: ['Poisson', 'Viande', 'Végé'],
    })
    if (!off.ok) throw new Error('off')
    const again = patched({ meals: { enabled: true } }, off.value)
    expect(again.ok && again.value.meals.enabled).toBe(true)
  })

  it('keeps the switch of a menu that is on when only its options are sent', () => {
    const on = meals({ enabled: true, options: ['A', 'B'] })
    if (!on.ok) throw new Error('on')
    const reworded = patched({ meals: { options: ['C', 'D', 'E'] } }, on.value)
    expect(reworded.ok && reworded.value.meals).toEqual({
      enabled: true,
      options: ['C', 'D', 'E'],
    })
    expect(code(patched({ meals: { options: ['C'] } }, on.value))).toBe('rsvp.mealsInvalid')
  })

  it('accepts exactly 2 and exactly 6 options, and refuses 1 or 7 on a menu that is on', () => {
    const labels = (n: number) => Array.from({ length: n }, (_, i) => `M${i}`)
    expect(meals({ enabled: true, options: labels(2) }).ok).toBe(true)
    expect(meals({ enabled: true, options: labels(6) }).ok).toBe(true)
    expect(code(meals({ enabled: true, options: labels(1) }))).toBe('rsvp.mealsInvalid')
    expect(code(meals({ enabled: true, options: labels(7) }))).toBe('rsvp.mealsInvalid')
    expect(code(meals({ enabled: true }))).toBe('rsvp.mealsInvalid')
  })

  it('lets a switched-off menu hold a draft of 0 to 6 options', () => {
    expect(meals({ enabled: false, options: ['Seul'] }).ok).toBe(true)
    expect(meals({ enabled: false, options: [] }).ok).toBe(true)
  })

  it('accepts a label of 40 characters and refuses 41, an empty one, a number', () => {
    expect(meals({ enabled: true, options: ['x'.repeat(40), 'b'] }).ok).toBe(true)
    for (const bad of ['x'.repeat(41), '  ', 4, null]) {
      expect(code(meals({ enabled: true, options: [bad, 'b'] }))).toBe('rsvp.mealsInvalid')
    }
  })

  it('counts a label in characters, not in UTF-16 units', () => {
    expect(meals({ enabled: true, options: ['🍕'.repeat(40), 'b'] }).ok).toBe(true)
  })

  it('refuses two labels that differ only by case', () => {
    expect(code(meals({ enabled: true, options: ['Poisson', 'poisson'] }))).toBe(
      'rsvp.mealsInvalid',
    )
  })

  it.each([
    ['not an object', 'x'],
    ['an unknown key', { enabled: true, options: ['a', 'b'], extra: 1 }],
    ['a switch that is not a boolean', { enabled: 'on' }],
    ['options that are not a list', { options: 'a' }],
  ])('refuses %s', (_name, value) => {
    expect(code(meals(value))).toBe('rsvp.mealsInvalid')
  })
})

describe('the questions', () => {
  const questions = (value: unknown, from?: RsvpForm) => patched({ questions: value }, from)

  it('gives a new question a stable id and keeps an existing one under a new label', () => {
    const first = questions([{ label: ' Un chant ? ', kind: 'text' }])
    if (!first.ok) throw new Error('first')
    const id = first.value.questions[0]?.id
    expect(id).toMatch(/^[0-9a-f]{8}$/)

    const renamed = questions([{ id, label: 'Votre chanson ?', kind: 'text' }], first.value)
    expect(renamed.ok && renamed.value.questions).toEqual([
      { id, label: 'Votre chanson ?', kind: 'text' },
    ])
  })

  it('takes a choice with 2 to 6 options and a text with none', () => {
    const result = questions([
      { label: 'Voiture ?', kind: 'choice', options: ['Oui', 'Non'] },
      { label: 'Un mot', kind: 'text' },
    ])
    expect(result.ok && result.value.questions.map((q) => q.kind)).toEqual(['choice', 'text'])
    expect(result.ok && result.value.questions[0]?.options).toEqual(['Oui', 'Non'])
    expect(result.ok && 'options' in (result.value.questions[1] ?? {})).toBe(false)
  })

  it('accepts three questions and refuses four', () => {
    const q = (i: number) => ({ label: `Q${i}`, kind: 'text' })
    expect(questions([q(1), q(2), q(3)]).ok).toBe(true)
    expect(code(questions([q(1), q(2), q(3), q(4)]))).toBe('rsvp.questionsInvalid')
    expect(questions([]).ok).toBe(true)
  })

  it('accepts a label of 80 characters and refuses 81 or an empty one', () => {
    expect(questions([{ label: 'x'.repeat(80), kind: 'text' }]).ok).toBe(true)
    for (const label of ['x'.repeat(81), ' ', 3, undefined]) {
      expect(code(questions([{ label, kind: 'text' }]))).toBe('rsvp.questionsInvalid')
    }
  })

  it('accepts 2 and 6 options of 40 characters and refuses 1, 7, 41, a duplicate', () => {
    const choice = (options: unknown) => questions([{ label: 'Q', kind: 'choice', options }])
    const many = (n: number) => Array.from({ length: n }, (_, i) => `o${i}`)
    expect(choice(many(2)).ok).toBe(true)
    expect(choice(many(6)).ok).toBe(true)
    expect(choice(['x'.repeat(40), 'y']).ok).toBe(true)
    for (const bad of [many(1), many(7), ['x'.repeat(41), 'y'], ['A', 'a'], undefined, 'ab']) {
      expect(code(choice(bad))).toBe('rsvp.questionsInvalid')
    }
  })

  it('refuses options on a text question and an unknown kind', () => {
    expect(code(questions([{ label: 'Q', kind: 'text', options: ['a', 'b'] }]))).toBe(
      'rsvp.questionsInvalid',
    )
    expect(code(questions([{ label: 'Q', kind: 'number' }]))).toBe('rsvp.questionsInvalid')
  })

  it('refuses an id that is not one of the current questions, and the same id twice', () => {
    const first = questions([{ label: 'A', kind: 'text' }])
    if (!first.ok) throw new Error('first')
    const id = first.value.questions[0]?.id
    expect(code(questions([{ id: 'deadbeef', label: 'A', kind: 'text' }]))).toBe(
      'rsvp.questionsInvalid',
    )
    expect(code(questions([{ id: 7, label: 'A', kind: 'text' }], first.value))).toBe(
      'rsvp.questionsInvalid',
    )
    expect(
      code(
        questions(
          [
            { id, label: 'A', kind: 'text' },
            { id, label: 'B', kind: 'text' },
          ],
          first.value,
        ),
      ),
    ).toBe('rsvp.questionsInvalid')
  })

  it.each([
    ['not a list', 'x'],
    ['an item that is not an object', ['x']],
    ['an unknown key', [{ label: 'A', kind: 'text', required: true }]],
  ])('refuses %s', (_name, value) => {
    expect(code(questions(value))).toBe('rsvp.questionsInvalid')
  })

  it('removes a question by leaving it out of the list', () => {
    const first = questions([{ label: 'A', kind: 'text' }])
    if (!first.ok) throw new Error('first')
    const removed = questions([], first.value)
    expect(removed.ok && removed.value.questions).toEqual([])
  })
})

describe('restoreRsvpForm, the lot 2 fields', () => {
  it('reads the companions, the menus and the questions back', () => {
    const form = restoreRsvpForm({
      companionNames: true,
      meals: { enabled: true, options: ['A', 'B'] },
      questions: [
        { id: 'abcdef01', label: 'Q1', kind: 'text' },
        { id: 'abcdef02', label: 'Q2', kind: 'choice', options: ['x', 'y'] },
      ],
    })

    expect(form.companionNames).toBe(true)
    expect(form.meals).toEqual({ enabled: true, options: ['A', 'B'] })
    expect(form.questions.map((q) => q.id)).toEqual(['abcdef01', 'abcdef02'])
  })

  it('never fails: a menu that does not hold is off, a question that does not hold is dropped', () => {
    expect(restoreRsvpForm({ meals: 'x' }).meals).toEqual(DEFAULT_RSVP_FORM.meals)
    expect(restoreRsvpForm({ meals: { enabled: true, options: ['A'] } }).meals).toEqual({
      enabled: false,
      options: ['A'],
    })
    expect(restoreRsvpForm({ meals: { enabled: true, options: 'A' } }).meals).toEqual(
      DEFAULT_RSVP_FORM.meals,
    )
    const q = (over: object) => ({ id: 'abcdef01', label: 'Q', kind: 'text', ...over })
    expect(
      restoreRsvpForm({
        questions: [
          'x',
          q({ id: 'nope' }),
          q({ label: '' }),
          q({ kind: 'number' }),
          q({ kind: 'choice', options: ['only'] }),
          q({}),
          q({ label: 'again' }),
        ],
      }).questions,
    ).toEqual([{ id: 'abcdef01', label: 'Q', kind: 'text' }])
    expect(restoreRsvpForm({ questions: 'x' }).questions).toEqual([])
  })

  it('keeps at most three questions', () => {
    const many = ['01', '02', '03', '04'].map((n) => ({
      id: `abcdef${n}`,
      label: n,
      kind: 'text',
    }))
    expect(restoreRsvpForm({ questions: many }).questions).toHaveLength(3)
  })
})
