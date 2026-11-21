import { describe, expect, it } from 'vitest'
import { aGuestInviteHost } from '../../../testing/renderWithProviders'
import {
  fieldOfCode,
  formFromInvite,
  inputFromForm,
  lineCount,
  type InvitationForm,
} from './invitationFormModel'

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
      field: 'start',
      reason: 'nonexistentHour',
    })
    expect(inputFromForm({ ...FORM, end: '2027-03-28T02:30' })).toEqual({
      ok: false,
      field: 'end',
      reason: 'nonexistentHour',
    })
  })

  it('refuses a time that is not one, in either field', () => {
    expect(inputFromForm({ ...FORM, start: '2027-12-11' })).toEqual({
      ok: false,
      field: 'start',
      reason: 'invalidTime',
    })
    expect(inputFromForm({ ...FORM, end: 'demain' })).toEqual({
      ok: false,
      field: 'end',
      reason: 'invalidTime',
    })
  })
})

describe('zones with an odd offset, the southern hemisphere, and UTC', () => {
  const at = (zone: string, start: string) => {
    const built = inputFromForm({ ...FORM, timeZone: zone, start, end: '' })
    return built.ok ? built.input.startsAt : built
  }

  it('reads a zone half an hour off the hour: Kolkata is +05:30', () => {
    expect(at('Asia/Kolkata', '2027-12-11T19:00')).toBe('2027-12-11T13:30:00.000Z')
  })

  it('reads a zone three quarters of an hour off: Kathmandu is +05:45', () => {
    expect(at('Asia/Kathmandu', '2027-12-11T19:00')).toBe('2027-12-11T13:15:00.000Z')
  })

  it('reads UTC as it is typed', () => {
    expect(at('UTC', '2027-12-11T19:00')).toBe('2027-12-11T19:00:00.000Z')
  })

  it('knows that the southern hemisphere moves its clocks the other way round: Auckland', () => {
    // Summer time (+13) in December, winter time (+12) in July.
    expect(at('Pacific/Auckland', '2027-12-11T19:00')).toBe('2027-12-11T06:00:00.000Z')
    expect(at('Pacific/Auckland', '2027-07-11T19:00')).toBe('2027-07-11T07:00:00.000Z')
    // 26 September 2027: 02:00 becomes 03:00, so 02:30 does not exist there.
    expect(at('Pacific/Auckland', '2027-09-26T02:30')).toEqual({
      ok: false,
      field: 'start',
      reason: 'nonexistentHour',
    })
    // 4 April 2027: 03:00 becomes 02:00, so 02:30 happens twice; the first is +13.
    expect(at('Pacific/Auckland', '2027-04-04T02:30')).toBe('2027-04-03T13:30:00.000Z')
  })

  it('reads an end on the next day in the same zone as the start', () => {
    const built = inputFromForm({
      ...FORM,
      timeZone: 'Pacific/Auckland',
      start: '2027-12-11T19:00',
      end: '2027-12-12T02:00',
    })

    expect(built.ok && [built.input.startsAt, built.input.endsAt]).toEqual([
      '2027-12-11T06:00:00.000Z',
      '2027-12-11T13:00:00.000Z',
    ])
  })

  it('writes the instants of Kolkata back as the clock that was typed', () => {
    const form = formFromInvite(
      aGuestInviteHost({
        timeZone: 'Asia/Kolkata',
        startsAt: '2027-12-11T13:30:00.000Z',
        endsAt: null,
      }),
      'Europe/Paris',
      'fr',
    )

    expect(form.start).toBe('2027-12-11T19:00')
  })
})

describe('a zone this browser does not know', () => {
  it('shows the times in the browser’s own zone, the instants unchanged, instead of failing', () => {
    const form = formFromInvite(
      aGuestInviteHost({
        timeZone: 'Mars/Olympus',
        startsAt: '2027-12-11T18:00:00.000Z',
        endsAt: null,
      }),
      'Europe/Paris',
      'fr',
    )

    expect(form.timeZone).toBe('Europe/Paris')
    expect(form.start).toBe('2027-12-11T19:00')
  })

  it('refuses to read a typed time in it, with the time as the field in error, not a crash', () => {
    const built = inputFromForm({ ...FORM, timeZone: 'Mars/Olympus' })

    expect(built).toEqual({ ok: false, field: 'start', reason: 'invalidTime' })
  })
})

describe('line counts', () => {
  it('counts lines as the server does: blank lines are not lines, every kind of break is one', () => {
    expect(lineCount('')).toBe(0)
    expect(lineCount('a')).toBe(1)
    expect(lineCount('a\nb')).toBe(2)
    expect(lineCount('a\r\n\r\nb\n\n')).toBe(2)
    expect(lineCount('a\u2028b\u2029c')).toBe(3)
    expect(lineCount('  \n a ')).toBe(1)
  })

  it('refuses an address of three lines and a word of nine before it is sent', () => {
    expect(inputFromForm({ ...FORM, address: 'a\nb\nc' })).toEqual({
      ok: false,
      field: 'address',
      reason: 'tooManyLines',
    })
    expect(inputFromForm({ ...FORM, message: Array(9).fill('x').join('\n') })).toEqual({
      ok: false,
      field: 'message',
      reason: 'tooManyLines',
    })
    expect(
      inputFromForm({ ...FORM, address: 'a\nb', message: Array(8).fill('x').join('\n') }).ok,
    ).toBe(true)
  })
})

describe('fieldOfCode', () => {
  it('ties a server code to the field it is about, and leaves the others to the summary', () => {
    expect(fieldOfCode('guestInvite.titleTooLong')).toBe('title')
    expect(fieldOfCode('guestInvite.venueInvalid')).toBe('venueName')
    expect(fieldOfCode('guestInvite.addressTooManyLines')).toBe('address')
    expect(fieldOfCode('guestInvite.messageTooLong')).toBe('message')
    expect(fieldOfCode('guestInvite.startsAtInvalid')).toBe('start')
    expect(fieldOfCode('guestInvite.timeZoneRequired')).toBe('start')
    expect(fieldOfCode('guestInvite.endBeforeStart')).toBe('end')
    expect(fieldOfCode('guestInvite.tooLong')).toBe('end')
    expect(fieldOfCode('guestInvite.badTimeZone')).toBeNull()
    expect(fieldOfCode('guestInvite.languageInvalid')).toBeNull()
    expect(fieldOfCode('client.suspended')).toBeNull()
  })
})
