import { describe, expect, it } from 'vitest'
import { HOST_REASON_MAX, parseHostReason } from './hostReason'

describe('parseHostReason', () => {
  it('lets the reason be left out', () => {
    expect(parseHostReason(undefined)).toEqual({ ok: true, value: null })
    expect(parseHostReason('  \n \r\n ')).toEqual({ ok: true, value: null })
  })

  it('folds the text to clean lines: no blank line, no control character, no padding', () => {
    const parsed = parseHostReason('  Contenu signalé.\r\n\r\n\u0007 Contactez-nous.  ')

    expect(parsed).toEqual({ ok: true, value: 'Contenu signalé.\nContactez-nous.' })
  })

  it('accepts exactly the bound, counted in characters after the fold, and refuses one more', () => {
    expect(parseHostReason('a'.repeat(HOST_REASON_MAX)).ok).toBe(true)
    // An accented letter counts as one character.
    expect(parseHostReason('é'.repeat(HOST_REASON_MAX)).ok).toBe(true)
    const refused = parseHostReason('a'.repeat(HOST_REASON_MAX + 1))
    expect(!refused.ok && refused.error.code).toBe('takedown.hostReasonInvalid')
  })

  it('counts what is kept, not what was typed: the blank lines folded away do not use the bound', () => {
    const lines = Array.from({ length: 100 }, () => 'ab').join('\n\n\n')

    expect(parseHostReason(lines).ok).toBe(true)
  })
})
