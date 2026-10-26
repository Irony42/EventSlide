import { describe, expect, it } from 'vitest'

import { DomainError } from './errors'
import { err, flatMap, ok, type Result, unwrapOr } from './result'

const failed = (code: string): Result<number, DomainError> => err(DomainError.invalid(code))

/**
 * A transform that must never run. Using it instead of a call counter means a
 * short-circuit that stops working fails the test at the point of the mistake.
 */
const neverRuns = (): never => {
  throw new Error('a transform ran on the branch it was supposed to skip')
}

describe('ok / err', () => {
  it('carries the value on success', () => {
    const result = ok(42)

    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('carries the error on failure', () => {
    const error = DomainError.invalid('event.nameTooLong')

    const result = err(error)

    expect(result).toEqual({ ok: false, error })
  })
})

describe('flatMap', () => {
  it('chains a second fallible step onto a success', () => {
    const result = flatMap(ok(2), (value) => ok(`${value} photos`))

    expect(result.ok && result.value).toBe('2 photos')
  })

  it('propagates the failure of the chained step', () => {
    const result = flatMap(ok(2), () => failed('event.quotaExceeded'))

    expect(!result.ok && result.error.code).toBe('event.quotaExceeded')
  })

  it('never runs the next step over a failure', () => {
    const failure = failed('event.nameTooLong')

    const result = flatMap(failure, neverRuns)

    expect(result).toBe(failure)
  })
})

describe('unwrapOr', () => {
  it('yields the value of a success', () => {
    expect(unwrapOr(ok(42), 0)).toBe(42)
  })

  it('yields the fallback for a failure', () => {
    expect(unwrapOr(failed('event.nameTooLong'), 0)).toBe(0)
  })
})
