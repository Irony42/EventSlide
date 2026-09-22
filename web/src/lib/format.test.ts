import { describe, expect, it } from 'vitest'
import { formatBytes, formatDateTime } from './format'

/**
 * What `formatBytes` substitutes for every ordinary space, so a figure never wraps away
 * from its unit. That substitution is this module's, and it is the only thing it does to
 * `Intl`'s output.
 */
const NBSP = String.fromCodePoint(0x00a0)
/**
 * CLDR's choice, not this module's: French groups thousands with a narrow no-break space
 * **and** uses one before the unit, where the other four use an ordinary space that the
 * substitution above then widens.
 */
const NARROW_NBSP = String.fromCodePoint(0x202f)

/**
 * Two questions, and this file used to answer only the first.
 *
 * The arithmetic — when a count is promoted, when a decimal is dropped, what a
 * nonsensical value reads as — is language-independent and is asserted in French, which
 * is this product's source language and the shortest way to write it down.
 *
 * The **conventions** are the second question, and the reason it is now asked at all:
 * these figures are interpolated into translated sentences (`admin.storageUsed`,
 * `admin.scheduleArmed`, `admin.lastSeen`), so a module pinned to `fr-FR` put "2,4 Mo"
 * inside a German sentence and `20/06/26` in front of a host reading English. Every case
 * below that names a language is about a reader rather than about the maths.
 */

describe('formatBytes', () => {
  it('reports a small count in octets, without a decimal', () => {
    // Rounded, not just left alone: a byte count that arrives computed rather than
    // counted — an average, a remaining-quota division — must not read "512,4 o",
    // because a fraction of an octet is not a thing a host can act on.
    expect(formatBytes(512, 'fr')).toBe(`512${NARROW_NBSP}o`)
    expect(formatBytes(512.4, 'fr')).toBe(`512${NARROW_NBSP}o`)
  })

  it('uses the French decimal comma', () => {
    expect(formatBytes(2_400_000, 'fr')).toBe(`2,4${NARROW_NBSP}Mo`)
  })

  it('drops a decimal that would read as zero', () => {
    expect(formatBytes(5_000_000_000, 'fr')).toBe(`5${NARROW_NBSP}Go`)
  })

  it('steps up at a thousand, not at 1024', () => {
    expect(formatBytes(1_000, 'fr')).toBe(`1${NARROW_NBSP}ko`)
    expect(formatBytes(999, 'fr')).toBe(`999${NARROW_NBSP}o`)
  })

  // "1000 ko" is a figure the reader has to convert in their head.
  it('carries to the next unit rather than printing a thousand of the smaller one', () => {
    expect(formatBytes(999_950, 'fr')).toBe(`1${NARROW_NBSP}Mo`)
  })

  it('stops at the largest unit it knows', () => {
    expect(formatBytes(3_000_000_000_000_000, 'fr')).toBe(`3${NARROW_NBSP}000${NARROW_NBSP}To`)
  })

  it('shows an empty album as zero rather than as nothing', () => {
    expect(formatBytes(0, 'fr')).toBe(`0${NARROW_NBSP}o`)
  })

  it('treats a nonsensical count as zero instead of showing negative storage', () => {
    expect(formatBytes(-1, 'fr')).toBe(`0${NARROW_NBSP}o`)
    expect(formatBytes(Number.NaN, 'fr')).toBe(`0${NARROW_NBSP}o`)
  })

  it('writes octets in French and bytes in the other four', () => {
    // The defect this parameter exists for. `Mo` and `Go` are French abbreviations for
    // *octets*; German, English, Spanish and Italian all write `MB` and `GB`, and the
    // sentence around this figure is translated — so a moderator reading the console in
    // German was shown "2,4 Mo von 5 Go verwendet".
    expect(formatBytes(2_400_000, 'de')).toBe(`2,4${NBSP}MB`)
    expect(formatBytes(2_400_000, 'en')).toBe(`2.4${NBSP}MB`)
    expect(formatBytes(2_400_000, 'es')).toBe(`2,4${NBSP}MB`)
    expect(formatBytes(2_400_000, 'it')).toBe(`2,4${NBSP}MB`)
  })

  it('separates its thousands the way each language does', () => {
    // A hand-built string cannot get this right, which is `lib/i18n/formatters.ts`'s
    // whole argument: a narrow no-break space in French, a full stop in German and
    // Italian, a comma in English.
    expect(formatBytes(3_000_000_000_000_000, 'de')).toBe(`3.000${NBSP}TB`)
    expect(formatBytes(3_000_000_000_000_000, 'en')).toBe(`3,000${NBSP}TB`)
  })
})

describe('formatDateTime', () => {
  it('formats an ISO instant as a short date and time', () => {
    // Asserted by shape, not by value: the runner's time zone is not the venue's, and
    // a test that hardcodes an hour fails when CI moves.
    expect(formatDateTime('2026-06-20T21:04:11.031Z', 'fr')).toMatch(
      /^\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}$/,
    )
  })

  it('puts the month where the reader expects it', () => {
    // The part that misleads rather than merely jars. `20/06/26` and `6/20/26` are the
    // same instant and opposite readings, and this string is interpolated into
    // `admin.scheduleArmed` — the line confirming when a host's event will open and close.
    //
    // Compared against each other rather than pinned to a literal, because the exact
    // pattern is ICU's to choose and it moves between Node versions; what must hold is
    // that the five do not all answer the same way.
    const instant = '2026-06-20T12:00:00.000Z'
    const french = formatDateTime(instant, 'fr')
    const english = formatDateTime(instant, 'en')

    expect(french).not.toBeNull()
    expect(english).not.toBeNull()
    expect(english).not.toBe(french)
    // English's short form leads with the month and uses a 12-hour clock.
    expect(english).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2},\s\d{1,2}:\d{2}\s?[AP]M$/u)
  })

  it('reports an unreadable value rather than rendering "Invalid Date"', () => {
    expect(formatDateTime('pas-une-date', 'fr')).toBeNull()
  })
})
