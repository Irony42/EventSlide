import { describe, expect, it } from 'vitest'
import { composeBook } from '../../domain/book/bookPlan'
import { OPTIONS, COUNTS, generateAlbum } from '../../domain/book/testing/bookFixtures'
import { bookOptionsSchema, bookPlanSchema } from './bookSchemas'

describe('bookOptionsSchema', () => {
  it('reads the options of a v2 book and nothing else', () => {
    expect(bookOptionsSchema.parse(OPTIONS)).toEqual(OPTIONS)
    expect(
      bookOptionsSchema.parse({ ...OPTIONS, selection: { kind: 'best', target: 200 } }),
    ).toMatchObject({ selection: { kind: 'best', target: 200 } })
  })

  it.each([
    ['a 3.14 layout', { layout: 'one' }],
    ['a target that is not one of the three', { selection: { kind: 'best', target: 61 } }],
    ['a selection with a stray key', { selection: { kind: 'all', target: 60 } }],
    ['an unknown style', { style: 'nuit' }],
    ['an empty zone', { timeZone: '' }],
    ['a zone of 65 characters', { timeZone: 'x'.repeat(65) }],
    ['an unknown key', { extra: 1 }],
  ])('refuses %s', (_name, extra) => {
    expect(bookOptionsSchema.safeParse({ ...OPTIONS, ...extra }).success).toBe(false)
  })

  it('refuses a v1 document, which the migration rewrites', () => {
    const {
      style: _s,
      selection: _l,
      includeGuestbook: _g,
      printVersion: _p,
      timeZone: _t,
      ...v1
    } = OPTIONS
    expect(bookOptionsSchema.safeParse({ ...v1, layout: 'four' }).success).toBe(false)
  })
})

describe('bookPlanSchema', () => {
  it('reads back, whole, the plan composeBook makes (JSON in the middle)', () => {
    for (const seed of [3, 9, 21, 40]) {
      const { photos, messages } = generateAlbum(seed)
      const plan = composeBook(
        { photos, messages, counts: { ...COUNTS, messages: messages.length } },
        { ...OPTIONS, includeGuestbook: true, style: 'magazine' },
      )

      const read = bookPlanSchema.parse(JSON.parse(JSON.stringify(plan)))

      expect(read).toEqual(plan)
    }
  })

  it('refuses a key the plan does not have, at any depth', () => {
    const { photos, messages } = generateAlbum(9)
    const plan = JSON.parse(
      JSON.stringify(composeBook({ photos, messages, counts: COUNTS }, OPTIONS)),
    ) as Record<string, unknown>
    expect(bookPlanSchema.safeParse({ ...plan, caption: 'x' }).success).toBe(false)
    const pages = plan['pages'] as Record<string, unknown>[]
    expect(
      bookPlanSchema.safeParse({ ...plan, pages: [{ ...pages[0], text: 'Léa' }] }).success,
    ).toBe(false)
  })
})
