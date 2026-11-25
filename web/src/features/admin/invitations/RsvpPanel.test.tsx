import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import type { Api } from '../../../lib/api/client'
import { aRsvpSettings, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { RsvpPanel } from './RsvpPanel'
import { useRsvpSettings } from './useRsvpSettings'

const t = fr.rsvp.host
const plain = (sentence: string): string => sentence.replaceAll(' ', ' ')

function Harness({
  archived = false,
  when = 0,
  timeZone = null,
}: {
  archived?: boolean
  when?: number
  timeZone?: string | null
}) {
  const rsvp = useRsvpSettings('mariage', when)
  return <RsvpPanel rsvp={rsvp} archived={archived} timeZone={timeZone} onClose={() => undefined} />
}

const render = (
  api: Partial<Api> = {},
  props: { archived?: boolean; timeZone?: string | null } = {},
) => renderWithProviders(<Harness {...props} />, { api: fakeApi(api) })

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

    expect(await screen.findByText(plain(t.needsInvite))).toBeInTheDocument()
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
    await user.clear(screen.getByLabelText(`${t.sizeMax} ${t.sizeUnit}`))
    await user.type(screen.getByLabelText(`${t.sizeMax} ${t.sizeUnit}`), '6')
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
      form: { maybe: false, partySize: { enabled: true, max: 6 }, companionNames: true },
    })
  })

  it('names the kind of party the settings look like, and "sur mesure" once the host went their own way', async () => {
    const user = userEvent.setup()
    render({ ...answering(), saveRsvpForm: vi.fn(async () => ({ rsvpForm: aRsvpSettings() })) })
    const preset = await screen.findByLabelText(new RegExp(t.presetLabel))
    expect(preset).toHaveValue('party')

    await user.click(screen.getByRole('checkbox', { name: /Peut-être/ }))
    await user.click(screen.getByRole('checkbox', { name: t.dietLabel }))
    await user.clear(screen.getByLabelText(`${t.sizeMax} ${t.sizeUnit}`))
    await user.type(screen.getByLabelText(`${t.sizeMax} ${t.sizeUnit}`), '9')

    expect(preset).toHaveValue('custom')
  })

  it('hides the size and the children when the number of people is not asked', async () => {
    const user = userEvent.setup()
    render({ ...answering(), saveRsvpForm: vi.fn(async () => ({ rsvpForm: aRsvpSettings() })) })
    await user.click(await screen.findByRole('checkbox', { name: t.sizeLabel }))

    expect(screen.queryByRole('checkbox', { name: t.kidsLabel })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(`${t.sizeMax} ${t.sizeUnit}`)).not.toBeInTheDocument()
  })

  it('shows the size the server holds, whatever it is', async () => {
    render(
      answering({
        form: { ...aRsvpSettings().form, partySize: { enabled: true, max: 7 } },
      }),
    )

    expect(await screen.findByLabelText(`${t.sizeMax} ${t.sizeUnit}`)).toHaveValue('7')
  })

  describe('"au plus par réponse", typed', () => {
    const sizeField = () => screen.findByLabelText(`${t.sizeMax} ${t.sizeUnit}`)
    const sizeSaved = () => vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    /** Longer than the autosave's debounce: a value that was going to be sent has been. */
    const pastDebounce = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      })

    it('is a text field with a numeric keypad: the wheel cannot change it', async () => {
      render({ ...answering(), saveRsvpForm: sizeSaved() })
      const field = await sizeField()

      expect(field).toHaveAttribute('type', 'text')
      expect(field).toHaveAttribute('inputmode', 'numeric')
      expect(field).toHaveAttribute('pattern', '[0-9]*')
    })

    it('saves 7, a size the old list did not offer', async () => {
      const user = userEvent.setup()
      const saveRsvpForm = sizeSaved()
      render({ ...answering(), saveRsvpForm })
      const field = await sizeField()

      await user.clear(field)
      await user.type(field, '7')

      await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
      expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { form: { partySize: { max: 7 } } })
    })

    it('sends 10 and 1, the two ends', async () => {
      const user = userEvent.setup()
      const saveRsvpForm = sizeSaved()
      render({ ...answering(), saveRsvpForm })
      const field = await sizeField()

      await user.clear(field)
      await user.type(field, '10')
      await waitFor(() =>
        expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', {
          form: { partySize: { max: 10 } },
        }),
      )
      await user.clear(field)
      await user.type(field, '1')
      await waitFor(() =>
        expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', {
          form: { partySize: { max: 1 } },
        }),
      )
    })

    it.each(['0', '11', '25'])(
      'does not send %s, and puts the saved size back with the range',
      async (typed) => {
        const user = userEvent.setup()
        const saveRsvpForm = sizeSaved()
        render({ ...answering(), saveRsvpForm })
        const field = await sizeField()

        await user.clear(field)
        await user.type(field, typed)
        expect(field).toHaveValue(typed)
        await user.tab()

        expect(field).toHaveValue('4')
        const hint = screen.getByRole('alert', { name: '' })
        expect(hint).toHaveTextContent(t.sizeRange(1, 10))
        expect(field).toHaveAttribute('aria-invalid', 'true')
        expect(field.getAttribute('aria-describedby')).toBe(hint.id)
        await pastDebounce()
        expect(saveRsvpForm).not.toHaveBeenCalled()
      },
    )

    it('does not send an emptied field, and puts the saved size back with the range', async () => {
      const user = userEvent.setup()
      const saveRsvpForm = sizeSaved()
      render({ ...answering(), saveRsvpForm })
      const field = await sizeField()

      await user.clear(field)
      expect(field).toHaveValue('')
      await user.tab()

      expect(field).toHaveValue('4')
      expect(screen.getByRole('alert')).toHaveTextContent(t.sizeRange(1, 10))
      await pastDebounce()
      expect(saveRsvpForm).not.toHaveBeenCalled()
    })

    it('does not send text that is not a number, and puts the saved size back with the range', async () => {
      const user = userEvent.setup()
      const saveRsvpForm = sizeSaved()
      render({ ...answering(), saveRsvpForm })
      const field = await sizeField()

      await user.clear(field)
      await user.type(field, 'abc')
      await user.tab()

      expect(field).toHaveValue('4')
      expect(screen.getByRole('alert')).toHaveTextContent(t.sizeRange(1, 10))
      await pastDebounce()
      expect(saveRsvpForm).not.toHaveBeenCalled()
    })

    it('describes the range as a hint, turns it into an error when the size is not one, and back once it is typed again', async () => {
      const user = userEvent.setup()
      render({ ...answering(), saveRsvpForm: sizeSaved() })
      const field = await sizeField()
      expect(screen.getByText(t.sizeRange(1, 10))).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(field).not.toHaveAttribute('aria-invalid')
      expect(field.getAttribute('aria-describedby')).toBe(screen.getByText(t.sizeRange(1, 10)).id)

      await user.clear(field)
      await user.type(field, '12')
      await user.tab()
      expect(screen.getByRole('alert')).toHaveTextContent(t.sizeRange(1, 10))
      await user.type(field, '5')

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByText(t.sizeRange(1, 10))).toBeInTheDocument()
    })

    it.each(['1.5', '1,5', '1e1', '-3', '+4', 'e', ' 7'])(
      'never sends %j, however it is typed',
      async (typed) => {
        const user = userEvent.setup()
        const saveRsvpForm = sizeSaved()
        render({ ...answering(), saveRsvpForm })
        const field = await sizeField()

        await user.clear(field)
        await user.type(field, typed)
        await user.tab()

        expect(field).toHaveValue('4')
        await pastDebounce()
        expect(saveRsvpForm).not.toHaveBeenCalled()
      },
    )

    it('sends what was typed when the panel is left, at once and once', async () => {
      const user = userEvent.setup()
      const saveRsvpForm = sizeSaved()
      const { unmount } = render({ ...answering(), saveRsvpForm })
      const field = await sizeField()

      await user.clear(field)
      await user.type(field, '9')
      unmount()

      // At once: not behind the pauses of the field and of the autosave.
      expect(saveRsvpForm).toHaveBeenCalledTimes(1)
      expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { form: { partySize: { max: 9 } } })
      await pastDebounce()
      expect(saveRsvpForm).toHaveBeenCalledTimes(1)
    })

    it('puts the size back when the server refuses it', async () => {
      const user = userEvent.setup()
      const saveRsvpForm = vi.fn().mockRejectedValue(new ApiError(400, 'rsvp.partyMaxInvalid'))
      render({ ...answering(), saveRsvpForm })
      const field = await sizeField()

      await user.clear(field)
      await user.type(field, '7')

      await waitFor(() => expect(saveRsvpForm).toHaveBeenCalled())
      await waitFor(() => expect(field).toHaveValue('4'))
    })

    it('still applies a preset over a typed size', async () => {
      const user = userEvent.setup()
      const saveRsvpForm = sizeSaved()
      render({ ...answering(), saveRsvpForm })
      const field = await sizeField()
      await user.clear(field)
      await user.type(field, '7')
      await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))

      await user.selectOptions(screen.getByLabelText(new RegExp(t.presetLabel)), 'wedding')

      expect(field).toHaveValue('6')
      await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(2))
      expect(saveRsvpForm).toHaveBeenLastCalledWith('mariage', {
        form: { maybe: false, partySize: { enabled: true, max: 6 }, companionNames: true },
      })
    })

    it('is read-only for an archived event', async () => {
      render({ ...answering(), saveRsvpForm: sizeSaved() }, { archived: true })

      expect(await sizeField()).toBeDisabled()
    })
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

  it('says a window closed by its deadline reopens by moving the deadline, with no button', async () => {
    render(
      answering({
        enabled: true,
        state: 'closed',
        closedAt: null,
        deadline: '2026-11-01',
        closesAt: '2026-11-02T00:00:00.000Z',
      }),
    )

    expect(await screen.findByText(plain(t.closedByDate))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.closeAction })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.reopenAction })).not.toBeInTheDocument()
  })

  it('offers to reopen what the host closed while the deadline is still ahead', async () => {
    render(
      answering({
        enabled: true,
        state: 'closed',
        closedAt: '2026-11-23T10:00:00.000Z',
        deadline: '2099-01-01',
        closesAt: '2099-01-02T00:00:00.000Z',
      }),
    )

    expect(await screen.findByRole('button', { name: t.reopenAction })).toBeEnabled()
    expect(screen.queryByText(plain(t.reopenNeedsDate))).not.toBeInTheDocument()
  })

  it('does not offer to reopen what is closed by hand and by a deadline gone by: the date must move', async () => {
    render(
      answering({
        enabled: true,
        state: 'closed',
        closedAt: '2026-10-30T10:00:00.000Z',
        deadline: '2026-11-01',
        closesAt: '2026-11-02T00:00:00.000Z',
      }),
    )

    expect(await screen.findByText(plain(t.reopenNeedsDate))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.reopenAction })).not.toBeInTheDocument()
  })

  it('has its own badge for a full party, which can still be closed', async () => {
    render(answering({ enabled: true, state: 'full' }))

    expect(await screen.findByText(t.stateFull)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.closeAction })).toBeEnabled()
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

