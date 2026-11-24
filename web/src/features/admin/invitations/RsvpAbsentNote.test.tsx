import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import { aRsvpSettings, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { RsvpPanel } from './RsvpPanel'
import { useRsvpSettings } from './useRsvpSettings'

/**
 * The word of those who cannot come, in the host's settings (spec 30, lot 4): one switch, on by
 * default, sent on its own and read back from the server's answer.
 */

const t = fr.rsvp.host

function Harness() {
  const rsvp = useRsvpSettings('mariage', 0)
  return <RsvpPanel rsvp={rsvp} archived={false} />
}

const withNote = (absentNote: boolean) => {
  const settings = aRsvpSettings()
  return aRsvpSettings({ form: { ...settings.form, absentNote } })
}

const render = (settings = aRsvpSettings(), api: Partial<Api> = {}) =>
  renderWithProviders(<Harness />, {
    api: fakeApi({ rsvpForm: vi.fn(async () => ({ rsvpForm: settings })), ...api }),
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the word of those who cannot come', () => {
  it('is on by default, and switching it off sends that and nothing else', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: withNote(false) }))
    render(aRsvpSettings(), { saveRsvpForm })

    const box = await screen.findByRole('checkbox', { name: t.absentNote })
    expect(box).toBeChecked()
    await user.click(box)

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { form: { absentNote: false } })
  })

  it('reads an off switch as off, and switches back on', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: withNote(true) }))
    render(withNote(false), { saveRsvpForm })

    const box = await screen.findByRole('checkbox', { name: t.absentNote })
    expect(box).not.toBeChecked()
    await user.click(box)

    await waitFor(() =>
      expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { form: { absentNote: true } }),
    )
  })

  it('says what it does and what it needs', async () => {
    render()

    expect(await screen.findByText(t.absentNoteHint)).toBeInTheDocument()
  })
})
