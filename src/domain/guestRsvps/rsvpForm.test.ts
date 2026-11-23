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
    ['a key lot 1 does not know', { capacity: 3 }],
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

  it('ignores an unknown field, and keeps the lot 4 fields at their defaults for now', () => {
    const form = restoreRsvpForm({
      surprise: true,
      capacity: 5,
      moments: [{ id: 'a', label: 'b' }],
    })

    expect(form).toEqual(DEFAULT_RSVP_FORM)
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
