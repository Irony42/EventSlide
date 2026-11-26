import { describe, expect, it } from 'vitest'
import { absentNoteAuthorName } from './absentNote'

/** Who signs the word of a guest who cannot come: the first word of the reply's name, or nobody. */

describe('absentNoteAuthorName', () => {
  it.each([
    ['Léa Martin', 'Léa'],
    ['  Léa   Martin ', 'Léa'],
    ['Famille Martin', 'Famille'],
    ['Hugo', 'Hugo'],
    ['Zoé\tPetit', 'Zoé'],
    ['Jean-Pierre Durand', 'Jean-Pierre'],
    ['😀😀 Bis', '😀😀'],
  ])('signs %s with %s', (name, expected) => {
    expect(absentNoteAuthorName(name)?.value).toBe(expected)
  })

  it('cuts a long word at forty characters, by code point', () => {
    expect(absentNoteAuthorName('A'.repeat(55))?.value).toBe('A'.repeat(40))
    expect(absentNoteAuthorName('😀'.repeat(55))?.value).toBe('😀'.repeat(40))
  })

  it('signs nobody when there is no word to show', () => {
    expect(absentNoteAuthorName('')).toBeNull()
    expect(absentNoteAuthorName('   ')).toBeNull()
    expect(absentNoteAuthorName('​​')).toBeNull()
  })

  it('signs nobody when the word is longer than the display name allows', () => {
    expect(absentNoteAuthorName('A'.repeat(55), null, 41)).toBeNull()
  })

  it('signs a reply named as its household with the whole name, a person’s name with its first word', () => {
    expect(absentNoteAuthorName('Famille Martin', 'Famille Martin')?.value).toBe('Famille Martin')
    expect(absentNoteAuthorName(' famille  martin ', 'Famille Martin')?.value).toBe(
      'famille martin',
    )
    expect(absentNoteAuthorName('Paul Martin', 'Famille Martin')?.value).toBe('Paul')
  })
})
