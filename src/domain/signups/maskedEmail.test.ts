import { describe, expect, it } from 'vitest'
import { EmailAddress } from '../users/emailAddress'
import { maskEmailAddress } from './maskedEmail'

const address = (raw: string): EmailAddress => {
  const parsed = EmailAddress.create(raw)
  if (!parsed.ok) throw new Error(`bad fixture ${raw}`)
  return parsed.value
}

describe('maskEmailAddress', () => {
  it('keeps the first character and the domain, and hides the rest of the local part', () => {
    expect(maskEmailAddress(address('lea.martin@gmail.com'))).toBe('l•••@gmail.com')
  })

  it('shows the same three dots for a one-character and a long local part', () => {
    expect(maskEmailAddress(address('a@example.org'))).toBe('a•••@example.org')
    expect(maskEmailAddress(address('a-very-long-local-part@example.org'))).toBe('a•••@example.org')
  })

  it('never contains the hidden characters', () => {
    expect(maskEmailAddress(address('secret@example.org'))).not.toContain('ecret')
  })

  it('uses the normalised (lower-case) form', () => {
    expect(maskEmailAddress(address('Lea@Example.ORG'))).toBe('l•••@example.org')
  })
})
