import { describe, expect, it } from 'vitest'
import { AnnouncementText } from './announcementText'

describe('AnnouncementText', () => {
  it('accepts eighty characters', () => {
    const result = AnnouncementText.create('x'.repeat(80))

    expect(result.ok && result.value.value).toBe('x'.repeat(80))
  })

  it('refuses eighty-one characters and says the limit', () => {
    const result = AnnouncementText.create('x'.repeat(81))

    expect(!result.ok && result.error.code).toBe('announcement.textInvalid')
    expect(!result.ok && result.error.details).toEqual({ max: 80 })
  })

  it('counts characters, not UTF-16 units', () => {
    // Eighty emoji are 160 units and still eighty characters.
    expect(AnnouncementText.create('🎂'.repeat(80)).ok).toBe(true)
    expect(AnnouncementText.create('🎂'.repeat(81)).ok).toBe(false)
  })

  it('refuses an empty text, a blank one and a value that is not a string', () => {
    for (const raw of ['', '   ', '​\u0007', 12, null, undefined]) {
      const result = AnnouncementText.create(raw)
      expect(!result.ok && result.error.code).toBe('announcement.textInvalid')
    }
  })

  it('folds the text to one line and strips control characters', () => {
    const result = AnnouncementText.create('  Gâteau\n à \u0007 22 h  ')

    expect(result.ok && result.value.value).not.toMatch(/[\n\u0007]/)
    expect(result.ok && result.value.value.startsWith('Gâteau')).toBe(true)
  })

  it('does not count what is stripped against the limit', () => {
    const result = AnnouncementText.create(`${'x'.repeat(80)}\u0007\u0007`)

    expect(result.ok).toBe(true)
  })

  it('does not touch markup: React escapes it, nothing here writes HTML', () => {
    const result = AnnouncementText.create('3 < 4 <b>')

    expect(result.ok && result.value.value).toBe('3 < 4 <b>')
  })

  it('compares by value and prints as its text', () => {
    const a = AnnouncementText.create('Gâteau')
    const b = AnnouncementText.create('Gâteau')
    const c = AnnouncementText.create('Discours')
    if (!a.ok || !b.ok || !c.ok) throw new Error('fixture')

    expect(a.value.equals(b.value)).toBe(true)
    expect(a.value.equals(c.value)).toBe(false)
    expect(`${a.value}`).toBe('Gâteau')
    expect(AnnouncementText.maxLength).toBe(80)
  })
})
