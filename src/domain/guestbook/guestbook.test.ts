import { describe, expect, it } from 'vitest'
import { asEventId, asGuestId, asGuestbookEntryId, asUserId } from '../shared/ids'
import { GuestbookEntry } from './guestbookEntry'
import {
  allowsAnotherEntry,
  guestbookRefusalFor,
  MAX_ENTRIES_PER_EVENT,
  MAX_ENTRIES_PER_GUEST,
} from './guestbookLimits'
import { GuestbookText } from './guestbookText'
import { acceptsGuestbookEntries } from './guestbookWindow'

const text = (raw: string): GuestbookText => {
  const made = GuestbookText.create(raw)
  if (!made.ok) throw new Error(made.error.code)
  return made.value
}

const codeOf = (raw: unknown): string | null => {
  const made = GuestbookText.create(raw)
  return made.ok ? null : made.error.code
}

describe('GuestbookText', () => {
  it('keeps a plain message as written', () => {
    expect(text('Merci pour cette belle soirée !').value).toBe('Merci pour cette belle soirée !')
  })

  it('keeps line breaks but folds blank-line runs to one blank line', () => {
    expect(text('a\r\n\r\n\r\n\r\nb\nc').value).toBe('a\n\nb\nc')
  })

  it('drops invisible characters and folds runs of spaces and tabs', () => {
    expect(text('  bra​vo \t\t  tous  ').value).toBe('bravo tous')
  })

  it('treats U+2028 as a line break rather than deleting it', () => {
    expect(text('un deux').value).toBe('un\ndeux')
  })

  it('normalises to NFC so a combining accent is one character', () => {
    expect(text('é').value).toBe('é')
  })

  it('refuses a non-string', () => {
    expect(codeOf(42)).toBe('guestbook.invalid')
  })

  it('refuses a message that is nothing but invisible characters', () => {
    expect(codeOf(' ​‮ \n ')).toBe('guestbook.empty')
  })

  it('accepts 500 characters and refuses 501', () => {
    expect(codeOf('x'.repeat(500))).toBeNull()
    const refused = GuestbookText.create('x'.repeat(501))
    expect(!refused.ok && refused.error.code).toBe('guestbook.tooLong')
    expect(!refused.ok && refused.error.details).toEqual({ max: 500 })
  })

  it('counts an emoji as one character, not two UTF-16 units', () => {
    expect(codeOf('\u{1F389}'.repeat(500))).toBeNull()
    expect(codeOf('\u{1F389}'.repeat(501))).toBe('guestbook.tooLong')
    expect(text('\u{1F389}\u{1F389}').length).toBe(2)
  })

  it('accepts eight line breaks and refuses nine', () => {
    expect(codeOf(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n'))).toBeNull()
    expect(codeOf(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n'))).toBe(
      'guestbook.tooManyLines',
    )
  })

  it('compares by value', () => {
    expect(text('a').equals(text('a'))).toBe(true)
    expect(text('a').equals(text('b'))).toBe(false)
    expect(String(text('a'))).toBe('a')
  })
})

describe('allowsAnotherEntry and guestbookRefusalFor', () => {
  it('accepts the last place and refuses the next one', () => {
    expect(allowsAnotherEntry(3, 2)).toBe(true)
    expect(allowsAnotherEntry(3, 3)).toBe(false)
  })

  it('refuses a guest who already holds three messages', () => {
    expect(guestbookRefusalFor({ heldByGuest: MAX_ENTRIES_PER_GUEST - 1, openInEvent: 0 })).toBeNull()
    expect(guestbookRefusalFor({ heldByGuest: MAX_ENTRIES_PER_GUEST, openInEvent: 0 })).toBe(
      'guestLimit',
    )
  })

  it('refuses when the book already holds 500 open messages', () => {
    expect(guestbookRefusalFor({ heldByGuest: 0, openInEvent: MAX_ENTRIES_PER_EVENT - 1 })).toBeNull()
    expect(guestbookRefusalFor({ heldByGuest: 0, openInEvent: MAX_ENTRIES_PER_EVENT })).toBe(
      'eventFull',
    )
  })

  it('names the guest limit before the book being full', () => {
    expect(guestbookRefusalFor({ heldByGuest: 3, openInEvent: 500 })).toBe('guestLimit')
  })
})

describe('acceptsGuestbookEntries', () => {
  const closedAt = new Date('2026-06-20T23:00:00Z')
  const at = (days: number, extraMs = 0): Date =>
    new Date(closedAt.getTime() + days * 86_400_000 + extraMs)

  it('accepts while the event is live', () => {
    expect(acceptsGuestbookEntries({ status: 'live', closedAt: null }, closedAt)).toBe(true)
  })

  it('accepts on a closed event for seven days and not a millisecond longer', () => {
    expect(acceptsGuestbookEntries({ status: 'closed', closedAt }, at(7, -1))).toBe(true)
    expect(acceptsGuestbookEntries({ status: 'closed', closedAt }, at(7))).toBe(false)
  })

  it('refuses a closed event whose closing instant is unknown', () => {
    expect(acceptsGuestbookEntries({ status: 'closed', closedAt: null }, closedAt)).toBe(false)
  })

  it.each(['draft', 'archived'] as const)('refuses a %s event', (status) => {
    expect(acceptsGuestbookEntries({ status, closedAt: null }, closedAt)).toBe(false)
  })
})

describe('GuestbookEntry', () => {
  const now = new Date('2026-06-20T21:00:00Z')
  const input = {
    eventId: asEventId('evt'),
    guestId: asGuestId('guest-a'),
    text: text('Bravo'),
  }
  const id = asGuestbookEntryId('g1')
  const host = { kind: 'host', userId: asUserId('host') } as const
  const settings = { allowGuestSelfDelete: true, guestSelfDeleteGraceMs: 60_000 }
  const mine = { kind: 'guest', guestId: asGuestId('guest-a') } as const

  it('starts pending on a moderated event, with no decision recorded', () => {
    const entry = GuestbookEntry.create(input, id, now, 'manual')
    expect(entry.status).toBe('pending')
    expect(entry.review).toBeNull()
  })

  it('starts published on an auto event, as an automatic decision', () => {
    const entry = GuestbookEntry.create(input, id, now, 'auto')
    expect(entry.status).toBe('published')
    expect(entry.review).toEqual({ kind: 'automatic', at: now })
  })

  it('moves through the photograph machine and records who decided', () => {
    const pending = GuestbookEntry.create(input, id, now, 'manual')
    const published = pending.publish(host, now)
    expect(published.ok && published.value.status).toBe('published')
    const hidden = published.ok ? published.value.hide(host, now) : published
    expect(hidden.ok && hidden.value.status).toBe('hidden')
    const rejected = hidden.ok ? hidden.value.reject(host, now) : hidden
    expect(rejected.ok && rejected.value.status).toBe('rejected')
    expect(rejected.ok && rejected.value.review).toEqual({ ...host, at: now })
  })

  it('refuses a move the machine does not allow', () => {
    const pending = GuestbookEntry.create(input, id, now, 'manual')
    const refused = pending.hide(host, now)
    expect(!refused.ok && refused.error.code).toBe('guestbook.illegalTransition')
  })

  it('exposes what it was built from', () => {
    const entry = GuestbookEntry.create(input, id, now, 'manual')
    expect(entry.id).toBe(id)
    expect(entry.eventId).toBe(input.eventId)
    expect(entry.guestId).toBe(input.guestId)
    expect(entry.text).toBe(input.text)
    expect(entry.createdAt).toBe(now)
    expect(entry.takenDownAt).toBeNull()
    expect(GuestbookEntry.restore(entry.toProps()).id).toBe(id)
  })

  describe('deletionVerdict (the photograph rule, not a copy)', () => {
    const entry = GuestbookEntry.create(input, id, now, 'manual')
    const later = new Date(now.getTime() + 1_000)

    it('lets the author take back a pending message inside the window', () => {
      expect(entry.deletionVerdict(mine, later, settings)).toBe('allowed')
    })

    it('reports the host veto when self-delete is switched off', () => {
      expect(entry.deletionVerdict(mine, later, { ...settings, allowGuestSelfDelete: false })).toBe(
        'selfDeleteDisabled',
      )
    })

    it('forbids another guest', () => {
      const other = { kind: 'guest', guestId: asGuestId('guest-b') } as const
      expect(entry.deletionVerdict(other, later, settings)).toBe('forbidden')
    })

    it('forbids the author outside the window', () => {
      const tooLate = new Date(now.getTime() + 60_001)
      expect(entry.deletionVerdict(mine, tooLate, settings)).toBe('forbidden')
    })

    it('forbids the author once the message is published', () => {
      const published = entry.publish(host, now)
      expect(published.ok && published.value.deletionVerdict(mine, later, settings)).toBe('forbidden')
    })

    it('always lets the host, whatever the settings', () => {
      const published = entry.publish(host, now)
      const verdict =
        published.ok &&
        published.value.deletionVerdict(host, later, { ...settings, allowGuestSelfDelete: false })
      expect(verdict).toBe('allowed')
    })
  })
})
