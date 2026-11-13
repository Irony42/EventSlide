import { describe, expect, it } from 'vitest'
import {
  BOOK_SUBTITLE_MAX,
  BOOK_TITLE_MAX,
  parseBookSubtitle,
  parseBookTitle,
} from '../book/bookTitle'
import { ClientName } from '../clients/clientName'
import { EventName } from '../events/eventName'
import { MissionPrompt } from '../missions/missionPrompt'
import { Caption } from '../photos/caption'
import { AccountName } from '../users/accountName'

/**
 * BUG-29: every field counts its length in characters (code points), the way the guestbook does.
 * A letter followed by astral emoji fills the limit exactly in characters and twice over in UTF-16
 * units, so a field still counting units refuses the first and accepts neither.
 */
const WOMAN = String.fromCodePoint(0x1f469)
const filled = (max: number): string => `a${WOMAN.repeat(max - 1)}`

describe.each([
  ['Caption', Caption.maxLength, (raw: string) => Caption.create(raw).ok],
  ['ClientName', ClientName.maxLength, (raw: string) => ClientName.create(raw).ok],
  ['EventName', EventName.maxLength, (raw: string) => EventName.create(raw).ok],
  ['MissionPrompt', MissionPrompt.maxLength, (raw: string) => MissionPrompt.create(raw).ok],
  ['AccountName', AccountName.maxLength, (raw: string) => AccountName.create(raw).ok],
  ['book title', BOOK_TITLE_MAX, (raw: string) => parseBookTitle(raw).ok],
  ['book subtitle', BOOK_SUBTITLE_MAX, (raw: string) => parseBookSubtitle(raw).ok],
])('%s length is counted in characters (BUG-29)', (_name, max, accepts) => {
  it('accepts exactly the maximum in astral characters', () => {
    expect(accepts(filled(max))).toBe(true)
  })

  it('refuses one character more', () => {
    expect(accepts(`${filled(max)}${WOMAN}`)).toBe(false)
  })
})
