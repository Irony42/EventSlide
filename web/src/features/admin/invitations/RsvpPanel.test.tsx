import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import { aRsvpSettings, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { RsvpPanel } from './RsvpPanel'
import { useRsvpSettings } from './useRsvpSettings'

const t = fr.rsvp.host
const plain = (sentence: string): string => sentence.replaceAll(' ', ' ')

function Harness({ archived = false, when = 0 }: { archived?: boolean; when?: number }) {
  const rsvp = useRsvpSettings('mariage', when)
  return <RsvpPanel rsvp={rsvp} archived={archived} />
}

const render = (api: Partial<Api> = {}, props: { archived?: boolean } = {}) =>
  renderWithProviders(<Harness {...props} />, { api: fakeApi(api) })

const answering = (overrides = {}) => ({
  rsvpForm: vi.fn(async () => ({ rsvpForm: aRsvpSettings(overrides) })),
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the replies settings panel: reading', () => {
  it('waits for the first answer, then shows the switch, the badge and what is asked', async () => {
    render(answering())

    expect(await screen.findByRole('heading', { name: new RegExp(t.title) })).toBeInTheDocument()
    expect(screen.getByText(t.stateOff)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: t.askLabel })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Peut-être/ })).toBeChecked()
  })

  it('says the replies are asked, and when they close and when they are erased, as the server says it', async () => {
    render(
      answering({
        enabled: true,
        state: 'open',
        closesAt: '2026-12-12T18:00:00.000Z',
        erasedAt: '2027-01-11T18:00:00.000Z',
      }),
    )

    expect(await screen.findByText(t.stateOpen)).toBeInTheDocument()
    expect(screen.getByText(t.closesOn('12 décembre 2026'))).toBeInTheDocument()
    expect(screen.getByText(t.erasedOn('11 janvier 2027'))).toBeInTheDocument()
  })

  it('says the load failed, with a way to try again', async () => {
    const rsvpForm = vi.fn().mockRejectedValueOnce(ApiError.network()).mockResolvedValue({
      rsvpForm: aRsvpSettings(),
    })
    const user = userEvent.setup()
    render({ rsvpForm })

    expect(await screen.findByRole('alert')).toHaveTextContent(t.loadFailed)
    await user.click(screen.getByRole('button', { name: t.retry }))

    expect(await screen.findByRole('checkbox', { name: t.askLabel })).toBeInTheDocument()
  })

  it('asks nothing until the invitation exists, and says why', async () => {
    render(answering({ invited: false, state: null, closesAt: null }))

    expect(await screen.findByText(t.needsInvite)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: t.askLabel })).toBeDisabled()
    expect(screen.queryByRole('button', { name: t.closeAction })).not.toBeInTheDocument()
  })

  it('is read-only on an archived event', async () => {
    render(answering({ enabled: true, state: 'open' }), { archived: true })

    expect(await screen.findByText(plain(t.archived))).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: t.askLabel })).toBeDisabled()
    expect(screen.getByRole('button', { name: t.closeAction })).toBeDisabled()
  })
})

