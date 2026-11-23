import { describe, expect, it } from 'vitest'
import { aRsvpSettings } from '../../testing/renderWithProviders'
import {
  PRESETS,
  applyInput,
  kindOf,
  mergeInputs,
  previewPage,
  usableDeadline,
} from './rsvpSettings'

describe('a choice laid over what the server holds', () => {
  it('changes only what the choice names, and clears a deadline with null', () => {
    const base = aRsvpSettings({ enabled: false, deadline: '2026-12-01' })

    const laid = applyInput(base, { enabled: true, form: { maybe: false } })

    expect(laid).toMatchObject({ enabled: true, deadline: '2026-12-01' })
    expect(laid.form).toMatchObject({ maybe: false, diet: true, kidsSeparate: true })
    expect(applyInput(base, { deadline: null }).deadline).toBeNull()
    expect(applyInput(base, {})).toEqual(base)
  })

  it('merges the two halves of the party size, and the other form fields', () => {
    const base = aRsvpSettings()

    const laid = applyInput(base, {
      form: { partySize: { enabled: false }, kidsSeparate: false, diet: false },
    })
    const sized = applyInput(base, { form: { partySize: { max: 8 } } })

    expect(laid.form).toMatchObject({
      partySize: { enabled: false, max: 4 },
      kidsSeparate: false,
      diet: false,
    })
    expect(sized.form.partySize).toEqual({ enabled: true, max: 8 })
  })
})

describe('two choices as one', () => {
  it('lets the later win field by field, deeply in the party size', () => {
    const merged = mergeInputs(
      { enabled: true, form: { maybe: true, partySize: { enabled: true, max: 3 } } },
      { deadline: '2026-12-01', form: { maybe: false, partySize: { max: 6 } } },
    )

    expect(merged).toEqual({
      enabled: true,
      deadline: '2026-12-01',
      form: { maybe: false, partySize: { enabled: true, max: 6 } },
    })
  })

  it('lets the later win on the switch and the deadline too', () => {
    expect(
      mergeInputs({ enabled: true, deadline: '2026-12-01' }, { enabled: false, deadline: null }),
    ).toEqual({
      enabled: false,
      deadline: null,
    })
  })

  it('has no form until one of them names it, and keeps a form when only one does', () => {
    expect(mergeInputs({ enabled: true }, { deadline: null })).toEqual({
      enabled: true,
      deadline: null,
    })
    expect(mergeInputs({ form: { diet: false } }, { enabled: false })).toEqual({
      enabled: false,
      form: { diet: false },
    })
    expect(mergeInputs({}, { form: { maybe: true } })).toEqual({ form: { maybe: true } })
  })
})

describe('what the guest’s page would say', () => {
  it('shows the block while replies are asked, and not otherwise, with the form as chosen', () => {
    const settings = aRsvpSettings({ enabled: true, deadline: '2026-12-01' })

    expect(previewPage(settings)).toEqual({
      state: 'open',
      deadline: '2026-12-01',
      form: {
        maybe: true,
        partySize: { enabled: true, max: 4 },
        kidsSeparate: true,
        diet: true,
        companionNames: false,
        meals: { enabled: false, options: [] },
        questions: [],
      },
    })
    expect(previewPage(aRsvpSettings({ enabled: false })).state).toBe('off')
  })
})

describe('the kind of party', () => {
  it('recognises the two presets, and nothing else', () => {
    const settings = aRsvpSettings()

    expect(kindOf(settings)).toBe('party')
    expect(kindOf(applyInput(settings, { form: PRESETS.wedding }))).toBe('wedding')
    expect(kindOf(applyInput(settings, { form: { maybe: false } }))).toBeNull()
    expect(kindOf(applyInput(settings, { form: { partySize: { max: 5 } } }))).toBeNull()
    expect(kindOf(applyInput(settings, { form: { partySize: { enabled: false } } }))).toBeNull()
  })
})

describe('the day a date field holds once it is a choice', () => {
  const now = new Date('2026-11-23T10:00:00')

  it('takes a real day of this year, next year, or last year', () => {
    expect(usableDeadline('2026-12-01', now)).toBe('2026-12-01')
    expect(usableDeadline('2027-06-30', now)).toBe('2027-06-30')
    expect(usableDeadline('2025-01-01', now)).toBe('2025-01-01')
  })

  it('leaves what is typed on the way: nothing, a half date, an old year', () => {
    expect(usableDeadline('', now)).toBeNull()
    expect(usableDeadline('0020-12-01', now)).toBeNull()
    expect(usableDeadline('2024-12-31', now)).toBeNull()
    expect(usableDeadline('2026-12', now)).toBeNull()
  })

  it('refuses a day that does not exist', () => {
    expect(usableDeadline('2026-02-30', now)).toBeNull()
    expect(usableDeadline('2026-13-01', now)).toBeNull()
  })
})
