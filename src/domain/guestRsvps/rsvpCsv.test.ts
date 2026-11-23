import { describe, expect, it } from 'vitest'
import { mealsSummary, rsvpCsv, type RsvpCsvLabels } from './rsvpCsv'
import { aRsvp } from './testing/rsvpFixtures'

const LABELS: RsvpCsvLabels = {
  name: 'Nom',
  answer: 'Réponse',
  adults: 'Adultes',
  kids: 'Enfants',
  diet: 'Régime',
  companions: 'Accompagnants',
  meals: 'Menus',
  total: 'Total',
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
      'Nom;Réponse;Adultes;Enfants;Accompagnants;Menus;Régime;Message;Origine;Modifiée le',
      'Léa;Oui;2;1;;;;;Lien;2026-11-22T10:00:00.000Z',
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
        .map((row) => row.split(';').filter((_, i) => i === 1 || i === 8)),
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

    expect(csv).toContain('"Léa; ""Lélé"" M.";Oui;1;0;;;x;"a\nb";Lien;')
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
      "'=Nom;Réponse;Adultes;Enfants;Accompagnants;Menus;'@Régime;Message;Origine;Modifiée le",
    )
  })

  it('leaves a harmless text alone: a dash inside, an apostrophe, a digit', () => {
    const csv = rsvpCsv([aRsvp({ name: "Jean-Pierre d'Arc", diet: '3 noix' })], 'all', LABELS)

    expect(csv).toContain("Jean-Pierre d'Arc;Oui;1;0;;;3 noix;")
  })

  it('writes the counts as numbers, never guarded', () => {
    const csv = rsvpCsv([aRsvp({ answer: 'no' })], 'all', LABELS)

    expect(linesOf(csv)[1]).toContain(';Non;0;0;')
  })
})

describe('rsvpCsv, for the caterer', () => {
  it('lists only those who come: name, adults, children, menus, diet, and never a message', () => {
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

    expect(linesOf(csv)).toEqual([
      'Nom;Adultes;Enfants;Menus;Régime',
      'Léa;2;1;;sans gluten',
      'Total;2;1;;',
      '',
    ])
    expect(csv).not.toContain('secret')
  })

  it('has the byte-order mark and neutralises formulas here too', () => {
    const csv = rsvpCsv([aRsvp({ name: '=cmd' })], 'caterer', LABELS)

    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv).toContain("'=cmd;1;0;")
  })
})

describe('rsvpCsv, the lot 2 columns', () => {
  const questions = [
    { id: 'q1', label: 'Un chant ?' },
    { id: 'q2', label: 'Venez-vous en voiture ?' },
  ]
  const answered = aRsvp({
    id: 'a',
    name: 'Léa',
    adults: 2,
    details: {
      companions: ['Hugo'],
      meals: ['Poisson', 'Végé'],
      answers: [
        { questionId: 'q1', label: 'Un chant ?', value: 'Le Temps des cerises' },
        { questionId: 'q2', label: 'Venez-vous en voiture ?', value: 'Oui' },
      ],
    },
  })

  it('writes the companions, the menus and one column per question, in the form’s order', () => {
    const csv = rsvpCsv([answered], 'all', LABELS, questions)

    expect(linesOf(csv)).toEqual([
      'Nom;Réponse;Adultes;Enfants;Accompagnants;Menus;Régime;Un chant ?;Venez-vous en voiture ?;Message;Origine;Modifiée le',
      'Léa;Oui;2;0;Hugo;Poisson, Végé;;Le Temps des cerises;Oui;;Lien;2026-11-22T10:00:00.000Z',
      '',
    ])
  })

  it('leaves the cell empty for a reply that did not answer, and keeps the column', () => {
    const csv = rsvpCsv([aRsvp({ name: 'Zoé' })], 'all', LABELS, questions)

    expect(linesOf(csv)[1]).toBe('Zoé;Oui;1;0;;;;;;;Lien;2026-11-22T10:00:00.000Z')
  })

  it('keeps a column for a question the host removed, under the label it was answered with', () => {
    const csv = rsvpCsv([answered], 'all', LABELS, [questions[1] as (typeof questions)[number]])

    expect(linesOf(csv)[0]).toContain(';Venez-vous en voiture ?;Un chant ?;')
    expect(linesOf(csv)[1]).toContain(';Oui;Le Temps des cerises;')
  })

  it('neutralises a formula in a question’s label and in an answer', () => {
    const csv = rsvpCsv(
      [
        aRsvp({
          details: { answers: [{ questionId: 'q1', label: '=x', value: '+cmd' }] },
        }),
      ],
      'all',
      LABELS,
      [{ id: 'q1', label: '=x' }],
    )

    expect(csv).toContain(";'=x;")
    expect(csv).toContain(";'+cmd;")
  })

  it('gives the caterer the menus of those who come', () => {
    const csv = rsvpCsv([answered], 'caterer', LABELS, questions)

    expect(linesOf(csv)).toEqual([
      'Nom;Adultes;Enfants;Menus;Régime',
      'Léa;2;0;Poisson, Végé;',
      'Total;2;0;Poisson, Végé;',
      '',
    ])
  })
})

