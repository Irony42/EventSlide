import { describe, expect, it } from 'vitest'
import {
  applyFormPatch,
  DEFAULT_RSVP_FORM,
  defaultRsvpForm,
  restoreRsvpForm,
  type RsvpForm,
} from './rsvpForm'

const patched = (patch: Parameters<typeof applyFormPatch>[1], from: RsvpForm = DEFAULT_RSVP_FORM) =>
  applyFormPatch(from, patch, () => 'aaaaaaaa')

describe('defaultRsvpForm', () => {
  it('offers "maybe" and four places for an ordinary evening', () => {
    expect(defaultRsvpForm('birthday')).toMatchObject({
      maybe: true,
      partySize: { enabled: true, max: 4 },
      kidsSeparate: true,
      diet: true,
      companionNames: false,
    })
    expect(defaultRsvpForm(null)).toEqual(DEFAULT_RSVP_FORM)
  })

  it('asks a wedding for a count: no "maybe", six places, the companions by name', () => {
    expect(defaultRsvpForm('wedding')).toMatchObject({
      maybe: false,
      partySize: { enabled: true, max: 6 },
      companionNames: true,
    })
  })

  it('models the fields of the later lots with their defaults', () => {
    expect(DEFAULT_RSVP_FORM).toMatchObject({
      meals: { enabled: false, options: [] },
      questions: [],
      visibility: 'off',
      capacity: null,
      moments: [],
      absentNote: true,
    })
  })
})

describe('applyFormPatch', () => {
  it.each([
    ['a number', 4],
    ['null', null],
    ['a list', ['maybe']],
    ['a string', 'maybe'],
    ['a key the form does not know', { absentNote: false }],
    ['a key that is not even one of the form', { maybe: true, nope: 1 }],
  ])('refuses %s as rsvp.formInvalid, and never ignores it', (_name, patch) => {
    const result = patched(patch)

    expect(!result.ok && result.error.code).toBe('rsvp.formInvalid')
  })

  it('leaves an absent field as it was', () => {
    const result = patched({})

    expect(result.ok && result.value).toEqual(DEFAULT_RSVP_FORM)
  })

  it('changes each field it is given', () => {
    const result = patched({
      maybe: false,
      kidsSeparate: false,
      diet: false,
      partySize: { enabled: false, max: 8 },
    })

    expect(result.ok && result.value).toMatchObject({
      maybe: false,
      kidsSeparate: false,
      diet: false,
      partySize: { enabled: false, max: 8 },
    })
  })

  it('changes the party size field by field', () => {
    const onlyMax = patched({ partySize: { max: 10 } })
    const onlyEnabled = patched({ partySize: { enabled: false } })

    expect(onlyMax.ok && onlyMax.value.partySize).toEqual({ enabled: true, max: 10 })
    expect(onlyEnabled.ok && onlyEnabled.value.partySize).toEqual({ enabled: false, max: 4 })
  })

  it('accepts the bounds of the party size, 1 and 10, and refuses what is outside', () => {
    expect(patched({ partySize: { max: 1 } }).ok).toBe(true)
    expect(patched({ partySize: { max: 10 } }).ok).toBe(true)
    for (const max of [0, 11, 2.5, '4', null, Number.NaN]) {
      const result = patched({ partySize: { max } })
      expect(!result.ok && result.error.code).toBe('rsvp.partyMaxInvalid')
    }
  })

  it('refuses a switch that is not a boolean, whichever it is', () => {
    for (const patch of [{ maybe: 'yes' }, { kidsSeparate: 1 }, { diet: null }]) {
      const result = patched(patch)
      expect(!result.ok && result.error.code).toBe('rsvp.formInvalid')
    }
    for (const partySize of ['4', null, [], { enabled: 'yes' }]) {
      const result = patched({ partySize })
      expect(!result.ok && result.error.code).toBe('rsvp.formInvalid')
    }
  })
})

