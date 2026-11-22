import { describe, expect, it } from 'vitest'
import { aGuestInviteHost } from '../../../testing/renderWithProviders'
import { draftInvite } from './invitationDraft'
import type { InvitationForm } from './invitationFormModel'

const SAVED = aGuestInviteHost({ enabled: true })

const FORM: InvitationForm = {
  title: 'Nouveau titre',
  start: '2027-12-12T20:00',
  end: '',
  timeZone: 'Europe/Paris',
  venueName: 'Ailleurs',
  address: '',
  message: 'Un autre mot',
  language: 'en',
}

describe('draftInvite', () => {
  it('lays what is typed over the saved invitation, and keeps the link and the switch', () => {
    const draft = draftInvite(SAVED, FORM)

    expect(draft).toMatchObject({
      title: 'Nouveau titre',
      startsAt: '2027-12-12T19:00:00.000Z',
      endsAt: null,
      venueName: 'Ailleurs',
      address: null,
      message: 'Un autre mot',
      language: 'en',
      url: SAVED.url,
      enabled: true,
    })
  })

  it('keeps the saved moment while the typed one is not a time yet', () => {
    const draft = draftInvite(SAVED, { ...FORM, start: '2027-12-1', end: '2027-13-40T99:99' })

    expect(draft.startsAt).toBe(SAVED.startsAt)
    expect(draft.endsAt).toBe(SAVED.endsAt)
  })

  it('keeps the saved start when the field is emptied: the formats need a date', () => {
    expect(draftInvite(SAVED, { ...FORM, start: '' }).startsAt).toBe(SAVED.startsAt)
  })

  it('keeps the saved moment for an hour the clocks skip', () => {
    const draft = draftInvite(SAVED, { ...FORM, start: '2027-03-28T02:30' })

    expect(draft.startsAt).toBe(SAVED.startsAt)
  })

  it('takes an emptied end as no end', () => {
    expect(draftInvite({ ...SAVED, endsAt: '2027-12-12T01:00:00.000Z' }, FORM).endsAt).toBeNull()
  })
})
