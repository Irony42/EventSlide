import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { deferred } from '../../testing/deferred'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { MailPreferencesSection } from './MailPreferencesSection'

const t = fr.auth.mailPreferences

const render = (overrides: Parameters<typeof fakeApi>[0] = {}) => {
  const api = fakeApi(overrides)
  renderWithProviders(<MailPreferencesSection />, { api })
  return api
}

describe('MailPreferencesSection', () => {
  it('shows the two switches as the account holds them, and the sentence of what is always sent', async () => {
    render({
      mailPreferences: vi.fn(async () => ({ rsvp: true, event: false, available: true })),
    })

    expect(await screen.findByRole('heading', { name: t.title })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: t.eventLabel })).not.toBeChecked()
    expect(screen.getByText(t.always)).toBeVisible()
    expect(screen.getByRole('region', { name: t.title })).toBeVisible()
  })

  it('offers nothing on a box that writes to nobody', async () => {
    const api = render({
      mailPreferences: vi.fn(async () => ({ rsvp: true, event: true, available: false })),
    })

    await waitFor(() => expect(api.mailPreferences).toHaveBeenCalled())

    expect(screen.queryByRole('heading', { name: t.title })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('offers nothing until the answer is known, nor when it cannot be read', async () => {
    render({ mailPreferences: vi.fn(() => new Promise<never>(() => {})) })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('saves one family at once, and only that family', async () => {
    const api = render()
    const box = await screen.findByRole('checkbox', { name: t.eventLabel })

    await userEvent.click(box)

    await waitFor(() => expect(api.setMailPreferences).toHaveBeenCalledWith({ event: false }))
    expect(api.setMailPreferences).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('checkbox', { name: t.eventLabel })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).toBeChecked()
  })

  it('groups the two switches under a legend', async () => {
    render()

    const group = await screen.findByRole('group', { name: t.legend })

    expect(within(group).getAllByRole('checkbox')).toHaveLength(2)
  })

  it('shows the choice at once and says it is saving, then says nothing and is not busy', async () => {
    const pending = deferred<void>()
    render({ setMailPreferences: vi.fn(() => pending.promise) })
    const region = await screen.findByRole('region', { name: t.title })
    expect(region).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    await userEvent.click(screen.getByRole('checkbox', { name: t.rsvpLabel }))

    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).not.toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent(t.saving)
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).toBeEnabled()

    pending.resolve()
    await waitFor(() => expect(region).toHaveAttribute('aria-busy', 'false'))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).not.toBeChecked()
  })

  it('does not lose the other switch pressed while the first one saves, and waits on a second press of the same one', async () => {
    const pending = deferred<void>()
    const setMailPreferences = vi.fn(() => pending.promise)
    render({ setMailPreferences })
    await screen.findByRole('checkbox', { name: t.rsvpLabel })

    await userEvent.click(screen.getByRole('checkbox', { name: t.rsvpLabel }))
    await userEvent.click(screen.getByRole('checkbox', { name: t.eventLabel }))
    await userEvent.click(screen.getByRole('checkbox', { name: t.rsvpLabel }))

    expect(setMailPreferences.mock.calls).toEqual([[{ rsvp: false }], [{ event: false }]])
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: t.eventLabel })).not.toBeChecked()
    pending.resolve()
  })

  it('puts the box back and says so next to it when a write fails, keeps the notice while the other switch succeeds, and clears it when that switch is tried again', async () => {
    const setMailPreferences = vi
      .fn<(patch: { rsvp?: boolean; event?: boolean }) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(500, 'server.error'))
      .mockResolvedValue(undefined)
    render({ setMailPreferences })
    await screen.findByRole('checkbox', { name: t.rsvpLabel })

    await userEvent.click(screen.getByRole('checkbox', { name: t.rsvpLabel }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t.failed)
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).toHaveAccessibleDescription(
      new RegExp(t.failed),
    )
    expect(screen.getByRole('checkbox', { name: t.eventLabel })).not.toHaveAccessibleDescription(
      new RegExp(t.failed),
    )

    await userEvent.click(screen.getByRole('checkbox', { name: t.eventLabel }))
    await waitFor(() => expect(setMailPreferences).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('alert')).toHaveTextContent(t.failed)

    await userEvent.click(screen.getByRole('checkbox', { name: t.rsvpLabel }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).not.toBeChecked()
  })

  it('says the choices could not be read, instead of hiding the section, and reads again on request', async () => {
    const mailPreferences = vi
      .fn<() => Promise<{ rsvp: boolean; event: boolean; available: boolean }>>()
      .mockRejectedValueOnce(new ApiError(500, 'server.error'))
      .mockResolvedValue({ rsvp: true, event: true, available: true })
    render({ mailPreferences })

    expect(await screen.findByRole('alert')).toHaveTextContent(t.loadFailed)
    expect(screen.queryByRole('checkbox')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: t.retry }))

    expect(await screen.findByRole('checkbox', { name: t.rsvpLabel })).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
