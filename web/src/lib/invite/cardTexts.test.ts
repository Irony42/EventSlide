import { describe, expect, it } from 'vitest'
import { SHORT_MESSAGE_MAX, readableLink, shortMessageOf } from './cardTexts'

describe('shortMessageOf', () => {
  it('has nothing to print for no word, or a blank one', () => {
    expect(shortMessageOf(null)).toBeNull()
    expect(shortMessageOf('  \n ')).toBeNull()
  })

  it('returns a word that fits as it is, line breaks folded to spaces', () => {
    expect(shortMessageOf('Apéro à 19 h,\ndîner à 20 h 30.')).toBe('Apéro à 19 h, dîner à 20 h 30.')
  })

  it('keeps a word of exactly 140 characters whole', () => {
    const word = 'x'.repeat(SHORT_MESSAGE_MAX)

    expect(shortMessageOf(word)).toBe(word)
  })

  it('cuts a longer one at a whole word, with an ellipsis, inside 140', () => {
    const word = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')

    const short = shortMessageOf(word)

    expect(short).not.toBeNull()
    expect([...(short ?? '')].length).toBeLessThanOrEqual(SHORT_MESSAGE_MAX)
    expect(short?.endsWith('…')).toBe(true)
    // Whole words only: what precedes the ellipsis is the beginning of the host's word, ending on a word.
    const kept = (short ?? '').slice(0, -1)
    expect(word.startsWith(kept)).toBe(true)
    expect(word.charAt(kept.length)).toBe(' ')
  })

  it('drops the comma or the dash that would end up before the ellipsis', () => {
    const word = `${'a'.repeat(130)}, ${'b'.repeat(30)}`

    expect(shortMessageOf(word)).toBe(`${'a'.repeat(130)}…`)
  })

  it('cuts a single word longer than the card at the limit, rather than print nothing', () => {
    const short = shortMessageOf('x'.repeat(300))

    expect([...(short ?? '')].length).toBe(SHORT_MESSAGE_MAX)
    expect(short?.endsWith('…')).toBe(true)
  })

  it('counts characters as a reader sees them: an emoji is one, and is never cut in two', () => {
    const word = '🎉'.repeat(200)

    const short = shortMessageOf(word)

    expect([...(short ?? '')]).toHaveLength(SHORT_MESSAGE_MAX)
    expect(short).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })

  it('takes the limit it is given', () => {
    expect(shortMessageOf('un deux trois quatre cinq six', 14)).toBe('un deux trois…')
  })
})

describe('readableLink', () => {
  it('is the host and the path, with no scheme', () => {
    expect(readableLink('https://app.eventslide.fr/i/7QX0M4TZ2KD9WB3H')).toBe(
      'app.eventslide.fr/i/7QX0M4TZ2KD9WB3H',
    )
  })

  it('keeps a port, and drops a trailing slash', () => {
    expect(readableLink('http://localhost:4300/i/ABC/')).toBe('localhost:4300/i/ABC')
  })

  it('returns what is not a URL as it came', () => {
    expect(readableLink('pas un lien')).toBe('pas un lien')
  })
})
