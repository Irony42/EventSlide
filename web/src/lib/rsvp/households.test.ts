import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import { aHousehold, anRsvp } from '../../testing/renderWithProviders'
import {
  fileableHouseholds,
  householdCounts,
  householdLink,
  mailtoUrl,
  pendingOf,
  placesOf,
  reminderMessage,
  smsUrl,
  visibleHouseholds,
  whatsappUrl,
} from './households'

const text = fr.rsvp.households

const martin = aHousehold({ id: 'h-1', name: 'Famille Martin', places: 4 })
const elodie = aHousehold({
  id: 'h-2',
  name: 'Élodie Roux',
  places: 2,
  reply: { id: 'r-2', answer: 'yes', people: 2 },
})
const durand = aHousehold({
  id: 'h-3',
  name: 'Les Durand',
  places: 3,
  reply: { id: 'r-3', answer: 'no', people: 0 },
})
const LIST = [martin, elodie, durand]

describe('the households of the guest list, as data', () => {
  it('says who has not answered: a household that said no has answered', () => {
    expect(pendingOf(LIST).map((household) => household.id)).toEqual(['h-1'])
    expect(householdCounts(LIST)).toEqual({ all: 3, pending: 1, answered: 2 })
    expect(householdCounts([])).toEqual({ all: 0, pending: 0, answered: 0 })
  })

  it('adds up the places kept', () => {
    expect(placesOf(LIST)).toBe(9)
    expect(placesOf([])).toBe(0)
  })

  it('filters by answer and searches without regard to case or accents, in the order given', () => {
    expect(visibleHouseholds(LIST, 'all', '').map((h) => h.id)).toEqual(['h-1', 'h-2', 'h-3'])
    expect(visibleHouseholds(LIST, 'pending', '').map((h) => h.id)).toEqual(['h-1'])
    expect(visibleHouseholds(LIST, 'answered', '').map((h) => h.id)).toEqual(['h-2', 'h-3'])
    expect(visibleHouseholds(LIST, 'all', ' ELODIE ').map((h) => h.id)).toEqual(['h-2'])
    expect(visibleHouseholds(LIST, 'pending', 'durand')).toEqual([])
  })
})

describe('householdLink', () => {
  it('puts the household’s secret in the fragment of the invitation’s address', () => {
    expect(householdLink('https://app.example/i/AAAA', martin)).toBe(
      'https://app.example/i/AAAA#f=7QX0M4TZ2KD9WB3H',
    )
  })

  it('has no link while the invitation has no address', () => {
    expect(householdLink(null, martin)).toBeNull()
  })
})

describe('the guided reminder', () => {
  const link = 'https://app.example/i/AAAA#f=7QX0M4TZ2KD9WB3H'

  it('writes a message with the household’s name, the party, the deadline and the link, in plain text', () => {
    const message = reminderMessage(
      martin,
      { title: 'Léa fête ses 40 ans', deadline: '1 décembre', link },
      text,
    )

    expect(message).toContain('Bonjour Famille Martin')
    expect(message).toContain('Léa fête ses 40 ans')
    expect(message).toContain('avant le 1 décembre')
    expect(message.endsWith(`\n${link}`)).toBe(true)
  })

  it('leaves the deadline and the link out when there are none', () => {
    const message = reminderMessage(martin, { title: 'Fête', deadline: null, link: null }, text)

    expect(message).not.toContain('avant le')
    expect(message).not.toContain('http')
  })

  it('opens the host’s own applications with the message ready and no recipient', () => {
    const message = 'Bonjour & à bientôt\nhttps://x.example/i/A#f=B'
    const encoded = encodeURIComponent(message)

    expect(whatsappUrl(message)).toBe(`https://wa.me/?text=${encoded}`)
    expect(smsUrl(message)).toBe(`sms:?&body=${encoded}`)
    // A mail link carries line breaks as CRLF (RFC 6068); the other two keep the message as it is.
    expect(mailtoUrl('Petit rappel', message)).toBe(
      `mailto:?subject=${encodeURIComponent('Petit rappel')}&body=${encodeURIComponent(message.replace('\n', '\r\n'))}`,
    )
    for (const url of [whatsappUrl(message), smsUrl(message), mailtoUrl('s', message)]) {
      // No number or address anywhere before the message: the host picks the contact.
      expect(url).toMatch(/^(https:\/\/wa\.me\/\?text=|sms:\?&body=|mailto:\?subject=)/)
    }
  })
})

describe('mailtoUrl line breaks', () => {
  it('writes every line break as CRLF, once: a CRLF is not doubled', () => {
    const url = mailtoUrl('s', 'a\nb\r\nc')

    expect(url.endsWith(`&body=${encodeURIComponent('a\r\nb\r\nc')}`)).toBe(true)
    expect(url).not.toMatch(/%0D%0D/)
  })
})

describe('fileableHouseholds', () => {
  it('offers the households with no reply, for a reply that is filed under none', () => {
    const free = anRsvp({ id: 'r-free', householdId: null })

    expect(fileableHouseholds(LIST, free).map((household) => household.id)).toEqual(['h-1'])
  })

  it('offers nothing for a reply that is already filed (it is detached first)', () => {
    expect(fileableHouseholds(LIST, anRsvp({ householdId: 'h-2' }))).toEqual([])
  })
})
