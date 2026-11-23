import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n/fr'
import { aGuestOwnRsvp, aGuestRsvpPage } from '../../testing/renderWithProviders'
import {
  forgetEditToken,
  ownReplyLink,
  readStoredEditToken,
  storeEditToken,
  takeEditTokenFromFragment,
} from './rsvpDevice'
import { EMPTY_DRAFT, bump, draftOf, inputOf, maxPeople } from './rsvpDraft'
import { deadlineLabel, firstNameOf, recapLine, recapLines } from './rsvpTexts'

const FORM = aGuestRsvpPage().form
const TOKEN = '7QX0M4TZ2KD9WB3H'
const text = fr.rsvp.guest

describe('what the device remembers of a reply', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('keeps one token per invitation, and nothing else', () => {
    storeEditToken(TOKEN, 'edit-a')
    storeEditToken('OTHERINVITE0000', 'edit-b')

    expect(readStoredEditToken(TOKEN)).toBe('edit-a')
    expect(readStoredEditToken('OTHERINVITE0000')).toBe('edit-b')
    expect(window.localStorage.getItem(`eventslide.rsvp.${TOKEN}`)).toBe('{"editToken":"edit-a"}')
  })

  it('forgets a token', () => {
    storeEditToken(TOKEN, 'edit-a')

    forgetEditToken(TOKEN)

    expect(readStoredEditToken(TOKEN)).toBeNull()
  })

  it.each([
    ['an empty memory', null],
    ['text that is not JSON', 'pas du json'],
    ['JSON that is not an object', '42'],
    ['null', 'null'],
    ['an object with no token', '{}'],
    ['a token that is not text', '{"editToken":7}'],
    ['an empty token', '{"editToken":""}'],
  ])('finds nothing in %s', (_name, stored) => {
    if (stored !== null) window.localStorage.setItem(`eventslide.rsvp.${TOKEN}`, stored)

    expect(readStoredEditToken(TOKEN)).toBeNull()
  })

  it('works with no storage at all: a private window throws on every access', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => storeEditToken(TOKEN, 'edit-a')).not.toThrow()
    expect(readStoredEditToken(TOKEN)).toBeNull()
    expect(() => forgetEditToken(TOKEN)).not.toThrow()
  })

  it('reads the token of a link’s fragment once, and removes the fragment from the address bar', () => {
    window.history.replaceState(null, '', `/i/${TOKEN}?x=1#r=abcdefgh12345678`)

    const taken = takeEditTokenFromFragment()

    expect(taken).toBe('abcdefgh12345678')
    expect(window.location.hash).toBe('')
    expect(window.location.pathname + window.location.search).toBe(`/i/${TOKEN}?x=1`)
    expect(takeEditTokenFromFragment()).toBeNull()
  })

  it('removes a fragment that holds no token too, and leaves another tool’s fragment alone', () => {
    window.history.replaceState(null, '', `/i/${TOKEN}#r=<script>`)
    expect(takeEditTokenFromFragment()).toBeNull()
    expect(window.location.hash).toBe('')

    window.history.replaceState(null, '', `/i/${TOKEN}#section`)
    expect(takeEditTokenFromFragment()).toBeNull()
    expect(window.location.hash).toBe('#section')
  })

  it('builds the private link with the token in the fragment, never in the path or the query', () => {
    const link = ownReplyLink('https://app.example', TOKEN, 'edit-token-123')

    expect(link).toBe(`https://app.example/i/${TOKEN}#r=edit-token-123`)
    expect(new URL(link).search).toBe('')
  })
})

