import { describe, expect, it } from 'vitest'
import { joinHost } from './joinHost'

/**
 * The phone that cannot read the QR needs to know where to type the code, and the only
 * address the server vouches for is the one inside the join link.
 */
describe('joinHost', () => {
  it('gives the host of the join link, without scheme or path', () => {
    expect(joinHost('https://app.eventslide.fr/join/K7P2QX')).toBe('app.eventslide.fr')
  })

  it('keeps the port of a venue box, which is unreachable without it', () => {
    expect(joinHost('http://mini-pc.local:4300/join/K7P2QX')).toBe('mini-pc.local:4300')
  })

  it('drops the default port of the scheme', () => {
    expect(joinHost('https://photos.example:443/join/K7P2QX')).toBe('photos.example')
  })

  it('keeps the path prefix of a deployment mounted under one, without a trailing slash', () => {
    expect(joinHost('https://example.org/photos/join/K7P2QX')).toBe('example.org/photos')
    expect(joinHost('https://example.org/a/b/join/K7P2QX')).toBe('example.org/a/b')
  })

  it('keeps the brackets and the port of an IPv6 host', () => {
    expect(joinHost('http://[::1]:4300/join/K7P2QX')).toBe('[::1]:4300')
  })

  it.each(['', 'not a link', '/join/K7P2QX'])(
    'says nothing for %j rather than print it wrong',
    (url) => {
      expect(joinHost(url)).toBeNull()
    },
  )
})
