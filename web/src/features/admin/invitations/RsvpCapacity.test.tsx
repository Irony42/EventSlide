import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { SAVE_DEBOUNCE_MS } from '../../../lib/useSettingsAutosave'
import type { Api } from '../../../lib/api/client'
import { aRsvpSettings, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { RsvpPanel } from './RsvpPanel'
import { useRsvpSettings } from './useRsvpSettings'

/**
 * Limited places in the host's settings (spec 30, lot 4, PR 14): a switch and a number of people,
 * sent when the field is left; a text that is not a number is never sent as `null`, which would lift
 * the limit; the switch off lifts it with one request.
 */

const t = fr.rsvp.host

function Harness() {
  const rsvp = useRsvpSettings('mariage', 0)
  return <RsvpPanel rsvp={rsvp} archived={false} onClose={() => undefined} />
}

const limited = (capacity: number | null) => {
  const settings = aRsvpSettings()
  return aRsvpSettings({ form: { ...settings.form, capacity } })
}

const render = (settings = aRsvpSettings(), api: Partial<Api> = {}) =>
  renderWithProviders(<Harness />, {
    api: fakeApi({ rsvpForm: vi.fn(async () => ({ rsvpForm: settings })), ...api }),
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('limited places', () => {
  it('opens the field first and sends the number when the field is left', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: limited(40) }))
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('checkbox', { name: t.capacityLabel }))
    expect(saveRsvpForm).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(t.capacityField), '40')
    await user.tab()

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { form: { capacity: 40 } })
  })

  it('never sends a text that is not a number as null, which would lift the limit', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: limited(null) }))
    render(limited(40), { saveRsvpForm })

    const field = await screen.findByLabelText(t.capacityField)
    await user.clear(field)
    await user.type(field, 'beaucoup')
    await user.tab()

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { form: { capacity: 0 } })
  })

  it('sends nothing for an empty field, and nothing for a number left unchanged', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: limited(40) }))
    render(limited(40), { saveRsvpForm })

    const field = await screen.findByLabelText(t.capacityField)
    await user.click(field)
    await user.tab()
    await user.clear(field)
    await user.tab()
    // The save is debounced: wait past it before saying nothing was sent.
    await new Promise((resolve) => setTimeout(resolve, SAVE_DEBOUNCE_MS + 200))

    expect(saveRsvpForm).not.toHaveBeenCalled()
  })

  it('lifts the limit with the switch, in one request', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: limited(null) }))
    render(limited(40), { saveRsvpForm })

    await user.click(await screen.findByRole('checkbox', { name: t.capacityLabel }))

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { form: { capacity: null } })
    expect(screen.queryByLabelText(t.capacityField)).not.toBeInTheDocument()
  })

  it('closes the field without any request when the host changes their mind before typing', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: limited(null) }))
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('checkbox', { name: t.capacityLabel }))
    await user.click(screen.getByRole('checkbox', { name: t.capacityLabel }))

    expect(screen.queryByLabelText(t.capacityField)).not.toBeInTheDocument()
    expect(saveRsvpForm).not.toHaveBeenCalled()
  })
})
