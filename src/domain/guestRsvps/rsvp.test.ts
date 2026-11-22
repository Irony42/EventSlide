import { describe, expect, it } from 'vitest'
import { asEventId, asGuestRsvpId } from '../shared/ids'
import {
  EMPTY_RSVP_DETAILS,
  GuestRsvp,
  parseRsvpInput,
  restoreRsvpDetails,
  type RawRsvpInput,
} from './rsvp'
import { DEFAULT_RSVP_FORM, defaultRsvpForm, type RsvpForm } from './rsvpForm'
import { aRsvp, RSVP_AT } from './testing/rsvpFixtures'

const parse = (raw: RawRsvpInput, form: RsvpForm = DEFAULT_RSVP_FORM) => parseRsvpInput(form, raw)
const code = (result: ReturnType<typeof parse>): string | undefined =>
  result.ok ? undefined : result.error.code
const yes = { name: 'Léa', answer: 'yes', adults: 2, kids: 1 }
const BELL = String.fromCharCode(7)
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b)

describe('parseRsvpInput: the name', () => {
  it('keeps a name of 1 to 60 characters, cleaned to one line', () => {
    const result = parse({ ...yes, name: `  Léa \n Martin${BELL} ` })

    expect(result.ok && result.value.name).toBe('Léa Martin')
    expect(parse({ ...yes, name: 'x'.repeat(60) }).ok).toBe(true)
  })

  it('counts a character, not a UTF-16 unit', () => {
    expect(parse({ ...yes, name: '😀'.repeat(60) }).ok).toBe(true)
    expect(code(parse({ ...yes, name: '😀'.repeat(61) }))).toBe('rsvp.nameTooLong')
  })

  it('refuses an empty name, a name that is only invisible, and a name that is not text', () => {
    expect(code(parse({ ...yes, name: '' }))).toBe('rsvp.nameEmpty')
    expect(code(parse({ ...yes, name: ` ${ZERO_WIDTH_SPACE} ` }))).toBe('rsvp.nameEmpty')
    expect(code(parse({ ...yes, name: 'x'.repeat(61) }))).toBe('rsvp.nameTooLong')
    expect(code(parse({ ...yes, name: 12 }))).toBe('rsvp.nameInvalid')
    expect(code(parse({ answer: 'yes' }))).toBe('rsvp.nameInvalid')
  })
})

describe('parseRsvpInput: the answer', () => {
  it('accepts yes, maybe and no', () => {
    for (const answer of ['yes', 'maybe', 'no']) {
      expect(parse({ ...yes, answer }).ok).toBe(true)
    }
  })

  it('refuses "maybe" when the form does not offer it', () => {
    const wedding = defaultRsvpForm('wedding')

    expect(code(parse({ ...yes, answer: 'maybe' }, wedding))).toBe('rsvp.maybeNotOffered')
    expect(parse({ ...yes, answer: 'yes' }, wedding).ok).toBe(true)
  })

  it('never lets a guest choose the waiting list, nor invent an answer', () => {
    for (const answer of ['waitlist', 'perhaps', '', 1, null, undefined]) {
      expect(code(parse({ ...yes, answer }))).toBe('rsvp.answerInvalid')
    }
  })
})

describe('parseRsvpInput: how many', () => {
  it('counts adults and children, up to the maximum of the host included', () => {
    const result = parse({ ...yes, adults: 3, kids: 1 })

    expect(result.ok && [result.value.adults, result.value.kids]).toEqual([3, 1])
    expect(code(parse({ ...yes, adults: 3, kids: 2 }))).toBe('rsvp.partyTooBig')
  })

  it('needs at least one adult', () => {
    expect(code(parse({ ...yes, adults: 0, kids: 2 }))).toBe('rsvp.adultsRequired')
    expect(code(parse({ name: 'Léa', answer: 'yes' }))).toBe('rsvp.adultsRequired')
  })

  it('treats absent children as none, and refuses a count that is not a whole number', () => {
    const none = parse({ name: 'Léa', answer: 'yes', adults: 2 })

    expect(none.ok && none.value.kids).toBe(0)
    for (const bad of [-1, 1.5, '2', null, Number.NaN]) {
      expect(code(parse({ ...yes, adults: bad }))).toBe('rsvp.countInvalid')
      expect(code(parse({ ...yes, kids: bad }))).toBe('rsvp.countInvalid')
    }
  })

  it('counts no children when the form does not separate them', () => {
    const form: RsvpForm = { ...DEFAULT_RSVP_FORM, kidsSeparate: false }
    const result = parse({ ...yes, adults: 2, kids: 2 }, form)

    expect(result.ok && [result.value.adults, result.value.kids]).toEqual([2, 0])
  })

  it('means one adult when the form does not ask how many', () => {
    const form: RsvpForm = { ...DEFAULT_RSVP_FORM, partySize: { enabled: false, max: 4 } }
    const result = parse({ ...yes, adults: 9, kids: 9 }, form)

    expect(result.ok && [result.value.adults, result.value.kids]).toEqual([1, 0])
  })

  it('ignores, without judging it, a field the form does not ask for', () => {
    const noKids: RsvpForm = { ...DEFAULT_RSVP_FORM, kidsSeparate: false }
    const noCount: RsvpForm = { ...DEFAULT_RSVP_FORM, partySize: { enabled: false, max: 4 } }

    expect(parse({ ...yes, adults: 2, kids: 'many' }, noKids).ok).toBe(true)
    expect(parse({ ...yes, adults: 'two', kids: -3 }, noCount).ok).toBe(true)
    expect(code(parse({ ...yes, adults: 'two' }, noKids))).toBe('rsvp.countInvalid')
    expect(code(parse({ ...yes, adults: 2, kids: 'many' }))).toBe('rsvp.countInvalid')
  })

  it('brings nobody for a "no", whatever was sent', () => {
    const result = parse({ ...yes, answer: 'no', adults: 3, kids: 1, diet: 'sans gluten' })

    expect(result.ok && result.value).toMatchObject({
      answer: 'no',
      adults: 0,
      kids: 0,
      diet: null,
    })
  })
})

