import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EVENT_LANGUAGE,
  EVENT_LANGUAGES,
  isEventLanguage,
  type EventLanguage,
} from './eventLanguage'

/**
 * The vocabulary, and the guard that narrows into it. There is no rule here beyond
 * membership; what this file protects is the narrowing, which two untrusted paths depend
 * on — a settings blob an administrator can open in an editor, and a request body.
 */

describe('isEventLanguage', () => {
  it.each([...EVENT_LANGUAGES])('accepts %s', (language) => {
    expect(isEventLanguage(language)).toBe(true)
  })

  it('refuses a tag this build has no table for', () => {
    // The symptom of storing one: a projector quietly in French for eight hours while
    // the host's settings page shows the tag they chose.
    expect(isEventLanguage('pt')).toBe(false)
    expect(isEventLanguage('fr-CA')).toBe(false)
    expect(isEventLanguage('FR')).toBe(false)
  })

  it('refuses everything that is not a string', () => {
    // The caller is a `JSON.parse` result, so every shape has to take one path.
    expect(isEventLanguage(undefined)).toBe(false)
    expect(isEventLanguage(null)).toBe(false)
    expect(isEventLanguage(5)).toBe(false)
    expect(isEventLanguage(['fr'])).toBe(false)
    expect(isEventLanguage({ language: 'fr' })).toBe(false)
  })

  it('refuses a key it would inherit from Object rather than one it declares', () => {
    // `includes` rather than a lookup on an object — `messageForCode`'s `Object.hasOwn`
    // reason: `{"wallLanguage":"constructor"}` must not resolve to something truthy.
    expect(isEventLanguage('constructor')).toBe(false)
    expect(isEventLanguage('toString')).toBe(false)
  })
})

describe('the default', () => {
  it('is one of the five', () => {
    const fallback: EventLanguage = DEFAULT_EVENT_LANGUAGE
    expect(isEventLanguage(fallback)).toBe(true)
  })

  it('is French, which is what an event written before this field renders today', () => {
    // Stated rather than derived: `settingsOf` fills an absent key with this value, so
    // changing it is a decision about every event that has ever run on this box.
    expect(DEFAULT_EVENT_LANGUAGE).toBe('fr')
  })
})