describe('the replies settings panel: acts and saves in flight', () => {
  const closed = aRsvpSettings({
    enabled: true,
    state: 'closed',
    closedAt: '2026-11-23T10:00:00.000Z',
  })

  /** A save that answers when told to, with what the server held before the closing. */
  const gate = () => {
    let release: () => void = () => undefined
    const answer = new Promise<void>((resolve) => {
      release = resolve
    })
    return { release: () => release(), answer }
  }

  it('waits for the save on its way, then sends the act, and the stale answer does not reopen the screen', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const slow = gate()
    const saveRsvpForm = vi.fn(async () => {
      order.push('save')
      await slow.answer
      return { rsvpForm: aRsvpSettings({ enabled: true, state: 'open' }) }
    })
    const closeRsvps = vi.fn(async () => {
      order.push('close')
      return { rsvpForm: closed }
    })
    render({ ...answering({ enabled: true, state: 'open' }), saveRsvpForm, closeRsvps })
    await user.click(await screen.findByRole('checkbox', { name: t.dietLabel }))
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: t.closeAction }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(closeRsvps).not.toHaveBeenCalled()
    slow.release()

    await waitFor(() => expect(closeRsvps).toHaveBeenCalledTimes(1))
    expect(order).toEqual(['save', 'close'])
    expect(await screen.findByText(t.stateClosed)).toBeInTheDocument()
  })

  it('sends what was chosen while the save flew, before the act', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const slow = gate()
    const saveRsvpForm = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push('save 1')
        await slow.answer
        return { rsvpForm: aRsvpSettings({ enabled: true, state: 'open' }) }
      })
      .mockImplementation(async () => {
        order.push('save 2')
        return { rsvpForm: aRsvpSettings({ enabled: true, state: 'open' }) }
      })
    const closeRsvps = vi.fn(async () => {
      order.push('close')
      return { rsvpForm: closed }
    })
    render({ ...answering({ enabled: true, state: 'open' }), saveRsvpForm, closeRsvps })
    await user.click(await screen.findByRole('checkbox', { name: t.dietLabel }))
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('checkbox', { name: /Peut-être/ }))

    await user.click(screen.getByRole('button', { name: t.closeAction }))
    slow.release()

    await waitFor(() => expect(closeRsvps).toHaveBeenCalledTimes(1))
    expect(order).toEqual(['save 1', 'save 2', 'close'])
  })

  it('does not send the act, and keeps the sentence, when a choice before it was refused', async () => {
    const user = userEvent.setup()
    const closeRsvps = vi.fn(async () => ({ rsvpForm: closed }))
    const saveRsvpForm = vi.fn().mockRejectedValue(new ApiError(400, 'rsvp.deadlineAfterStart'))
    render({ ...answering({ enabled: true, state: 'open' }), saveRsvpForm, closeRsvps })
    await user.click(await screen.findByRole('checkbox', { name: t.dietLabel }))

    await user.click(screen.getByRole('button', { name: t.closeAction }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['rsvp.deadlineAfterStart'])
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(closeRsvps).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('does not say "Enregistré" beside a refusal, and says it again once a send goes through', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(400, 'rsvp.deadlineAfterStart'))
      .mockResolvedValue({
        rsvpForm: aRsvpSettings({ form: { ...aRsvpSettings().form, diet: false } }),
      })
    render({ ...answering(), saveRsvpForm })
    await user.click(await screen.findByRole('checkbox', { name: t.dietLabel }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(t.saved)).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: t.dietLabel }))

    expect(await screen.findByText(t.saved)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the replies settings panel: answers out of order', () => {
  it('keeps the answer of the request sent last when an older one lands after it', async () => {
    const user = userEvent.setup()
    const slow = (() => {
      let release: () => void = () => undefined
      const answer = new Promise<void>((resolve) => {
        release = resolve
      })
      return { release: () => release(), answer }
    })()
    const closeRsvps = vi.fn(async () => {
      await slow.answer
      return {
        rsvpForm: aRsvpSettings({
          enabled: true,
          state: 'closed',
          closedAt: '2026-11-23T10:00:00.000Z',
        }),
      }
    })
    const saveRsvpForm = vi.fn(async () => ({
      rsvpForm: aRsvpSettings({ enabled: true, state: 'full' }),
    }))
    render({ ...answering({ enabled: true, state: 'open' }), saveRsvpForm, closeRsvps })

    await user.click(await screen.findByRole('button', { name: t.closeAction }))
    await waitFor(() => expect(closeRsvps).toHaveBeenCalled())
    await user.click(screen.getByRole('checkbox', { name: t.dietLabel }))
    expect(await screen.findByText(t.stateFull)).toBeInTheDocument()
    slow.release()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(screen.getByText(t.stateFull)).toBeInTheDocument()
    expect(screen.queryByText(t.stateClosed)).not.toBeInTheDocument()
  })

  it('does not say "Enregistré" once the act that followed a save was refused', async () => {
    const user = userEvent.setup()
    render({
      ...answering({ enabled: true, state: 'open' }),
      saveRsvpForm: vi.fn(async () => ({
        rsvpForm: aRsvpSettings({ enabled: true, state: 'open' }),
      })),
      closeRsvps: vi.fn().mockRejectedValue(new ApiError(409, 'rsvp.inviteRequired')),
    })
    await user.click(await screen.findByRole('checkbox', { name: t.dietLabel }))
    expect(await screen.findByText(t.saved)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: t.closeAction }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(t.saved)).not.toBeInTheDocument()
  })
})

