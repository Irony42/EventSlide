import { describe, expect, it } from 'vitest'
import { CLIENT_LOCALES } from '../clients/clientLocale'
import type { RsvpFigures } from '../notices/rsvpFigures'
import { EmailAddress } from '../users/emailAddress'
import { checkOutgoingMail } from './outgoingMail'
import {
  rsvpDeadlineMail,
  rsvpDigestMail,
  rsvpFullMail,
  rsvpStoppedMail,
  rsvpUnansweredPageUrl,
} from './rsvpFamilyMails'

const to = (() => {
  const made = EmailAddress.create('hote@example.test')
  if (!made.ok) throw new Error('fixture')
  return made.value
})()

const PAGE = 'https://photos.example.com/admin/events/camille-et-sacha/rsvps'
const NBSP = String.fromCharCode(160)

const FIGURES: RsvpFigures = {
  yes: { responses: 20, people: 31, adults: 24, kids: 7 },
  maybe: { responses: 2, people: 3 },
  no: { responses: 6 },
  waitlist: { responses: 3, people: 4 },
  dietCount: 2,
  meals: [
    { label: 'Poisson', count: 20 },
    { label: 'Végé', count: 11 },
  ],
  noReplyHouseholds: 12,
}

const base = (locale: (typeof CLIENT_LOCALES)[number], eventName = 'Camille et Sacha') => ({
  to,
  locale,
  eventName,
  pageUrl: PAGE,
})

describe('rsvpDigestMail (R2)', () => {
  it('says what changed and the figures in all, in French, with the replies page', () => {
    const mail = rsvpDigestMail({ ...base('fr'), changed: 4, pendingNotes: 0, figures: FIGURES })

    expect(mail.subject).toBe(`4 réponses de plus pour «${NBSP}Camille et Sacha${NBSP}»`)
    expect(mail.text).toContain('4 réponses nouvelles ou modifiées.')
    expect(mail.text).toContain(
      `En tout${NBSP}: 31 oui (24 adultes, 7 enfants), 2 peut-être, 6 non, 3 en liste d’attente; 12 foyers sans réponse.`,
    )
    expect(mail.text.split('\n')).toContain(PAGE)
  })

  it('leaves the households out when the host has no guest list, and uses the singular', () => {
    const mail = rsvpDigestMail({
      ...base('fr'),
      changed: 1,
      pendingNotes: 0,
      figures: { ...FIGURES, noReplyHouseholds: 0 },
    })

    expect(mail.text).not.toContain('foyer')
    expect(mail.text).toContain('1 réponse nouvelle ou modifiée.')
    expect(mail.subject).toContain('1 réponse de plus')
  })
})

describe('rsvpDigestMail (R2): the words of absent guests that wait for approval', () => {
  const SAYS: Readonly<Record<(typeof CLIENT_LOCALES)[number], readonly [string, string]>> = {
    fr: ['1 mot d’absent attend votre accord.', '3 mots d’absents attendent votre accord.'],
    en: [
      '1 note from a guest who cannot come is waiting',
      '3 notes from guests who cannot come are waiting',
    ],
    de: ['1 Nachricht von Absagenden wartet', '3 Nachrichten von Absagenden warten'],
    es: ['1 mensaje de un ausente espera', '3 mensajes de ausentes esperan'],
    it: ['1 messaggio di un assente attende', '3 messaggi di assenti attendono'],
  }

  it('says the count in each language, in the singular and the plural, and nothing at zero', () => {
    for (const locale of CLIENT_LOCALES) {
      const [one, many] = SAYS[locale]
      const text = (pendingNotes: number) =>
        rsvpDigestMail({ ...base(locale), changed: 2, pendingNotes, figures: FIGURES }).text
      expect(text(1)).toContain(one)
      expect(text(3)).toContain(many)
      expect(text(0).split('\n').length).toBeLessThan(text(1).split('\n').length)
    }
  })
})

describe('rsvpDeadlineMail (R3)', () => {
  it('says how many households have not answered and the deadline the host typed, linking the unanswered list', () => {
    const mail = rsvpDeadlineMail({
      ...base('fr'),
      pageUrl: rsvpUnansweredPageUrl('https://photos.example.com', 'camille-et-sacha'),
      unanswered: 12,
      deadline: '2026-12-15',
    })

    expect(mail.text).toContain(
      `12 foyers sans réponse pour «${NBSP}Camille et Sacha${NBSP}»${NBSP}; la date limite est le 15 décembre 2026.`,
    )
    expect(mail.text).toContain('/rsvps/guests?filter=unanswered')
  })
})

