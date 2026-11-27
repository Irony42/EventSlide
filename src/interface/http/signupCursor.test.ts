import { describe, expect, it } from 'vitest'
import { decodeSignupCursor, encodeSignupCursor } from './signupCursor'

const AT = new Date('2026-12-01T10:00:00.123Z')

describe('the signup list cursor', () => {
  it('round-trips a position, to the millisecond', () => {
    const decoded = decodeSignupCursor(encodeSignupCursor({ at: AT, id: 'signup-1' }))

    expect(decoded).toEqual({ at: AT, id: 'signup-1' })
  })

  it('is opaque: neither the id nor the instant is readable in it', () => {
    const token = encodeSignupCursor({ at: AT, id: 'signup-1' })

    expect(token).not.toContain('signup-1')
    expect(token).not.toContain('2026')
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  const encodeRaw = (value: unknown): string =>
    Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

  it.each([
    ['text that is not base64 JSON', '%%%'],
    ['JSON that is not an object', encodeRaw('42')],
    ['null', encodeRaw('null')],
    ['an object with no position', encodeRaw({})],
    ['an instant that is not a string', encodeRaw({ at: 1, id: 'a' })],
    ['an id that is not a string', encodeRaw({ at: AT.toISOString(), id: 1 })],
    ['an instant that is not a date', encodeRaw({ at: 'tomorrow', id: 'a' })],
    [
      'an instant not written the way the server writes it',
      encodeRaw({ at: '2026-12-01', id: 'a' }),
    ],
    ['an id that is not an id', encodeRaw({ at: AT.toISOString(), id: 'a b@c' })],
    ['an empty id', encodeRaw({ at: AT.toISOString(), id: '' })],
  ])('refuses %s', (_name, raw) => {
    expect(decodeSignupCursor(raw)).toBeNull()
  })
})