describe('the replies settings panel: the deadline field', () => {
  it('sends nothing while a date is half typed, and a real day once it is one', async () => {
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render({ ...answering(), saveRsvpForm })
    const field = await screen.findByLabelText(new RegExp(t.deadlineLabel))

    fireEvent.change(field, { target: { value: '0020-12-01' } })
    fireEvent.change(field, { target: { value: '' } })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(saveRsvpForm).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: '2099-12-01' } })
    await waitFor(() =>
      expect(saveRsvpForm).toHaveBeenCalledWith('mariage', { deadline: '2099-12-01' }),
    )
  })
})

describe('the replies settings panel: the party’s days', () => {
  it('reads the closing and the erasure in the invitation’s zone, not the browser’s', async () => {
    // 23:30 in Paris on the 12th is 08:30 the next morning in Tokyo.
    render(
      answering({
        enabled: true,
        state: 'open',
        closesAt: '2026-12-12T22:30:00.000Z',
        erasedAt: '2027-01-11T22:30:00.000Z',
      }),
      { timeZone: 'Asia/Tokyo' },
    )

    expect(await screen.findByText(t.closesOn('13 décembre 2026'))).toBeInTheDocument()
    expect(screen.getByText(t.erasedOn('12 janvier 2027'))).toBeInTheDocument()
  })

  it('says the last day is the deadline itself', async () => {
    render(
      answering({
        enabled: true,
        state: 'open',
        deadline: '2099-12-01',
        closesAt: '2099-12-02T00:00:00.000Z',
      }),
    )

    expect(await screen.findByText(t.openUntil('1 décembre 2099'))).toBeInTheDocument()
  })
})

