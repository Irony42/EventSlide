import { describe, expect, it } from 'vitest'
import { contentRange, parseByteRange, unsatisfiedRange } from './byteRange'

/**
 * The header a `<video>` sends before it will play anything.
 *
 * Every case here is one a real player produces: Chrome opens with `bytes=0-`, Safari
 * probes the tail with a suffix range, and a scrub lands on a closed range in the middle.
 */

const SIZE = 1_000

describe('parseByteRange', () => {
  it('serves the whole object when no range was asked for', () => {
    expect(parseByteRange(undefined, SIZE)).toEqual({ kind: 'whole' })
  })

  it('reads an open-ended range as everything from that byte on', () => {
    // What Chrome sends first, every time.
    expect(parseByteRange('bytes=0-', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 999 },
    })
  })

  it('reads a closed range, which is what a scrub produces', () => {
    expect(parseByteRange('bytes=200-499', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 200, end: 499 },
    })
  })

  it('reads a suffix range as the last bytes of the object', () => {
    // Safari probes the tail of an mp4 looking for the index.
    expect(parseByteRange('bytes=-100', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 900, end: 999 },
    })
  })

  it('clamps a suffix longer than the object rather than refusing it', () => {
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 999 },
    })
  })

  it('clamps a last byte past the end, as the specification requires', () => {
    expect(parseByteRange('bytes=900-5000', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 900, end: 999 },
    })
  })

  it('refuses a first byte past the end', () => {
    expect(parseByteRange('bytes=1000-', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('refuses a backwards range', () => {
    expect(parseByteRange('bytes=500-200', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('refuses a zero-length suffix, which names no bytes at all', () => {
    expect(parseByteRange('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('refuses any range against an empty object', () => {
    expect(parseByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('serves the whole object for a multi-range request rather than failing it', () => {
    // Allowed by RFC 9110, and what every player copes with. `multipart/byteranges` is a
    // body format with its own boundaries, for no benefit to anything this serves.
    expect(parseByteRange('bytes=0-99,200-299', SIZE)).toEqual({ kind: 'whole' })
  })

  it('serves the whole object for a unit this server does not speak', () => {
    expect(parseByteRange('items=0-10', SIZE)).toEqual({ kind: 'whole' })
  })

  it('serves the whole object for a header naming nothing', () => {
    expect(parseByteRange('bytes=-', SIZE)).toEqual({ kind: 'whole' })
  })

  it('ignores surrounding whitespace', () => {
    expect(parseByteRange('  bytes=0-9  ', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 9 },
    })
  })
})

describe('range headers', () => {
  it('states the served range and the whole size', () => {
    expect(contentRange({ start: 200, end: 499 }, SIZE)).toBe('bytes 200-499/1000')
  })

  it('states only the size when nothing could be served', () => {
    expect(unsatisfiedRange(SIZE)).toBe('bytes */1000')
  })
})
