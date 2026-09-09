import { describe, expect, it } from 'vitest'
import { ok } from '../shared/result'
import { canReact, nextAllowedAt, type ReactionBudget } from './reactionBudget'

const WINDOW_MS = 10_000

const budget = (overrides: Partial<ReactionBudget> = {}): ReactionBudget => ({
  recentCount: 0,
  windowMs: WINDOW_MS,
  maxPerWindow: 5,
  ...overrides,
})

describe('canReact', () => {
  it.each([
    { verdict: 'allows', recentCount: 0, allowed: true },
    { verdict: 'allows', recentCount: 4, allowed: true },
    { verdict: 'refuses', recentCount: 5, allowed: false },
    { verdict: 'refuses', recentCount: 6, allowed: false },
  ])(
    '$verdict one more when the guest has already sent $recentCount of an allowance of 5',
    ({ recentCount, allowed }) => {
      const result = canReact(budget({ recentCount }))

      expect(result).toEqual(ok(allowed))
    },
  )

  it('spends the whole allowance when it is the smallest one a budget may carry', () => {
    expect(canReact(budget({ recentCount: 0, maxPerWindow: 1 }))).toEqual(ok(true))
    expect(canReact(budget({ recentCount: 1, maxPerWindow: 1 }))).toEqual(ok(false))
  })

  it('accepts the shortest window a budget may carry', () => {
    expect(canReact(budget({ windowMs: 1 }))).toEqual(ok(true))
  })

  it.each([{ windowMs: 0 }, { windowMs: -1 }, { windowMs: 1.5 }])(
    'refuses a window of $windowMs, which is not a length of time',
    ({ windowMs }) => {
      const result = canReact(budget({ windowMs }))

      expect(result.ok).toBe(false)
      expect(!result.ok && result.error.code).toBe('reaction.windowInvalid')
    },
  )

  it('refuses an allowance of zero, because switching reactions off is an event setting', () => {
    const result = canReact(budget({ maxPerWindow: 0 }))

    expect(!result.ok && result.error.code).toBe('reaction.maxPerWindowInvalid')
  })

  it('refuses a fractional allowance', () => {
    const result = canReact(budget({ maxPerWindow: 2.5 }))

    expect(!result.ok && result.error.code).toBe('reaction.maxPerWindowInvalid')
  })

  it('refuses a negative count of recent reactions', () => {
    const result = canReact(budget({ recentCount: -1 }))

    expect(!result.ok && result.error.code).toBe('reaction.recentCountInvalid')
  })

  it('refuses a fractional count of recent reactions', () => {
    const result = canReact(budget({ recentCount: 1.5 }))

    expect(!result.ok && result.error.code).toBe('reaction.recentCountInvalid')
  })

  it('reports an incoherent budget as invalid input rather than a rate limit', () => {
    const result = canReact(budget({ maxPerWindow: 0 }))

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('nextAllowedAt', () => {
  it('frees the guest one window after their oldest recent reaction', () => {
    const oldest = new Date('2026-06-20T21:30:00.000Z')

    const result = nextAllowedAt(budget(), oldest)

    expect(result.ok && result.value.toISOString()).toBe('2026-06-20T21:30:10.000Z')
  })

  it('measures from the window the budget carries, not from a window of its own', () => {
    const oldest = new Date('2026-06-20T21:30:00.000Z')

    const result = nextAllowedAt(budget({ windowMs: 60_000 }), oldest)

    expect(result.ok && result.value.toISOString()).toBe('2026-06-20T21:31:00.000Z')
  })

  it('leaves the reaction it was measured from untouched', () => {
    const oldest = new Date('2026-06-20T21:30:00.000Z')

    nextAllowedAt(budget(), oldest)

    expect(oldest.toISOString()).toBe('2026-06-20T21:30:00.000Z')
  })

  it('refuses the same invalid window that canReact refuses', () => {
    const result = nextAllowedAt(budget({ windowMs: 0 }), new Date('2026-06-20T21:30:00.000Z'))

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('reaction.windowInvalid')
  })
})
