import { screen, waitFor } from '@testing-library/react'
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

  it('says it could not, keeps the box where it was, and lets the person try again', async () => {
    const setMailPreferences = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(500, 'server.error'))
      .mockResolvedValue(undefined)
    render({ setMailPreferences })
    const box = await screen.findByRole('checkbox', { name: t.rsvpLabel })

    await userEvent.click(box)

    expect(await screen.findByRole('alert')).toHaveTextContent(t.failed)
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).toBeChecked()

    await userEvent.click(screen.getByRole('checkbox', { name: t.rsvpLabel }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).not.toBeChecked()
  })

  it('is busy while it saves, keeps its boxes enabled, and ignores a second press meanwhile', async () => {
    const pending = deferred<void>()
    const setMailPreferences = vi.fn(() => pending.promise)
    render({ setMailPreferences })
    const box = await screen.findByRole('checkbox', { name: t.rsvpLabel })

    await userEvent.click(box)
    await userEvent.click(screen.getByRole('checkbox', { name: t.eventLabel }))

    expect(setMailPreferences).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: t.title })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('checkbox', { name: t.rsvpLabel })).toBeEnabled()

    pending.resolve()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: t.title })).toHaveAttribute('aria-busy', 'false'),
    )
  })
})
