import { describe, expect, it } from 'vitest'
import { fr } from './fr'

/**
 * Pierre's French typography, held for what spec 29 added: a no-break space before `: ; ! ?` and
 * inside `« »`, never an ordinary space there (a line would end between the word and its sign).
 * Older strings are not asked: the rule is for the sentences of this feature, which `fr.guestInvite`
 * and the `guestInvite.*` error codes hold.
 */

const sentencesOf = (value: unknown, path: string): readonly [string, string][] => {
  if (typeof value === 'string') return [[path, value]]
  if (typeof value === 'function') return [[path, String(value('A', 'B'))]]
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => sentencesOf(child, `${path}.${key}`))
}

const SPEC_29: readonly [string, string][] = [
  ...sentencesOf(fr.guestInvite, 'guestInvite'),
  ...Object.entries(fr.errors)
    .filter(([code]) => code.startsWith('guestInvite.'))
    .map(([code, sentence]): [string, string] => [`errors.${code}`, sentence]),
]

describe('the French of the guest invitations', () => {
  it('has sentences to judge', () => {
    expect(SPEC_29.length).toBeGreaterThan(80)
  })

  it.each(SPEC_29)('%s has no ordinary space before : ; ! ? or inside « »', (_path, sentence) => {
    expect(sentence).not.toMatch(/ [:;!?]/)
    expect(sentence).not.toMatch(/« | »/)
  })

  it('does use the no-break space where the sign follows a word', () => {
    const joined = SPEC_29.map(([, sentence]) => sentence).join('\n')

    expect(joined).toContain(' :')
    expect(joined).toContain(' ;')
    expect(joined).toContain('« ')
    expect(joined).toContain(' »')
    expect(joined).toContain(' ?')
  })
})