describe('the replies settings panel: the preset', () => {
  it('applies a preset at once while the choices still are one', async () => {
    const user = userEvent.setup()
    const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    render({ ...answering(), saveRsvpForm })

    await user.selectOptions(await screen.findByLabelText(t.presetLabel), 'wedding')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
  })

  describe('once the host went their own way', () => {
    const custom = () => ({
      rsvpForm: vi.fn(async () => ({
        rsvpForm: aRsvpSettings({ form: { ...aRsvpSettings().form, diet: false, maybe: false } }),
      })),
    })

    it('asks before replacing, and replaces on yes', async () => {
      const user = userEvent.setup()
      const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
      render({ ...custom(), saveRsvpForm })

      await user.selectOptions(await screen.findByLabelText(t.presetLabel), 'party')
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent(plain(t.presetConfirm(t.presetKindParty)))
      expect(saveRsvpForm).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: t.presetConfirmYes }))

      await waitFor(() => expect(saveRsvpForm).toHaveBeenCalledTimes(1))
    })

    it('keeps the choices on no', async () => {
      const user = userEvent.setup()
      const saveRsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
      render({ ...custom(), saveRsvpForm })

      await user.selectOptions(await screen.findByLabelText(t.presetLabel), 'wedding')
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: fr.app.cancel }),
      )
      await new Promise((resolve) => setTimeout(resolve, 600))

      expect(saveRsvpForm).not.toHaveBeenCalled()
    })
  })
})

