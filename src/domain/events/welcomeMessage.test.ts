import { describe, expect, it } from 'vitest'
import {
  normalizeWelcomeMessage,
  restoreWelcomeMessage,
  WELCOME_MAX_CHARS,
  WELCOME_MAX_LINES,
} from './welcomeMessage'

const RLO = String.fromCodePoint(0x202e)
const ZWSP = String.fromCodePoint(0x200b)
const emoji = String.fromCodePoint(0x1f389)

const value = (raw: unknown): string | null | undefined => {
  const result = normalizeWelcomeMessage(raw)
  return result.ok ? result.value : undefined
}
const code = (raw: unknown): string | undefined => {
  const result = normalizeWelcomeMessage(raw)
  return result.ok ? undefined : result.error.code
}

describe('normalizeWelcomeMessage', () => {
  it('reads null, blank and invisible-only text as "no message"', () => {
    expect(value(null)).toBeNull()
    expect(value('   \n  ')).toBeNull()
    expect(value(`${ZWSP}${RLO}`)).toBeNull()
  })

  it('refuses a value that is not a string', () => {
    expect(code(42)).toBe('eventSettings.welcomeInvalid')
  })

  it('accepts exactly the character ceiling and refuses one more', () => {
    expect(value('a'.repeat(WELCOME_MAX_CHARS))).toBe('a'.repeat(WELCOME_MAX_CHARS))
    expect(code('a'.repeat(WELCOME_MAX_CHARS + 1))).toBe('eventSettings.welcomeTooLong')
  })

  it('counts code points, so 200 double-width emoji fit', () => {
    expect(value(emoji.repeat(200))).toBe(emoji.repeat(200))
    expect(code(emoji.repeat(WELCOME_MAX_CHARS + 1))).toBe('eventSettings.welcomeTooLong')
  })

  it('accepts four lines and refuses a fifth with its own code', () => {
    expect(value('a\nb\nc\nd')).toBe('a\nb\nc\nd')
    expect(code('a\nb\nc\nd\ne')).toBe('eventSettings.welcomeTooManyLines')
    const result = normalizeWelcomeMessage('a\nb\nc\nd\ne')
    expect(!result.ok && result.error.details).toEqual({ maxLines: WELCOME_MAX_LINES })
  })

  it('does not spend a line on a blank one', () => {
    expect(value('a\n\n\nb\n\nc\n\nd')).toBe('a\nb\nc\nd')
  })

  it('removes bidirectional overrides and zero-width characters', () => {
    expect(value(`Bien${RLO}venue${ZWSP}`)).toBe('Bienvenue')
  })

  it('keeps markup, links and variables as the plain text they are', () => {
    expect(value('<b>{prenom}</b> https://x.fr')).toBe('<b>{prenom}</b> https://x.fr')
  })
})

describe('restoreWelcomeMessage', () => {
  it('reads an absent or non-string value as none', () => {
    expect(restoreWelcomeMessage(undefined)).toBeNull()
    expect(restoreWelcomeMessage(7)).toBeNull()
    expect(restoreWelcomeMessage(' ')).toBeNull()
  })

  it('keeps a text above the current ceiling, up to 2000, and never throws', () => {
    expect(restoreWelcomeMessage('a'.repeat(500))).toBe('a'.repeat(500))
    expect(restoreWelcomeMessage('a'.repeat(2_000))).toBe('a'.repeat(2_000))
    expect(restoreWelcomeMessage('a'.repeat(2_001))).toBeNull()
  })

  it('cleans what it keeps', () => {
    expect(restoreWelcomeMessage(` a${ZWSP}  b `)).toBe('a b')
  })
})
