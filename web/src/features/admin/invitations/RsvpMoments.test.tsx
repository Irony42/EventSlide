import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import { aRsvpSettings, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { RsvpPanel } from './RsvpPanel'
import { useRsvpSettings } from './useRsvpSettings'

/**
 * The moments of the party in the host's settings (spec 30, lot 4): up to four, each saved with its
 * id, a new one named by the server, the label sent when the field is left.
 */

const t = fr.rsvp.host
const BRUNCH = { id: 'aaaaaaaa', label: 'Brunch' }
const DINNER = { id: 'bbbbbbbb', label: 'Dîner' }

function Harness() {
  const rsvp = useRsvpSettings('mariage', 0)
  return <RsvpPanel rsvp={rsvp} archived={false} />
}

const withMoments = (moments: readonly { id: string; label: string }[]) => {
  const settings = aRsvpSettings()
  return aRsvpSettings({ form: { ...settings.form, moments } })
}

const render = (settings = aRsvpSettings(), api: Partial<Api> = {}) =>
  renderWithProviders(<Harness />, {
    api: fakeApi({ rsvpForm: vi.fn(async () => ({ rsvpForm: settings })), ...api }),
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the moments', () => {
  it('adds a moment with no id, to be named by the server', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: withMoments([BRUNCH]) }))
    render(aRsvpSettings(), { saveRsvpForm })

    await user.click(await screen.findByRole('button', { name: t.momentAdd }))
    await user.type(screen.getByPlaceholderText(t.momentPlaceholder), '  Brunch ')
    await user.click(screen.getAllByRole('button', { name: t.momentAdd })[0] as HTMLElement)

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: { moments: [{ label: 'Brunch' }] },
    })
  })

  it('does not add a moment with an empty label', async () => {
    const user = userEvent.setup()
    render()

    await user.click(await screen.findByRole('button', { name: t.momentAdd }))

    expect(screen.getAllByRole('button', { name: t.momentAdd })[0]).toBeDisabled()
  })

  it('renames a moment keeping its id, and removes one, the others keeping theirs', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: withMoments([BRUNCH, DINNER]) }))
    render(withMoments([BRUNCH, DINNER]), { saveRsvpForm })

    const first = await screen.findByLabelText(t.momentLabelLabel(1))
    await user.clear(first)
    await user.type(first, 'Grand brunch')
    await user.tab()
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', {
      form: {
        moments: [
          { id: BRUNCH.id, label: 'Grand brunch' },
          { id: DINNER.id, label: 'Dîner' },
        ],
      },
    })

    await user.click(screen.getByRole('button', { name: t.momentRemove('Brunch') }))
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(2))
    expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', {
      form: { moments: [{ id: DINNER.id, label: 'Dîner' }] },
    })
  })

  it('offers no more once there are four', async () => {
    const four = ['a', 'b', 'c', 'd'].map((label, index) => ({ id: `0000000${index}`, label }))
    render(withMoments(four))

    expect(await screen.findByText(t.momentsFull)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.momentAdd })).not.toBeInTheDocument()
  })
})
