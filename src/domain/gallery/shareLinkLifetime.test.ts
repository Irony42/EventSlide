import { describe, expect, it } from 'vitest'
import {
  SHARE_LINK_DEFAULT_DAYS,
  SHARE_LINK_MAX_DAYS,
  SHARE_LINK_MIN_DAYS,
  ShareLinkLifetime,
} from './shareLinkLifetime'

const AT = new Date('2026-06-21T10:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const must = (days: unknown): ShareLinkLifetime => {
  const parsed = ShareLinkLifetime.create(days)
  if (!parsed.ok) throw new Error(`fixture lifetime refused: ${parsed.error.code}`)
  return parsed.value
}

describe('ShareLinkLifetime', () => {
  it('gives a host who chose nothing a month', () => {
    expect(must(undefined).days).toBe(30)
    expect(SHARE_LINK_DEFAULT_DAYS).toBe(30)
  })

  it('expires the link that many whole days after it was created', () => {
    expect(must(7).expiresAfter(AT)).toEqual(new Date(AT.getTime() + 7 * DAY))
  })

  it('accepts the shortest and the longest lifetime it advertises', () => {
    expect(must(SHARE_LINK_MIN_DAYS).days).toBe(1)
    expect(must(SHARE_LINK_MAX_DAYS).days).toBe(90)
  })

  it.each([
    ['zero days', 0],
    ['a negative lifetime', -3],
    ['one day past the ceiling', SHARE_LINK_MAX_DAYS + 1],
    ['a fraction of a day', 1.5],
    ['a number spelled as a string', '30'],
    ['null, which is not "the default"', null],
    ['infinity, which is "never expires" in disguise', Number.POSITIVE_INFINITY],
  ])('refuses %s, so a public link always ends', (_label, days) => {
    const parsed = ShareLinkLifetime.create(days)

    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error.code).toBe('shareLink.lifetimeInvalid')
    expect(!parsed.ok && parsed.error.details).toEqual({ min: 1, max: 90 })
  })
})
