import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import {
  anRsvpStats,
  aRsvpSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
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
  return <RsvpPanel rsvp={rsvp} archived={false} onClose={() => undefined} />
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
    await user.click(await screen.findByRole('button', { name: t.momentRemoveYes }))
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

describe('removing a moment', () => {
  const held = (yes: number, maybe: number) =>
    vi.fn(async () => ({
      rsvpForm: withMoments([BRUNCH, DINNER]),
      rsvps: [],
      unseen: 0,
      stats: anRsvpStats({
        moments: [
          {
            ...BRUNCH,
            yes: { responses: yes, people: yes },
            maybe: { responses: maybe, people: maybe },
          },
          {
            ...DINNER,
            yes: { responses: 0, people: 0 },
            maybe: { responses: 0, people: 0 },
          },
        ],
      }),
    }))

  it('asks first, says how many replies hold the moment and suggests a rename, and removes nothing until confirmed', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: withMoments([DINNER]) }))
    render(withMoments([BRUNCH, DINNER]), { saveRsvpForm, rsvps: held(2, 1) })

    await user.click(await screen.findByRole('button', { name: t.momentRemove('Brunch') }))

    const dialog = await screen.findByRole('dialog', { name: t.momentRemoveTitle('Brunch') })
    expect(await within(dialog).findByText(t.momentRemoveBody(3))).toBeInTheDocument()
    expect(saveRsvpForm).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: fr.app.cancel }))
    expect(saveRsvpForm).not.toHaveBeenCalled()
  })

  it('removes it once confirmed, the others keeping their ids', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: withMoments([DINNER]) }))
    render(withMoments([BRUNCH, DINNER]), { saveRsvpForm, rsvps: held(0, 0) })

    await user.click(await screen.findByRole('button', { name: t.momentRemove('Brunch') }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(t.momentRemoveBody(0))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t.momentRemoveYes }))

    await waitFor(() =>
      expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
        form: { moments: [{ id: DINNER.id, label: 'Dîner' }] },
      }),
    )
  })

  it('still asks, without a count, when the count could not be read', async () => {
    const user = userEvent.setup()
    const rsvps = vi.fn(async () => {
      throw new Error('offline')
    })
    render(withMoments([BRUNCH, DINNER]), { rsvps })

    await user.click(await screen.findByRole('button', { name: t.momentRemove('Brunch') }))

    expect(await screen.findByText(t.momentRemoveUnknown)).toBeInTheDocument()
  })
})