describe('the replies settings panel: choosing', () => {
  it('saves a choice after a moment, sending only what changed, and says so', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({
      rsvpForm: aRsvpSettings({ enabled: true, state: 'open' }),
    }))
    render({ ...answering(), saveRsvpForm })
    await user.click(await screen.findByRole('checkbox', { name: t.askLabel }))

    expect(screen.getByRole('checkbox', { name: t.askLabel })).toBeChecked()
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { enabled: true })
    expect(await screen.findByText(t.saved)).toBeInTheDocument()
    expect(await screen.findByText(t.stateOpen)).toBeInTheDocument()
  })

  it('sends a burst of choices as one request, the last choice of a field winning', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render({ ...answering(), saveRsvpForm })

    await user.click(await screen.findByRole('checkbox', { name: /Peut-être/ }))
    await user.click(screen.getByRole('checkbox', { name: t.dietLabel }))
    await user.click(screen.getByRole('checkbox', { name: /Peut-être/ }))
    await user.selectOptions(screen.getByLabelText(`${t.sizeMax} ${t.sizeUnit}`), '6')
    await user.click(screen.getByRole('checkbox', { name: t.kidsLabel }))

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: { maybe: true, diet: false, partySize: { max: 6 }, kidsSeparate: false },
    })
  })

  it('sets and clears the deadline', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async (_slug: string, input: { deadline?: string | null }) => ({
      rsvpForm: aRsvpSettings({ deadline: input.deadline ?? null }),
    }))
    render({ ...answering(), saveRsvpForm })
    const field = await screen.findByLabelText(new RegExp(t.deadlineLabel))

    fireEvent.change(field, { target: { value: '2026-12-01' } })
    await waitFor(() =>
      expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', { deadline: '2026-12-01' }),
    )
    await user.click(screen.getByRole('button', { name: t.deadlineClear }))

    await waitFor(() =>
      expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', { deadline: null }),
    )
    expect(field).toHaveValue('')
  })

  it('applies the preset of a wedding: no "peut-être", six people', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render({ ...answering(), saveRsvpForm })

    await user.selectOptions(await screen.findByLabelText(new RegExp(t.presetLabel)), 'wedding')

    expect(screen.getByRole('checkbox', { name: /Peut-être/ })).not.toBeChecked()
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalled())
    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', {
      form: { maybe: false, partySize: { enabled: true, max: 6 } },
    })
  })

  it('names the kind of party the settings look like, and "sur mesure" once the host went their own way', async () => {
    const user = userEvent.setup()
    render({ ...answering(), saveRsvpForm: vi.fn(async () => ({ rsvpForm: aRsvpSettings() })) })
    const preset = await screen.findByLabelText(new RegExp(t.presetLabel))
    expect(preset).toHaveValue('party')

    await user.click(screen.getByRole('checkbox', { name: /Peut-être/ }))
    await user.click(screen.getByRole('checkbox', { name: t.dietLabel }))
    await user.selectOptions(screen.getByLabelText(`${t.sizeMax} ${t.sizeUnit}`), '10')

    expect(preset).toHaveValue('custom')
  })

  it('hides the size and the children when the number of people is not asked', async () => {
    const user = userEvent.setup()
    render({ ...answering(), saveRsvpForm: vi.fn(async () => ({ rsvpForm: aRsvpSettings() })) })
    await user.click(await screen.findByRole('checkbox', { name: t.sizeLabel }))

    expect(screen.queryByRole('checkbox', { name: t.kidsLabel })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(`${t.sizeMax} ${t.sizeUnit}`)).not.toBeInTheDocument()
  })

  it('offers the size the server holds even when it is not one of the usual ones', async () => {
    render(
      answering({
        form: { ...aRsvpSettings().form, partySize: { enabled: true, max: 7 } },
      }),
    )

    expect(await screen.findByLabelText(`${t.sizeMax} ${t.sizeUnit}`)).toHaveValue('7')
  })

  it('puts a refused choice back to what the server holds, with the sentence of its code', async () => {
    const saveRsvpForm = vi.fn().mockRejectedValue(new ApiError(400, 'rsvp.deadlineAfterStart'))
    render({ ...answering(), saveRsvpForm })
    fireEvent.change(await screen.findByLabelText(new RegExp(t.deadlineLabel)), {
      target: { value: '2027-01-01' },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['rsvp.deadlineAfterStart'])
    await waitFor(() => expect(screen.getByLabelText(new RegExp(t.deadlineLabel))).toHaveValue(''))
  })

  it('sends what was chosen while a request was on its way, once it answers', async () => {
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const saveRsvpForm = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ rsvpForm: aRsvpSettings({ enabled: true }) })
          }),
      )
      .mockResolvedValue({ rsvpForm: aRsvpSettings({ enabled: true }) })
    render({ ...answering(), saveRsvpForm })
    await user.click(await screen.findByRole('checkbox', { name: t.askLabel }))
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('checkbox', { name: t.dietLabel }))
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(saveRsvpForm).toHaveBeenCalledTimes(1)
    release()

    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(2))
    expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', { form: { diet: false } })
  })

  it('sends what is waiting when the page is left', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    const { unmount } = render({ ...answering(), saveRsvpForm })
    await user.click(await screen.findByRole('checkbox', { name: t.askLabel }))

    unmount()

    expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { enabled: true })
  })
})

describe('the replies settings panel: closing by hand', () => {
  it('closes the replies, then reopens them, with what the server answers', async () => {
    const user = userEvent.setup()
    const closeRsvps = vi.fn(async () => ({
      rsvpForm: aRsvpSettings({
        enabled: true,
        state: 'closed',
        closedAt: '2026-11-23T10:00:00.000Z',
      }),
    }))
    const reopenRsvps = vi.fn(async () => ({
      rsvpForm: aRsvpSettings({ enabled: true, state: 'open' }),
    }))
    render({ ...answering({ enabled: true, state: 'open' }), closeRsvps, reopenRsvps })

    await user.click(await screen.findByRole('button', { name: t.closeAction }))
    expect(await screen.findByText(plain(t.closedNote))).toBeInTheDocument()
    expect(screen.getByText(t.stateClosed)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.reopenAction }))

    expect(await screen.findByText(t.stateOpen)).toBeInTheDocument()
    expect(closeRsvps).toHaveBeenCalledWith('mariage')
    expect(reopenRsvps).toHaveBeenCalledWith('mariage')
  })

  it('does not offer to close what the deadline already closed', async () => {
    render(answering({ enabled: true, state: 'closed', closedAt: null }))

    expect(await screen.findByRole('button', { name: t.closeAction })).toBeDisabled()
  })

  it('says why the act failed', async () => {
    const user = userEvent.setup()
    render({
      ...answering({ enabled: true, state: 'open' }),
      closeRsvps: vi.fn().mockRejectedValue(new ApiError(409, 'rsvp.inviteRequired')),
    })

    await user.click(await screen.findByRole('button', { name: t.closeAction }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['rsvp.inviteRequired'])
  })

  it('sends a choice that is waiting before the act, so the act answers an up-to-date page', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const saveRsvpForm = vi.fn(async () => {
      order.push('save')
      return { rsvpForm: aRsvpSettings({ enabled: true, state: 'open' }) }
    })
    const closeRsvps = vi.fn(async () => {
      order.push('close')
      return {
        rsvpForm: aRsvpSettings({
          enabled: true,
          state: 'closed',
          closedAt: '2026-11-23T10:00:00.000Z',
        }),
      }
    })
    render({ ...answering({ enabled: true, state: 'open' }), saveRsvpForm, closeRsvps })

    await user.click(await screen.findByRole('checkbox', { name: t.dietLabel }))
    await user.click(screen.getByRole('button', { name: t.closeAction }))

    await waitFor(() => expect(closeRsvps).toHaveBeenCalled())
    expect(order).toEqual(['save', 'close'])
  })
})