describe('restoreRsvpForm', () => {
  it('reads back what it is given', () => {
    const form = restoreRsvpForm({
      maybe: false,
      partySize: { enabled: false, max: 7 },
      kidsSeparate: false,
      diet: false,
    })

    expect(form).toMatchObject({
      maybe: false,
      partySize: { enabled: false, max: 7 },
      kidsSeparate: false,
      diet: false,
    })
  })

  it('never fails: what is not an object, or out of bounds, becomes the default', () => {
    for (const raw of [null, undefined, 'x', 3, [], '{"maybe":false}']) {
      expect(restoreRsvpForm(raw)).toEqual(DEFAULT_RSVP_FORM)
    }
    expect(restoreRsvpForm({ maybe: 'no', partySize: { enabled: 1, max: 99 }, diet: 0 })).toEqual(
      DEFAULT_RSVP_FORM,
    )
    expect(restoreRsvpForm({ partySize: 'x' })).toEqual(DEFAULT_RSVP_FORM)
  })

  it('ignores an unknown field, and keeps the absent’s word at its default until its own pull request', () => {
    const form = restoreRsvpForm({ surprise: true, absentNote: false, moments: 'x' })

    expect(form).toEqual(DEFAULT_RSVP_FORM)
  })

  it('reads the capacity that holds and brings any other back to "no limit"', () => {
    expect(restoreRsvpForm({ capacity: 40 }).capacity).toBe(40)
    expect(restoreRsvpForm({ capacity: 2000 }).capacity).toBe(2000)
    for (const bad of [0, 2001, 1.5, '40', null, Number.NaN]) {
      expect(restoreRsvpForm({ capacity: bad }).capacity).toBeNull()
    }
  })

  it('reads the moments that hold and drops the rest', () => {
    const form = restoreRsvpForm({
      moments: [
        { id: '0000000a', label: 'Brunch' },
        { id: 'bad', label: 'X' },
      ],
    })

    expect(form.moments).toEqual([{ id: '0000000a', label: 'Brunch' }])
  })

  it('reads who comes back, and brings an unknown value back to "nothing"', () => {
    expect(restoreRsvpForm({ visibility: 'names' }).visibility).toBe('names')
    expect(restoreRsvpForm({ visibility: 'count' }).visibility).toBe('count')
    expect(restoreRsvpForm({ visibility: 'everyone' }).visibility).toBe('off')
  })

  it('changes who comes with one of the three values and refuses any other', () => {
    for (const visibility of ['off', 'count', 'names']) {
      const result = patched({ visibility })
      expect(result.ok && result.value.visibility).toBe(visibility)
    }
    for (const visibility of ['all', true, null, 1]) {
      const result = patched({ visibility })
      expect(!result.ok && result.error.code).toBe('rsvp.visibilityInvalid')
    }
  })
})

describe('the capacity in a patch', () => {
  it('takes a whole number of people from 1 to 2000, and null lifts the limit', () => {
    const set = patched({ capacity: 40 })
    expect(set.ok && set.value.capacity).toBe(40)
    expect(patched({ capacity: 1 }).ok && patched({ capacity: 2000 }).ok).toBe(true)
    if (!set.ok) throw new Error('set')
    const lifted = patched({ capacity: null }, set.value)
    expect(lifted.ok && lifted.value.capacity).toBeNull()
  })

  it('leaves it as it was when the patch does not name it', () => {
    const set = patched({ capacity: 40 })
    if (!set.ok) throw new Error('set')

    const other = patched({ maybe: false }, set.value)

    expect(other.ok && other.value.capacity).toBe(40)
  })

  it.each([
    ['zero', 0],
    ['2001', 2001],
    ['a fraction', 1.5],
    ['text', '40'],
    ['NaN', Number.NaN],
    ['a negative', -3],
  ])('refuses %s as rsvp.capacityInvalid', (_name, capacity) => {
    const result = patched({ capacity })

    expect(!result.ok && result.error.code).toBe('rsvp.capacityInvalid')
  })
})
