import { describe, expect, it } from 'vitest'
import { rsvpCsv, type RsvpCsvLabels } from './rsvpCsv'
import { aRsvp } from './testing/rsvpFixtures'

const LABELS: RsvpCsvLabels = {
  name: 'Nom',
  answer: 'Réponse',
  adults: 'Adultes',
  kids: 'Enfants',
  diet: 'Régime',
  message: 'Message',
  source: 'Origine',
  updatedAt: 'Modifiée le',
  answers: { yes: 'Oui', maybe: 'Peut-être', no: 'Non', waitlist: "Liste d'attente" },
  sources: { open: 'Lien', household: 'Foyer', host: 'Hôte' },
}

const BOM = String.fromCharCode(0xfeff)
const linesOf = (csv: string): string[] => csv.slice(BOM.length).split('\r\n')

describe('rsvpCsv, all replies', () => {
  it('starts with a byte-order mark, separates with ; and ends every line with CRLF', () => {
    const csv = rsvpCsv([aRsvp({ name: 'Léa', adults: 2, kids: 1 })], 'all', LABELS)

    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(linesOf(csv)).toEqual([
      'Nom;Réponse;Adultes;Enfants;Régime;Message;Origine;Modifiée le',
      'Léa;Oui;2;1;;;Lien;2026-11-22T10:00:00.000Z',
      '',
    ])
  })

  it('is only the header for no reply', () => {
    expect(linesOf(rsvpCsv([], 'all', LABELS))).toHaveLength(2)
  })

  it('writes the answer and the origin in the host’s language', () => {
    const csv = rsvpCsv(
      [
        aRsvp({ id: 'a', answer: 'maybe', source: 'household' }),
        aRsvp({ id: 'b', answer: 'no', source: 'host' }),
        aRsvp({ id: 'c', answer: 'waitlist' }),
      ],
      'all',
      LABELS,
    )

    expect(
      linesOf(csv)
        .slice(1, 4)
        .map((row) => row.split(';').filter((_, i) => i === 1 || i === 6)),
    ).toEqual([
      ['Peut-être', 'Foyer'],
      ['Non', 'Hôte'],
      ["Liste d'attente", 'Lien'],
    ])
  })

  it('quotes a value with a semicolon, a quote or a line break, and doubles the quotes', () => {
    const csv = rsvpCsv(
      [aRsvp({ name: 'Léa; "Lélé" M.', message: 'a\nb', diet: 'x' })],
      'all',
      LABELS,
    )

    expect(csv).toContain('"Léa; ""Lélé"" M.";Oui;1;0;x;"a\nb";Lien;')
  })

  it('neutralises a formula in every text cell, whatever its first character', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      const csv = rsvpCsv(
        [aRsvp({ name: `${start}HYPERLINK("x")`, diet: `${start}1`, message: `${start}2` })],
        'all',
        LABELS,
      )
      const row = csv.slice(BOM.length)

      expect(row).toContain(`'${start}HYPERLINK`)
      expect(row).not.toMatch(new RegExp(`(^|;|\\n)${start === '+' ? '\\+' : start}HYPERLINK`))
    }
  })

  it('neutralises the headers too, as a host writes some of them', () => {
    const csv = rsvpCsv([], 'all', { ...LABELS, name: '=Nom', diet: '@Régime' })

    expect(linesOf(csv)[0]).toBe(
      "'=Nom;Réponse;Adultes;Enfants;'@Régime;Message;Origine;Modifiée le",
    )
  })

  it('leaves a harmless text alone: a dash inside, an apostrophe, a digit', () => {
    const csv = rsvpCsv([aRsvp({ name: "Jean-Pierre d'Arc", diet: '3 noix' })], 'all', LABELS)

    expect(csv).toContain("Jean-Pierre d'Arc;Oui;1;0;3 noix;")
  })

  it('writes the counts as numbers, never guarded', () => {
    const csv = rsvpCsv([aRsvp({ answer: 'no' })], 'all', LABELS)

    expect(linesOf(csv)[1]).toContain(';Non;0;0;')
  })
})

describe('rsvpCsv, for the caterer', () => {
  it('lists only those who come: name, adults, children, diet, and never a message', () => {
    const csv = rsvpCsv(
      [
        aRsvp({ id: 'a', name: 'Léa', adults: 2, kids: 1, diet: 'sans gluten', message: 'secret' }),
        aRsvp({ id: 'b', name: 'Hugo', answer: 'maybe', adults: 3 }),
        aRsvp({ id: 'c', name: 'Inès', answer: 'no' }),
        aRsvp({ id: 'd', name: 'Zoé', answer: 'waitlist' }),
      ],
      'caterer',
      LABELS,
    )

    expect(linesOf(csv)).toEqual(['Nom;Adultes;Enfants;Régime', 'Léa;2;1;sans gluten', ''])
    expect(csv).not.toContain('secret')
  })

  it('has the byte-order mark and neutralises formulas here too', () => {
    const csv = rsvpCsv([aRsvp({ name: '=cmd' })], 'caterer', LABELS)

    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv).toContain("'=cmd;1;0;")
  })
})
