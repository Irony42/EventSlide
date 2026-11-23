import { describe, expect, it } from 'vitest'
import { aGuestOwnRsvp, aGuestRsvpPage, aRsvpSettings } from '../../testing/renderWithProviders'
import { fr } from '../i18n/fr'
import { applyInput } from './rsvpSettings'
import { recapLine } from './rsvpTexts'

describe('limited places, as data', () => {
  it('lays the capacity over the settings while a save is on its way, null lifting it', () => {
    const settings = aRsvpSettings()

    const limited = applyInput(settings, { form: { capacity: 40 } })
    expect(limited.form.capacity).toBe(40)
    expect(applyInput(limited, { form: { capacity: null } }).form.capacity).toBeNull()
    expect(applyInput(limited, { enabled: true }).form.capacity).toBe(40)
  })

  it('words a waiting-list reply as such, never as a yes', () => {
    const line = recapLine(
      aGuestOwnRsvp({ answer: 'waitlist' }),
      aGuestRsvpPage().form,
      fr.rsvp.guest,
    )

    expect(line.startsWith(fr.rsvp.guest.recapWaitlist)).toBe(true)
    expect(line).not.toContain(fr.rsvp.guest.recapYes)
  })
})
