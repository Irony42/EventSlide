import { describe, expect, it } from 'vitest'
import { formatBytes, formatDateTime } from './format'

/** The separator `formatBytes` uses, built the same way the module builds it. */
const NBSP = String.fromCodePoint(0x00a0)
/** What `fr-FR` grouping inserts between thousands. */
const NARROW_NBSP = String.fromCodePoint(0x202f)

describe('formatBytes', () => {
  it('reports a small count in octets, without a decimal', () => {
    // Rounded, not just left alone: a byte count that arrives computed rather than
    // counted — an average, a remaining-quota division — must not read "512,4 o",
    // because a fraction of an octet is not a thing a host can act on.
    expect(formatBytes(512)).toBe(`512${NBSP}o`)
    expect(formatBytes(512.4)).toBe(`512${NBSP}o`)
  })

  it('uses the French decimal comma', () => {
    expect(formatBytes(2_400_000)).toBe(`2,4${NBSP}Mo`)
  })

  it('drops a decimal that would read as zero', () => {
    expect(formatBytes(5_000_000_000)).toBe(`5${NBSP}Go`)
  })

  it('steps up at a thousand, not at 1024', () => {
    expect(formatBytes(1_000)).toBe(`1${NBSP}ko`)
    expect(formatBytes(999)).toBe(`999${NBSP}o`)
  })

  // "1000 ko" is a figure the reader has to convert in their head.
  it('carries to the next unit rather than printing a thousand of the smaller one', () => {
    expect(formatBytes(999_950)).toBe(`1${NBSP}Mo`)
  })

  it('stops at the largest unit it knows', () => {
    expect(formatBytes(3_000_000_000_000_000)).toBe(`3${NARROW_NBSP}000${NBSP}To`)
  })

  it('shows an empty album as zero rather than as nothing', () => {
    expect(formatBytes(0)).toBe(`0${NBSP}o`)
  })

  it('treats a nonsensical count as zero instead of showing negative storage', () => {
    expect(formatBytes(-1)).toBe(`0${NBSP}o`)
    expect(formatBytes(Number.NaN)).toBe(`0${NBSP}o`)
  })
})

describe('formatDateTime', () => {
  it('formats an ISO instant as a short French date and time', () => {
    // Asserted by shape, not by value: the runner's time zone is not the venue's, and
    // a test that hardcodes an hour fails when CI moves.
    expect(formatDateTime('2026-06-20T21:04:11.031Z')).toMatch(/^\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}$/)
  })

  it('reports an unreadable value rather than rendering "Invalid Date"', () => {
    expect(formatDateTime('pas-une-date')).toBeNull()
  })
})
