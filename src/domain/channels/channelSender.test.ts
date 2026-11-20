import { asEventId } from '../shared/ids'
import { describe, expect, it } from 'vitest'

import { DisplayName } from '../guests/displayName'
import { DomainError } from '../shared/errors'
import { err } from '../shared/result'
import {
  anonymousIfInvalid,
  senderDisplayName,
  senderKeyMaterial,
  shouldRenameGuest,
} from './channelSender'

const name = (raw: string): DisplayName => {
  const parsed = DisplayName.create(raw)
  if (!parsed.ok) throw new Error('bad test name')
  return parsed.value
}

describe('senderKeyMaterial', () => {
  const sender = { ref: '42', displayName: null, isBot: false, isAnonymous: false }
  it('names the channel and the event', () => {
    expect(senderKeyMaterial('telegram', asEventId('e1'), sender)).toBe('telegram:e1:42')
  })

  it('differs from one event to the next for the same person, so no row links two events', () => {
    expect(senderKeyMaterial('telegram', asEventId('e1'), sender)).not.toBe(
      senderKeyMaterial('telegram', asEventId('e2'), sender),
    )
  })
})

describe('senderDisplayName', () => {
  it.each([
    ['Léa Martin', 'Léa M.'],
    ['Léa', 'Léa'],
    ['  Jean   Pierre  Dupont ', 'Jean D.'],
    ['léa martin', 'léa M.'],
    ['édith éluard', 'édith É.'],
    ['🎉 Party', '🎉 P.'],
  ])('shows %j as %j', (raw, expected) => {
    expect(senderDisplayName(raw)?.value).toBe(expected)
  })

  it.each([null, '', '   ', '​'])('leaves %j anonymous', (raw) => {
    expect(senderDisplayName(raw)).toBeNull()
  })

  it('never exceeds the 40 characters of a display name', () => {
    const shown = senderDisplayName(`${'a'.repeat(100)} ${'b'.repeat(100)}`)
    expect([...(shown?.value ?? '')].length).toBe(40)
    expect(shown?.value.endsWith(' B.')).toBe(true)
  })

  it('falls back to anonymous, never to a refusal, when the domain refuses a name', () => {
    expect(anonymousIfInvalid(err(DomainError.invalid('displayName.tooLong')))).toBeNull()
    expect(anonymousIfInvalid({ ok: true, value: name('Léa') })?.value).toBe('Léa')
  })
})

describe('shouldRenameGuest', () => {
  it('renames to a new name, and names an anonymous guest', () => {
    expect(shouldRenameGuest(name('Léa M.'), name('Léa D.'))).toBe(true)
    expect(shouldRenameGuest(null, name('Léa'))).toBe(true)
  })

  it('leaves a guest alone when the name is unchanged', () => {
    expect(shouldRenameGuest(name('Léa M.'), name('Léa M.'))).toBe(false)
  })

  it('keeps the name a guest had when the channel shows none any more', () => {
    expect(shouldRenameGuest(name('Léa M.'), null)).toBe(false)
    expect(shouldRenameGuest(null, null)).toBe(false)
  })
})
