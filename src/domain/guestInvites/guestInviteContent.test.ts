import { describe, expect, it } from 'vitest'
import type { Result } from '../shared/result'
import type { DomainError } from '../shared/errors'
import {
  applyContentPatch,
  restoreContent,
  type GuestInviteContent,
  type GuestInviteContentPatch,
} from './guestInviteContent'

const BLANK: GuestInviteContent = {
  title: null,
  startsAt: null,
  endsAt: null,
  timeZone: null,
  venueName: null,
  address: null,
  message: null,
  language: 'fr',
}

const START = '2026-12-13T18:00:00Z'
const WITH_DATE: GuestInviteContent = {
  ...BLANK,
  startsAt: new Date(START),
  timeZone: 'Europe/Paris',
}

const code = (result: Result<unknown, DomainError>): string | null =>
  result.ok ? null : result.error.code

const patched = (patch: GuestInviteContentPatch, from: GuestInviteContent = BLANK) =>
  applyContentPatch(from, patch)

describe('guest invitation content', () => {
  describe('title', () => {
    it('keeps eighty characters and refuses eighty-one', () => {
      expect(code(patched({ title: 'x'.repeat(80) }))).toBeNull()
      expect(code(patched({ title: 'x'.repeat(81) }))).toBe('guestInvite.titleTooLong')
    })

    it('counts a character a reader sees, not a UTF-16 unit', () => {
      expect(code(patched({ title: '🎉'.repeat(80) }))).toBeNull()
    })

    it('folds a pasted line break to a space and treats a blank title as none', () => {
      const made = patched({ title: '  Léa fête\nses 40 ans ' })
      expect(made.ok && made.value.title).toBe('Léa fête ses 40 ans')
      const cleared = patched({ title: '   ' }, { ...BLANK, title: 'Avant' })
      expect(cleared.ok && cleared.value.title).toBeNull()
    })

    it('refuses what is not text', () => {
      expect(code(patched({ title: 3 }))).toBe('guestInvite.titleInvalid')
    })
  })

  describe('place', () => {
    it('bounds the venue name at eighty characters on one line', () => {
      expect(code(patched({ venueName: 'x'.repeat(80) }))).toBeNull()
      expect(code(patched({ venueName: 'x'.repeat(81) }))).toBe('guestInvite.venueTooLong')
      expect(code(patched({ venueName: 4 }))).toBe('guestInvite.venueInvalid')
    })

    it('bounds the address at 160 characters and two lines', () => {
      expect(code(patched({ address: 'a\nb' }))).toBeNull()
      expect(code(patched({ address: 'a\nb\nc' }))).toBe('guestInvite.addressTooManyLines')
      expect(code(patched({ address: 'x'.repeat(160) }))).toBeNull()
      expect(code(patched({ address: 'x'.repeat(161) }))).toBe('guestInvite.addressTooLong')
      expect(code(patched({ address: {} }))).toBe('guestInvite.addressInvalid')
    })
  })

  describe('message', () => {
    it('bounds the word at 500 characters and eight lines', () => {
      expect(code(patched({ message: 'x'.repeat(500) }))).toBeNull()
      expect(code(patched({ message: 'x'.repeat(501) }))).toBe('guestInvite.messageTooLong')
      expect(code(patched({ message: 'a\n'.repeat(7) + 'a' }))).toBeNull()
      expect(code(patched({ message: 'a\n'.repeat(8) + 'a' }))).toBe(
        'guestInvite.messageTooManyLines',
      )
      expect(code(patched({ message: 1 }))).toBe('guestInvite.messageInvalid')
    })

    it('keeps a link as plain text: it is never turned into anything', () => {
      const made = patched({ message: 'Voir https://exemple.test <b>ici</b>' })
      expect(made.ok && made.value.message).toBe('Voir https://exemple.test <b>ici</b>')
    })

    it('clears the address and the word with null', () => {
      const made = patched(
        { address: null, message: null },
        { ...BLANK, address: 'a', message: 'b' },
      )
      expect(made.ok && made.value).toMatchObject({ address: null, message: null })
    })

    it('treats an empty word as none', () => {
      const made = patched({ message: ' \n ' }, { ...BLANK, message: 'Avant' })
      expect(made.ok && made.value.message).toBeNull()
    })
  })

  describe('moment', () => {
    it('reads an instant that carries its offset, and refuses a bare local time', () => {
      const made = patched({ startsAt: '2026-12-13T19:00:00+01:00', timeZone: 'Europe/Paris' })
      expect(made.ok && made.value.startsAt?.toISOString()).toBe('2026-12-13T18:00:00.000Z')
      expect(code(patched({ startsAt: '2026-12-13T19:00', timeZone: 'UTC' }))).toBe(
        'guestInvite.startsAtInvalid',
      )
      expect(code(patched({ startsAt: 12, timeZone: 'UTC' }))).toBe('guestInvite.startsAtInvalid')
      expect(code(patched({ startsAt: '2026-13-45T10:00:00Z', timeZone: 'UTC' }))).toBe(
        'guestInvite.startsAtInvalid',
      )
    })

    it('needs the zone a start is read in', () => {
      expect(code(patched({ startsAt: START }))).toBe('guestInvite.timeZoneRequired')
      expect(code(patched({ startsAt: START, timeZone: 'Europe/Paris' }))).toBeNull()
    })

    it('accepts UTC and refuses a zone the platform does not know', () => {
      expect(code(patched({ timeZone: 'UTC' }))).toBeNull()
      expect(code(patched({ timeZone: 'Mars/Olympus' }))).toBe('guestInvite.badTimeZone')
      expect(code(patched({ timeZone: 'x'.repeat(65) }))).toBe('guestInvite.badTimeZone')
      expect(code(patched({ timeZone: 5 }))).toBe('guestInvite.badTimeZone')
    })

    it('treats a blank zone as none', () => {
      const made = patched({ timeZone: '  ' }, { ...BLANK, timeZone: 'UTC' })
      expect(made.ok && made.value.timeZone).toBeNull()
    })

    it('clears a start with null', () => {
      const made = patched({ startsAt: null, timeZone: null }, WITH_DATE)
      expect(made.ok && made.value.startsAt).toBeNull()
    })

    it('puts the end strictly after the start', () => {
      expect(code(patched({ endsAt: START }, WITH_DATE))).toBe('guestInvite.endBeforeStart')
      expect(code(patched({ endsAt: '2026-12-13T17:00:00Z' }, WITH_DATE))).toBe(
        'guestInvite.endBeforeStart',
      )
      expect(code(patched({ endsAt: '2026-12-13T18:00:01Z' }, WITH_DATE))).toBeNull()
    })

    it('keeps the end within seven days of the start', () => {
      expect(code(patched({ endsAt: '2026-12-20T18:00:00Z' }, WITH_DATE))).toBeNull()
      expect(code(patched({ endsAt: '2026-12-20T18:00:01Z' }, WITH_DATE))).toBe(
        'guestInvite.tooLong',
      )
    })

    it('refuses an end with no start, and a badly written one', () => {
      expect(code(patched({ endsAt: START }))).toBe('guestInvite.endNeedsStart')
      expect(code(patched({ endsAt: 'tomorrow' }, WITH_DATE))).toBe('guestInvite.endsAtInvalid')
    })

    it('judges the end against the start of the same save', () => {
      const made = patched(
        { startsAt: '2026-12-14T18:00:00Z' },
        {
          ...WITH_DATE,
          endsAt: new Date('2026-12-13T22:00:00Z'),
        },
      )
      expect(code(made)).toBe('guestInvite.endBeforeStart')
    })
  })

  describe('language', () => {
    it('is one of the five', () => {
      const made = patched({ language: 'de' })
      expect(made.ok && made.value.language).toBe('de')
      expect(code(patched({ language: 'pt' }))).toBe('guestInvite.languageInvalid')
    })
  })

  it('leaves a field the save does not name as it was', () => {
    const made = patched({ message: 'Venez' }, { ...WITH_DATE, title: 'Fête' })
    expect(made.ok && made.value).toMatchObject({ title: 'Fête', message: 'Venez' })
    expect(made.ok && made.value.startsAt?.toISOString()).toBe('2026-12-13T18:00:00.000Z')
  })

  describe('restoreContent (the read path never fails)', () => {
    const RAW = {
      title: 'Fête',
      startsAt: START,
      endsAt: '2026-12-14T02:00:00Z',
      timeZone: 'Europe/Paris',
      venueName: 'Salle',
      address: 'Rue 1',
      message: 'Venez',
      language: 'it',
    }

    it('reads a healthy row as it is', () => {
      const content = restoreContent(RAW, 'fr')
      expect(content).toMatchObject({
        title: 'Fête',
        timeZone: 'Europe/Paris',
        venueName: 'Salle',
        address: 'Rue 1',
        message: 'Venez',
        language: 'it',
      })
      expect(content.endsAt?.toISOString()).toBe('2026-12-14T02:00:00.000Z')
    })

    it('drops a piece the rules refuse instead of failing, and falls back to the language given', () => {
      const content = restoreContent(
        {
          ...RAW,
          title: 'x'.repeat(500),
          message: 12,
          language: 'xx',
          venueName: undefined,
          address: undefined,
        },
        'de',
      )
      expect(content).toMatchObject({
        title: null,
        message: null,
        venueName: null,
        address: null,
        language: 'de',
      })
    })

    it('reads a column that is absent as no value', () => {
      const content = restoreContent({ ...RAW, title: undefined, message: undefined }, 'fr')
      expect(content).toMatchObject({ title: null, message: null })
    })

    it('drops the start, and the end with it, when the zone is lost', () => {
      const content = restoreContent({ ...RAW, timeZone: 'Mars/Olympus' }, 'fr')
      expect(content.timeZone).toBeNull()
      expect(content.startsAt).toBeNull()
      expect(content.endsAt).toBeNull()
    })

    it('drops an end that is not after the start or is too far from it', () => {
      expect(restoreContent({ ...RAW, endsAt: START }, 'fr').endsAt).toBeNull()
      expect(restoreContent({ ...RAW, endsAt: '2026-12-21T00:00:00Z' }, 'fr').endsAt).toBeNull()
      expect(restoreContent({ ...RAW, endsAt: 'soon' }, 'fr').endsAt).toBeNull()
      expect(restoreContent({ ...RAW, endsAt: null }, 'fr').endsAt).toBeNull()
    })

    it('drops a start that does not parse', () => {
      const content = restoreContent({ ...RAW, startsAt: 'later' }, 'fr')
      expect(content.startsAt).toBeNull()
      expect(content.endsAt).toBeNull()
    })
  })
})