describe('parseRsvpInput: the diet and the word', () => {
  it('keeps a diet of up to 120 characters on one line', () => {
    const result = parse({ ...yes, diet: ' sans\n gluten ' })

    expect(result.ok && result.value.diet).toBe('sans gluten')
    expect(parse({ ...yes, diet: 'x'.repeat(120) }).ok).toBe(true)
    expect(code(parse({ ...yes, diet: 'x'.repeat(121) }))).toBe('rsvp.dietTooLong')
    expect(code(parse({ ...yes, diet: 4 }))).toBe('rsvp.dietInvalid')
  })

  it('reads an empty or absent diet as none', () => {
    for (const diet of [undefined, null, '', '  ']) {
      const result = parse({ ...yes, diet })
      expect(result.ok && result.value.diet).toBeNull()
    }
  })

  it('ignores the diet when the form does not ask for one, even an invalid one', () => {
    const form: RsvpForm = { ...DEFAULT_RSVP_FORM, diet: false }
    const result = parse({ ...yes, diet: 'noix' }, form)

    expect(result.ok && result.value.diet).toBeNull()
    expect(parse({ ...yes, diet: 4 }, form).ok).toBe(true)
  })

  it('keeps a word of up to 280 characters and 4 lines', () => {
    const result = parse({ ...yes, message: 'Hâte !\n\nA samedi' })

    expect(result.ok && result.value.message).toBe('Hâte !\nA samedi')
    expect(parse({ ...yes, message: 'x'.repeat(280) }).ok).toBe(true)
    expect(code(parse({ ...yes, message: 'x'.repeat(281) }))).toBe('rsvp.messageTooLong')
    expect(parse({ ...yes, message: 'a\nb\nc\nd' }).ok).toBe(true)
    expect(code(parse({ ...yes, message: 'a\nb\nc\nd\ne' }))).toBe('rsvp.messageTooManyLines')
    expect(code(parse({ ...yes, message: 7 }))).toBe('rsvp.messageInvalid')
  })

  it('keeps the word of a "no", and reads an empty one as none', () => {
    const kept = parse({ ...yes, answer: 'no', message: 'Dommage' })

    expect(kept.ok && kept.value.message).toBe('Dommage')
    for (const message of [undefined, null, '', ' ']) {
      const result = parse({ ...yes, message })
      expect(result.ok && result.value.message).toBeNull()
    }
  })
})

describe('GuestRsvp', () => {
  const reply = {
    name: 'Léa',
    answer: 'yes',
    adults: 2,
    kids: 1,
    diet: null,
    message: null,
  } as const

  it('is created with the reply, empty details, and the same creation and update instant', () => {
    const rsvp = GuestRsvp.create({
      id: asGuestRsvpId('r-1'),
      eventId: asEventId('e-1'),
      householdId: null,
      editTokenHash: 'abc',
      reply,
      source: 'open',
      now: RSVP_AT,
    })

    expect(rsvp.toProps()).toMatchObject({
      id: 'r-1',
      eventId: 'e-1',
      householdId: null,
      editTokenHash: 'abc',
      name: 'Léa',
      answer: 'yes',
      details: EMPTY_RSVP_DETAILS,
      source: 'open',
      createdAt: RSVP_AT,
      updatedAt: RSVP_AT,
    })
    expect(rsvp.people).toBe(3)
  })

  it('reads each field through its getter', () => {
    const rsvp = aRsvp({ householdId: 'h-1', diet: 'noix', message: 'Salut', kids: 2 })

    expect([rsvp.householdId, rsvp.diet, rsvp.message, rsvp.kids, rsvp.adults]).toEqual([
      'h-1',
      'noix',
      'Salut',
      2,
      1,
    ])
    expect([rsvp.name, rsvp.answer, rsvp.source, rsvp.editTokenHash]).toEqual([
      'Léa Martin',
      'yes',
      'open',
      null,
    ])
    expect(rsvp.details).toEqual(EMPTY_RSVP_DETAILS)
    expect(rsvp.id).toBe('rsvp-1')
    expect(rsvp.eventId).toBe('event-1')
    expect(rsvp.createdAt).toBe(RSVP_AT)
    expect(rsvp.updatedAt).toBe(RSVP_AT)
  })

  it('counts nobody for a "no"', () => {
    expect(aRsvp({ answer: 'no' }).people).toBe(0)
  })

  it('changes its content and its update instant, and nothing that identifies it', () => {
    const later = new Date('2026-11-23T10:00:00Z')
    const first = aRsvp({ editTokenHash: 'hash', source: 'household', householdId: 'h-1' })

    const second = first.withReply({ ...reply, name: 'Léa M.', answer: 'maybe' }, later)

    expect(second.toProps()).toMatchObject({
      id: first.id,
      editTokenHash: 'hash',
      source: 'household',
      householdId: 'h-1',
      createdAt: RSVP_AT,
      name: 'Léa M.',
      answer: 'maybe',
      adults: 2,
      updatedAt: later,
    })
    expect(first.name).toBe('Léa Martin')
  })
})

