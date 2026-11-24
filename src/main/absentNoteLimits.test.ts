import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUESTBOOK_TEXT_MAX_LENGTH } from '../domain/guestbook/guestbookText'
import { DisplayName } from '../domain/guests/displayName'

/**
 * The page bounds the word of those who cannot come (`web/src/lib/rsvp/absentNote.ts`) with the
 * server's own ceilings, counted in code points like it. A web file cannot import the domain, so this
 * reads it as text: a ceiling changed on one side and not the other fails here.
 */

const mirrored = readFileSync(
  join(__dirname, '..', '..', 'web', 'src', 'lib', 'rsvp', 'absentNote.ts'),
  'utf8',
)
const constant = (name: string): number =>
  Number(new RegExp(String.raw`export const ${name} = (\d+)`).exec(mirrored)?.[1])

describe('the limits the page mirrors for the word of those who cannot come', () => {
  it('are the guestbook’s message ceiling and a display name’s', () => {
    expect(constant('ABSENT_NOTE_MAX_CHARS')).toBe(GUESTBOOK_TEXT_MAX_LENGTH)
    expect(constant('ABSENT_NOTE_SIGNATURE_MAX_CHARS')).toBe(DisplayName.maxLength)
  })
})
