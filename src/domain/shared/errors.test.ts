import { describe, expect, it } from 'vitest'

import { DomainError, type DomainErrorDetails, type DomainErrorKind } from './errors'

type Factory = (code: string, details?: DomainErrorDetails) => DomainError

/**
 * Every factory, paired with the kind it must produce. The kind is what the HTTP layer
 * turns into a status code, so a factory wired to the wrong one silently downgrades a
 * 403 to a 400 — a bug no route test would notice.
 */
const FACTORIES: readonly [DomainErrorKind, Factory][] = [
  ['invalid', DomainError.invalid],
  ['unauthenticated', DomainError.unauthenticated],
  ['forbidden', DomainError.forbidden],
  ['notFound', DomainError.notFound],
  ['conflict', DomainError.conflict],
  ['quotaExceeded', DomainError.quotaExceeded],
  ['rateLimited', DomainError.rateLimited],
  ['unexpected', DomainError.unexpected],
]

describe('DomainError factories', () => {
  it.each(FACTORIES)('%s builds an error of that kind', (kind, factory) => {
    const error = factory('event.nameTooLong')

    expect(error.kind).toBe(kind)
  })

  it.each(FACTORIES)('%s keeps the code verbatim', (_kind, factory) => {
    const error = factory('event.nameTooLong')

    expect(error.code).toBe('event.nameTooLong')
  })

  it.each(FACTORIES)('%s defaults details to an empty object', (_kind, factory) => {
    const error = factory('event.nameTooLong')

    expect(error.details).toEqual({})
  })

  it.each(FACTORIES)('%s preserves the details it is given', (_kind, factory) => {
    const error = factory('event.nameTooLong', { max: 120, field: 'name', fatal: false })

    expect(error.details).toEqual({ max: 120, field: 'name', fatal: false })
  })
})

describe('DomainError.is', () => {
  it('recognises a domain error', () => {
    expect(DomainError.is(DomainError.notFound('photo.notFound'))).toBe(true)
  })

  // The HTTP error middleware branches on this to decide between a mapped status and
  // an opaque 500, so anything that is merely error-shaped must not pass.
  it.each([
    ['a plain Error', new Error('boom')],
    ['a string', 'photo.notFound'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(DomainError.is(value)).toBe(false)
  })
})

describe('a DomainError instance', () => {
  it('is a real Error, so a stack trace survives into the logs', () => {
    const error = DomainError.conflict('event.slugTaken')

    expect(error).toBeInstanceOf(Error)
  })

  it('names itself DomainError', () => {
    const error = DomainError.conflict('event.slugTaken')

    expect(error.name).toBe('DomainError')
  })

  it('builds a log-readable message from the kind and the code', () => {
    const error = DomainError.conflict('event.slugTaken')

    expect(error.message).toBe('conflict: event.slugTaken')
  })
})