describe('restoreRsvpDetails', () => {
  it('reads back what a lot wrote', () => {
    const written = {
      companions: ['Hugo', 'Inès'],
      meals: ['Végétarien'],
      answers: [{ questionId: 'q1', label: 'Voiture ?', value: 'oui' }],
      moments: ['m1'],
      showName: true,
    }

    expect(restoreRsvpDetails(written)).toEqual(written)
  })

  it('never fails: anything malformed becomes empty', () => {
    for (const raw of [null, undefined, 'x', 4, [], {}]) {
      expect(restoreRsvpDetails(raw)).toEqual(EMPTY_RSVP_DETAILS)
    }
    const odd = restoreRsvpDetails({
      companions: 'Hugo',
      meals: [1, 'ok'],
      answers: ['x', { questionId: 1, label: 'a', value: 'b' }, { questionId: 'q', label: 'a' }],
      moments: null,
      showName: 'yes',
    })

    expect(odd).toEqual({ ...EMPTY_RSVP_DETAILS, meals: ['ok'] })
  })

  it('cuts by characters, never leaving half of a pair, and cleans each text of an answer', () => {
    const emoji = '😀'
    const cut = restoreRsvpDetails({
      companions: [emoji.repeat(121)],
      answers: [
        {
          questionId: emoji.repeat(50),
          label: ` ${'a'.repeat(200)}${BELL}`,
          value: `x
${emoji.repeat(200)}`,
        },
      ],
    })

    expect(cut.companions[0]).toBe(emoji.repeat(120))
    expect(cut.answers[0]?.questionId).toBe(emoji.repeat(40))
    expect(cut.answers[0]?.label).toBe('a'.repeat(120))
    expect(cut.answers[0]?.value).toBe(`x ${emoji.repeat(118)}`)
  })

  it('bounds the lists and the length of each text', () => {
    const many = restoreRsvpDetails({
      companions: Array.from({ length: 30 }, (_, i) => `p${i}`),
      meals: ['x'.repeat(500)],
      answers: Array.from({ length: 30 }, () => ({ questionId: 'q', label: 'l', value: 'v' })),
    })

    expect(many.companions).toHaveLength(12)
    expect(many.meals[0]).toHaveLength(120)
    expect(many.answers).toHaveLength(12)
  })
})

describe('GuestRsvp.withContentOf', () => {
  it('takes the content and the update instant of the other, and keeps its own identity', () => {
    const later = new Date('2026-11-24T10:00:00Z')
    const stored = aRsvp({
      id: 'r-1',
      editTokenHash: 'hash',
      source: 'open',
      householdId: 'h-1',
      name: 'Léa',
    })
    const incoming = aRsvp({
      id: 'r-other',
      editTokenHash: 'other',
      source: 'host',
      householdId: null,
      name: 'Léa M.',
      answer: 'maybe',
      adults: 3,
      kids: 1,
      diet: 'noix',
      message: 'Peut-être',
      details: { showName: true },
      createdAt: later,
    })

    expect(stored.withContentOf(incoming).toProps()).toEqual({
      ...stored.toProps(),
      name: 'Léa M.',
      answer: 'maybe',
      adults: 3,
      kids: 1,
      diet: 'noix',
      message: 'Peut-être',
      details: incoming.details,
      updatedAt: later,
    })
  })
})

describe('GuestRsvp.withHousehold', () => {
  it('attaches and detaches a household and changes nothing else', () => {
    const rsvp = aRsvp({ householdId: null })

    const attached = rsvp.withHousehold('h-1')

    expect(attached.householdId).toBe('h-1')
    expect(attached.toProps()).toEqual({ ...rsvp.toProps(), householdId: 'h-1' })
    expect(attached.withHousehold(null).householdId).toBeNull()
  })
})