describe('the guest’s form as data', () => {
  it('starts empty, with one adult', () => {
    expect(EMPTY_DRAFT).toMatchObject({ answer: null, name: '', adults: 1, kids: 0 })
  })

  it('is filled back from a reply, a waiting-list reply asking as a yes', () => {
    expect(draftOf(aGuestOwnRsvp({ diet: 'noix', message: 'Hâte' }))).toMatchObject({
      answer: 'yes',
      name: 'Léa Martin',
      adults: 2,
      kids: 1,
      diet: 'noix',
      message: 'Hâte',
    })
    expect(draftOf(aGuestOwnRsvp({ answer: 'waitlist' })).answer).toBe('yes')
    expect(draftOf(aGuestOwnRsvp({ answer: 'no', adults: 0, kids: 0 })).adults).toBe(1)
  })

  it('lets a party be as large as the host’s form says, or one adult when it asks nothing', () => {
    expect(maxPeople(FORM)).toBe(4)
    expect(maxPeople({ ...FORM, partySize: { enabled: false, max: 9 } })).toBe(1)
  })

  it('keeps the steppers inside the form: one adult at least, no negative child, the maximum in all', () => {
    const start = { ...EMPTY_DRAFT, adults: 1, kids: 0 }
    expect(bump(start, FORM, 'adults', -1)).toBe(start)
    expect(bump(start, FORM, 'kids', -1)).toBe(start)

    const full = { ...EMPTY_DRAFT, adults: 3, kids: 1 }
    expect(bump(full, FORM, 'adults', 1)).toBe(full)
    expect(bump(full, FORM, 'kids', 1)).toBe(full)
    expect(bump(full, FORM, 'adults', -1)).toMatchObject({ adults: 2, kids: 1 })
    expect(bump(start, FORM, 'kids', 1)).toMatchObject({ adults: 1, kids: 1 })
  })

  it('sends nothing before an answer is chosen', () => {
    expect(inputOf(EMPTY_DRAFT, FORM)).toBeNull()
  })

  it('sends a yes with what the form asks, and a blank optional field as null', () => {
    const input = inputOf(
      { answer: 'yes', name: 'Léa', adults: 2, kids: 1, diet: '  ', message: '' },
      FORM,
    )

    expect(input).toEqual({
      name: 'Léa',
      answer: 'yes',
      adults: 2,
      kids: 1,
      diet: null,
      message: null,
    })
  })

  it('sends a no with nobody and no diet, whatever was typed before the guest changed their mind', () => {
    const input = inputOf(
      { answer: 'no', name: 'Léa', adults: 3, kids: 1, diet: 'noix', message: 'Dommage' },
      FORM,
    )

    expect(input).toEqual({ name: 'Léa', answer: 'no', message: 'Dommage' })
  })

  it('does not send what the host’s form does not ask', () => {
    const draft = {
      answer: 'maybe' as const,
      name: 'Léa',
      adults: 3,
      kids: 2,
      diet: 'x',
      message: '',
    }

    expect(inputOf(draft, { ...FORM, partySize: { enabled: false, max: 4 }, diet: false })).toEqual(
      { name: 'Léa', answer: 'maybe', message: null },
    )
    expect(inputOf(draft, { ...FORM, kidsSeparate: false })).toEqual({
      name: 'Léa',
      answer: 'maybe',
      adults: 3,
      diet: 'x',
      message: null,
    })
  })
})

describe('the words of a reply', () => {
  it('greets by the first word of the name', () => {
    expect(firstNameOf('  Léa   Martin ')).toBe('Léa')
    expect(firstNameOf('')).toBe('')
  })

  it('writes a deadline day in the invitation’s language, whatever zone the reader is in', () => {
    expect(deadlineLabel('2026-12-01', 'fr')).toBe('1 décembre')
    expect(deadlineLabel('2026-12-01', 'en')).toMatch(/December 1|1 December/)
    expect(deadlineLabel('pas un jour', 'fr')).toBe('pas un jour')
  })

  it('says one line for each answer, with the people when the form counts them', () => {
    expect(recapLine(aGuestOwnRsvp(), FORM, text)).toBe('Vous venez · 3 personnes dont 1 enfant')
    expect(recapLine(aGuestOwnRsvp({ adults: 1, kids: 0 }), FORM, text)).toBe(
      'Vous venez · 1 personne',
    )
    expect(recapLine(aGuestOwnRsvp({ answer: 'maybe', kids: 0 }), FORM, text)).toBe(
      'Peut-être · 2 personnes',
    )
    expect(recapLine(aGuestOwnRsvp({ answer: 'no', adults: 0, kids: 0 }), FORM, text)).toBe(
      'Vous ne venez pas',
    )
    expect(
      recapLine(aGuestOwnRsvp(), { ...FORM, partySize: { enabled: false, max: 4 } }, text),
    ).toBe('Vous venez')
    expect(recapLine(aGuestOwnRsvp(), { ...FORM, kidsSeparate: false }, text)).toBe(
      'Vous venez · 3 personnes',
    )
  })

  it('adds the diet and the word the guest wrote, as plain text', () => {
    const lines = recapLines(
      aGuestOwnRsvp({ diet: 'sans gluten', message: '<b>À samedi</b>' }),
      FORM,
      text,
    )

    expect(lines).toEqual([
      'Vous venez · 3 personnes dont 1 enfant',
      'Régime : sans gluten',
      'Votre mot : <b>À samedi</b>',
    ])
    expect(recapLines(aGuestOwnRsvp(), FORM, text)).toHaveLength(1)
  })
})
