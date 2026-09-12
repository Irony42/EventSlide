import { describe, expect, it } from 'vitest'

import { DomainError } from './errors'
import {
  collect,
  collectAll,
  err,
  flatMap,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  type Result,
  unwrapOr,
} from './result'

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

describe('isOk', () => {
  it('recognises a success', () => {
    expect(isOk(ok(1))).toBe(true)
  })

  it('rejects a failure', () => {
    expect(isOk(failed('event.nameTooLong'))).toBe(false)
  })
})

describe('isErr', () => {
  it('recognises a failure', () => {
    expect(isErr(failed('event.nameTooLong'))).toBe(true)
  })

  it('rejects a success', () => {
    expect(isErr(ok(1))).toBe(false)
  })
})

describe('map', () => {
  it('transforms the value of a success', () => {
    const result = map(ok(21), (value) => value * 2)

    expect(result.ok && result.value).toBe(42)
  })

  it('returns the very same failure, untouched', () => {
    const failure = failed('event.nameTooLong')

    const result = map(failure, (value) => value * 2)

    expect(result).toBe(failure)
  })

  it('never runs the transform over a failure', () => {
    const result = map(failed('event.nameTooLong'), neverRuns)

    expect(result.ok).toBe(false)
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

describe('mapErr', () => {
  it('transforms the error of a failure', () => {
    const result = mapErr(failed('event.nameTooLong'), (error) => error.code)

    expect(!result.ok && result.error).toBe('event.nameTooLong')
  })

  it('returns the very same success, untouched', () => {
    const success = ok(42)

    const result = mapErr(success, neverRuns)

    expect(result).toBe(success)
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

describe('collect', () => {
  it('gathers every value, in order, when all succeed', () => {
    const result = collect([ok(1), ok(2), ok(3)])

    expect(result.ok && result.value).toEqual([1, 2, 3])
  })

  it('succeeds with an empty array for no results at all', () => {
    const result = collect([])

    expect(result.ok && result.value).toEqual([])
  })

  it('stops at the first failure instead of reporting the last', () => {
    const results = [ok(1), failed('event.nameTooLong'), failed('event.slugTaken')]

    const result = collect(results)

    expect(!result.ok && result.error.code).toBe('event.nameTooLong')
  })
})

describe('collectAll', () => {
  it('gathers every value, in order, when all succeed', () => {
    const result = collectAll([ok(1), ok(2), ok(3)])

    expect(result.ok && result.value).toEqual([1, 2, 3])
  })

  it('succeeds with an empty array for no results at all', () => {
    const result = collectAll([])

    expect(result.ok && result.value).toEqual([])
  })

  // A host correcting one form field at a time, discovering the next problem only
  // after saving, was the single most-reported annoyance of the 1.0 admin screens.
  it('reports every failure at once, not only the first', () => {
    const results = [failed('event.nameTooLong'), ok(1), failed('displayName.empty')]

    const result = collectAll(results)

    expect(!result.ok && result.error.map((error) => error.code)).toEqual([
      'event.nameTooLong',
      'displayName.empty',
    ])
  })

  // A partial success is not a success: nothing may hand a caller half a parsed form
  // and let it act on the half that worked.
  it('discards the values it did parse when any of them failed', () => {
    const result = collectAll([ok(1), failed('event.nameTooLong')])

    expect(result.ok).toBe(false)
    expect('value' in result).toBe(false)
  })
})
