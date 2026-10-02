import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES, DEFAULT_CLIENT_LOCALE, isClientLocale } from './clientLocale'

describe('isClientLocale', () => {
  it.each(CLIENT_LOCALES)('accepts %s, one of the five the catalogue CHECK admits', (locale) => {
    expect(isClientLocale(locale)).toBe(true)
  })

  it('refuses a tag the catalogue does not have', () => {
    expect(isClientLocale('pt')).toBe(false)
  })

  it('refuses a non-string, which is what a stored row or a JSON body can hand over', () => {
    expect(isClientLocale(42)).toBe(false)
  })
})

describe('DEFAULT_CLIENT_LOCALE', () => {
  it('is one of the five the catalogue CHECK admits', () => {
    expect(isClientLocale(DEFAULT_CLIENT_LOCALE)).toBe(true)
  })
})
