import { describe, expect, it } from 'vitest'
import { isEventLogoUrl } from './brand'

const DIGEST = 'ab'.repeat(32)

describe('isEventLogoUrl', () => {
  it('accepts the path the server mints', () => {
    expect(isEventLogoUrl(`/api/events/camille-et-sacha/logo/${DIGEST}`)).toBe(true)
  })

  it.each([
    ['another origin', `https://evil.example/api/events/x-y/logo/${DIGEST}`],
    ['a protocol-relative URL', `//evil.example/api/events/x-y/logo/${DIGEST}`],
    ['a path traversal', `/api/events/../logo/${DIGEST}`],
    ['the venue photograph route', `/api/events/x-y/venue-photo/${DIGEST}`],
    ['a short digest', '/api/events/x-y/logo/abcd'],
    ['an upper-case digest', `/api/events/x-y/logo/${DIGEST.toUpperCase()}`],
    ['a trailing query', `/api/events/x-y/logo/${DIGEST}?x=1`],
    ['a javascript URL', 'javascript:alert(1)'],
    ['nothing', null],
    ['a number', 3],
  ])('refuses %s', (_name, value) => {
    expect(isEventLogoUrl(value)).toBe(false)
  })
})