describe('the replies settings panel: reading again', () => {
  it('reads the settings again when what they hang on changes', async () => {
    const user = userEvent.setup()
    const rsvpForm = vi.fn(async () => ({ rsvpForm: aRsvpSettings() }))
    function Moving() {
      const [when, setWhen] = useState('a')
      return (
        <>
          <button onClick={() => setWhen('b')}>move</button>
          <Harness when={when as unknown as number} />
        </>
      )
    }
    renderWithProviders(<Moving />, { api: fakeApi({ rsvpForm }) })
    await screen.findByRole('checkbox', { name: t.askLabel })

    await user.click(screen.getByRole('button', { name: 'move' }))

    await waitFor(() => expect(rsvpForm).toHaveBeenCalledTimes(2))
  })
})

describe('the replies settings panel: a clock that moves', () => {
  it('stops offering to reopen once the deadline goes by while the page is open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    try {
      vi.setSystemTime(new Date('2026-11-23T10:00:00.000Z'))
      render(
        answering({
          enabled: true,
          state: 'closed',
          closedAt: '2026-11-22T10:00:00.000Z',
          closesAt: '2026-11-23T12:00:00.000Z',
        }),
      )
      expect(await screen.findByRole('button', { name: t.reopenAction })).toBeInTheDocument()

      await act(async () => {
        vi.setSystemTime(new Date('2026-11-23T12:30:00.000Z'))
        await vi.advanceTimersByTimeAsync(60_000)
      })

      expect(screen.queryByRole('button', { name: t.reopenAction })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