describe('rsvpCsv, a removed question', () => {
  it('is headed by the label of the most recently updated reply that answered it', () => {
    const answer = (label: string) => [{ questionId: 'gone', label, value: 'x' }]
    const csv = rsvpCsv(
      [
        aRsvp({
          id: 'a',
          updatedAt: new Date('2026-11-22T10:00:00Z'),
          details: { answers: answer('Ancien libellé') },
        }),
        aRsvp({
          id: 'b',
          updatedAt: new Date('2026-11-23T10:00:00Z'),
          details: { answers: answer('Dernier libellé') },
        }),
        aRsvp({
          id: 'c',
          updatedAt: new Date('2026-11-21T10:00:00Z'),
          details: { answers: answer('Très ancien') },
        }),
      ],
      'all',
      LABELS,
      [],
    )

    expect(linesOf(csv)[0]).toContain(';Dernier libellé;')
    expect(linesOf(csv)[0]).not.toContain('Ancien libellé')
  })

  it('is a column of its own when the host adds a question again: the new one has another id', () => {
    const csv = rsvpCsv(
      [aRsvp({ details: { answers: [{ questionId: 'old', label: 'Un chant ?', value: 'a' }] } })],
      'all',
      LABELS,
      [{ id: 'new', label: 'Un chant ?' }],
    )

    expect(linesOf(csv)[0]?.match(/Un chant \?/g)).toHaveLength(2)
  })

  it('writes a blank menu or companion as nothing, and joins the rest', () => {
    const csv = rsvpCsv(
      [aRsvp({ adults: 3, details: { companions: ['', 'Inès'], meals: ['', 'Végé'] } })],
      'all',
      LABELS,
    )

    expect(linesOf(csv)[1]).toContain(';Inès;Végé;')
  })
})

describe('mealsSummary', () => {
  it('names each menu once, with how many when more than one, in the order they are met', () => {
    expect(mealsSummary(['Poisson', 'Végé', 'Poisson', 'Poisson'])).toBe('Poisson ×3, Végé')
    expect(mealsSummary(['Végé', 'Poisson'])).toBe('Végé, Poisson')
  })

  it('counts a blank entry for nobody, and says nothing when nobody chose', () => {
    expect(mealsSummary(['', 'Végé', ''])).toBe('Végé')
    expect(mealsSummary(['', ''])).toBeNull()
    expect(mealsSummary([])).toBeNull()
  })
})

describe('rsvpCsv, the caterer’s file', () => {
  const two = [
    aRsvp({
      id: 'a',
      name: 'Léa',
      adults: 2,
      kids: 1,
      details: { meals: ['Poisson', 'Végé', ''] },
    }),
    aRsvp({
      id: 'b',
      name: 'Hugo',
      adults: 1,
      kids: 0,
      diet: 'noix',
      details: { meals: ['Poisson'] },
    }),
    aRsvp({ id: 'c', name: 'Tom', answer: 'maybe', adults: 4, details: { meals: ['Viande'] } }),
    aRsvp({ id: 'd', name: 'Ana', answer: 'no', message: 'secret' }),
  ]

  it('groups each reply’s menus, and ends with a line that adds up those who come', () => {
    const csv = rsvpCsv(two, 'caterer', LABELS)

    expect(linesOf(csv)).toEqual([
      'Nom;Adultes;Enfants;Menus;Régime',
      'Léa;2;1;Poisson, Végé;',
      'Hugo;1;0;Poisson;noix',
      'Total;3;1;Poisson ×2, Végé;',
      '',
    ])
    expect(csv).not.toContain('Viande')
    expect(csv).not.toContain('secret')
  })

  it('has no total line when nobody comes, only the header', () => {
    expect(linesOf(rsvpCsv([two[3] as (typeof two)[number]], 'caterer', LABELS))).toEqual([
      'Nom;Adultes;Enfants;Menus;Régime',
      '',
    ])
  })
})

describe('rsvpCsv, the caterer’s file follows the form', () => {
  const coming = [
    aRsvp({
      id: 'a',
      name: 'Léa',
      adults: 2,
      diet: 'noix',
      details: { meals: ['Poisson', 'Végé'] },
    }),
    aRsvp({ id: 'b', name: 'Tom', answer: 'maybe', diet: 'lait' }),
  ]
  const caterer = (asked: { meals: boolean; diet: boolean }) =>
    linesOf(rsvpCsv(coming, 'caterer', LABELS, [], asked))

  it('has no menus column, and no menus in the total, when the form no longer asks for menus', () => {
    expect(caterer({ meals: false, diet: true })).toEqual([
      'Nom;Adultes;Enfants;Régime',
      'Léa;2;0;noix',
      'Total;2;0;',
      '',
    ])
  })

  it('has no diet column when the form no longer asks for it', () => {
    expect(caterer({ meals: true, diet: false })).toEqual([
      'Nom;Adultes;Enfants;Menus',
      'Léa;2;0;Poisson, Végé',
      'Total;2;0;Poisson, Végé',
      '',
    ])
  })

  it('keeps every column by default, and never writes the diet of a maybe', () => {
    const lines = linesOf(rsvpCsv(coming, 'caterer', LABELS))

    expect(lines[0]).toBe('Nom;Adultes;Enfants;Menus;Régime')
    expect(lines.join('')).not.toContain('lait')
  })
})
