import { describe, expect, it } from 'vitest'
import { aGuestInviteHost } from '../../../testing/renderWithProviders'
import { formFromInvite, inputFromForm, type InvitationForm } from './invitationFormModel'

const BLANK = aGuestInviteHost({
  configured: false,
  enabled: false,
  url: null,
  title: null,
  startsAt: null,
  endsAt: null,
  timeZone: null,
  venueName: null,
  address: null,
  message: null,
  language: 'de',
  defaultStartsAt: '2027-12-11T18:00:00.000Z',
})

const FORM: InvitationForm = {
  title: 'Léa fête ses 40 ans',
  start: '2027-12-11T19:00',
  end: '2027-12-12T02:00',
  timeZone: 'Europe/Paris',
  venueName: 'La Guinguette du Port',
  address: '12 quai de la Loire\n44000 Nantes',
  message: 'Apéro à 19 h.',
  language: 'fr',
}

describe('formFromInvite', () => {
  it('starts an unwritten invitation from what the event knows: its date, the browser’s zone, the reader’s language', () => {
    const form = formFromInvite(BLANK, 'America/Montreal', 'fr')

    expect(form).toEqual({
      title: '',
      // 18:00Z is 13:00 in Montreal: the event's date, on the clock of the zone the invitation will keep.
      start: '2027-12-11T13:00',
      end: '',
      timeZone: 'America/Montreal',
      venueName: '',
      address: '',
      message: '',
      language: 'fr',
    })
  })

  it('shows what was saved, in the zone it was saved in', () => {
    const form = formFromInvite(aGuestInviteHost(), 'America/Montreal', 'en')

    expect(form).toMatchObject({
      title: 'Léa fête ses 40 ans',
      start: '2027-12-11T19:00',
      end: '2027-12-12T02:00',
      timeZone: 'Europe/Paris',
      language: 'fr',
    })
  })

  it('never takes the zone from the browser again once one was saved: editing from abroad does not move the hour', () => {
    const form = formFromInvite(aGuestInviteHost(), 'Asia/Tokyo', 'en')

    expect(form.timeZone).toBe('Europe/Paris')
    expect(form.start).toBe('2027-12-11T19:00')
  })

  it('leaves the start empty when the host cleared it, rather than coming back to the event’s date', () => {
    const form = formFromInvite(
      aGuestInviteHost({
        startsAt: null,
        endsAt: null,
        defaultStartsAt: '2027-12-11T18:00:00.000Z',
      }),
      'Europe/Paris',
      'fr',
    )

    expect(form.start).toBe('')
  })

  it('has no start for an unwritten invitation of an event with no date', () => {
    const form = formFromInvite({ ...BLANK, defaultStartsAt: null }, 'Europe/Paris', 'fr')

    expect(form.start).toBe('')
  })
})

describe('inputFromForm', () => {
  it('reads the typed times in the invitation’s zone, and sends the zone with them', () => {
    const built = inputFromForm(FORM)

    expect(built).toEqual({
      ok: true,
      input: {
        title: 'Léa fête ses 40 ans',
        startsAt: '2027-12-11T18:00:00.000Z',
        endsAt: '2027-12-12T01:00:00.000Z',
        timeZone: 'Europe/Paris',
        venueName: 'La Guinguette du Port',
        address: '12 quai de la Loire\n44000 Nantes',
        message: 'Apéro à 19 h.',
        language: 'fr',
      },
    })
  })

  it('reads the same typed time at another hour in another zone: it is the zone’s clock, not the laptop’s', () => {
    const built = inputFromForm({ ...FORM, timeZone: 'America/New_York' })

    expect(built.ok && built.input.startsAt).toBe('2027-12-12T00:00:00.000Z')
  })

  it('sends null for a field left empty, which clears it on the server', () => {
    const built = inputFromForm({
      ...FORM,
      title: '  ',
      end: '',
      venueName: '',
      address: '',
      message: '\n',
    })

    expect(built.ok && built.input).toMatchObject({
      title: null,
      endsAt: null,
      venueName: null,
      address: null,
      message: null,
    })
  })

  it('sends a null start for an empty start', () => {
    const built = inputFromForm({ ...FORM, start: '', end: '' })

    expect(built.ok && built.input.startsAt).toBeNull()
  })

  it('says so when the clocks skipped the hour typed, and sends nothing', () => {
    // 02:30 on 28 March 2027 does not exist in Paris.
    expect(inputFromForm({ ...FORM, start: '2027-03-28T02:30' })).toEqual({
      ok: false,
      reason: 'nonexistentHour',
    })
    expect(inputFromForm({ ...FORM, end: '2027-03-28T02:30' })).toEqual({
      ok: false,
      reason: 'nonexistentHour',
    })
  })

  it('refuses a time that is not one, in either field', () => {
    expect(inputFromForm({ ...FORM, start: '2027-12-11' })).toEqual({
      ok: false,
      reason: 'invalidTime',
    })
    expect(inputFromForm({ ...FORM, end: 'demain' })).toEqual({
      ok: false,
      reason: 'invalidTime',
    })
  })
})