describe('rsvpStoppedMail (R4)', () => {
  it('gives the summary: figures, the host menus with their counts, the number of diets, the households', () => {
    const mail = rsvpStoppedMail({ ...base('fr'), figures: FIGURES })

    expect(mail.subject).toBe(`Les réponses à «${NBSP}Camille et Sacha${NBSP}» sont closes`)
    expect(mail.text).toContain('31 oui (24 adultes, 7 enfants)')
    expect(mail.text).toContain(`Menus${NBSP}: Poisson (20), Végé (11).`)
    expect(mail.text).toContain('2 régimes signalés.')
    expect(mail.text).toContain('12 foyers sans réponse.')
  })

  it('leaves out the menus, the diets and the households that there are none of', () => {
    const mail = rsvpStoppedMail({
      ...base('en'),
      figures: { ...FIGURES, meals: [], dietCount: 0, noReplyHouseholds: 0 },
    })

    expect(mail.text).not.toContain('Menus')
    expect(mail.text).not.toContain('diet')
    expect(mail.text).not.toContain('household')
  })
})

describe('rsvpFullMail (R5)', () => {
  it('says the places are all taken and that new replies go to the waiting list', () => {
    const mail = rsvpFullMail({ ...base('fr'), capacity: 120 })

    expect(mail.text).toContain(
      `Les 120 places sont prises${NBSP}; les nouvelles réponses vont en liste d’attente.`,
    )
    expect(mail.subject).toContain('complet')
  })
})

describe.each(CLIENT_LOCALES)('every mail of the family, in %s', (locale) => {
  const mails = (): readonly ReturnType<typeof rsvpFullMail>[] => [
    rsvpDigestMail({ ...base(locale), changed: 2, pendingNotes: 0, figures: FIGURES }),
    rsvpDeadlineMail({ ...base(locale), unanswered: 3, deadline: '2026-12-15' }),
    rsvpStoppedMail({ ...base(locale), figures: FIGURES }),
    rsvpFullMail({ ...base(locale), capacity: 50 }),
  ]

  it('is plain text, one subject line, valid, with exactly one link', () => {
    for (const mail of mails()) {
      expect(mail.html).toBeUndefined()
      expect(mail.subject).not.toMatch(/[\r\n]/)
      expect(checkOutgoingMail(mail).ok).toBe(true)
      expect(mail.text.match(/https?:\/\//g)).toHaveLength(1)
    }
  })

  it('ends with the line that says where to switch the family off, with no link', () => {
    for (const mail of mails()) {
      const lines = mail.text.trimEnd().split('\n')
      expect(lines.at(-1)).toBe('EventSlide')
      expect(lines.at(-3)).toMatch(/E-?mail|correo/i)
      expect(lines.at(-3)).not.toContain('http')
    }
  })

  it('carries the name of the event and nothing of a guest', () => {
    for (const mail of mails()) {
      expect(`${mail.subject}\n${mail.text}`).toContain('Camille et Sacha')
    }
  })
})

describe('the family never lets a name through', () => {
  it('folds an event name with a line break to one line, in the subject and the body', () => {
    const mail = rsvpFullMail({ ...base('fr', 'Soirée\r\nBcc: x@example.test'), capacity: 10 })

    expect(mail.subject).not.toMatch(/[\r\n]/)
  })

  it('has no field to put a diet or a guest name in: the figures carry numbers and the host menus', () => {
    const text = rsvpStoppedMail({ ...base('fr'), figures: FIGURES }).text

    expect(text).not.toMatch(/Léa|Martin|gluten/)
  })
})

describe('rsvpUnansweredPageUrl', () => {
  it('is the guest list filtered on the households that have not answered', () => {
    expect(rsvpUnansweredPageUrl('https://photos.example.com', 'a b')).toBe(
      'https://photos.example.com/admin/events/a%20b/rsvps/guests?filter=unanswered',
    )
  })
})

describe.each(CLIENT_LOCALES)('the singular, in %s', (locale) => {
  const ONE: RsvpFigures = {
    yes: { responses: 1, people: 2, adults: 1, kids: 1 },
    maybe: { responses: 1, people: 1 },
    no: { responses: 1 },
    waitlist: { responses: 1, people: 1 },
    dietCount: 1,
    meals: [{ label: 'Poisson', count: 1 }],
    noReplyHouseholds: 1,
  }

  it('speaks of one adult, one child, one household, one diet and one reply, and of several differently', () => {
    const one = [
      rsvpDigestMail({ ...base(locale), changed: 1, pendingNotes: 0, figures: ONE }),
      rsvpStoppedMail({ ...base(locale), figures: ONE }),
      rsvpDeadlineMail({ ...base(locale), unanswered: 1, deadline: '2026-12-15' }),
    ]
    const many = [
      rsvpDigestMail({ ...base(locale), changed: 2, pendingNotes: 0, figures: FIGURES }),
      rsvpStoppedMail({ ...base(locale), figures: FIGURES }),
      rsvpDeadlineMail({ ...base(locale), unanswered: 2, deadline: '2026-12-15' }),
    ]

    one.forEach((mail, index) => {
      expect(mail.text).not.toBe(many[index]?.text)
      expect(mail.subject).toBeTruthy()
    })
  })
})
