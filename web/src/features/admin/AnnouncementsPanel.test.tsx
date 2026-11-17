import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { AnnouncementsPanel } from './AnnouncementsPanel'

const SLUG = 'camille-et-sacha'

describe('AnnouncementsPanel', () => {
  it('is a card named "Annonces", with the form in it', async () => {
    renderWithProviders(<AnnouncementsPanel slug={SLUG} live opensAt={null} />, { api: fakeApi() })

    expect(await screen.findByRole('heading', { name: fr.announcement.title })).toBeVisible()
    expect(await screen.findByLabelText(fr.announcement.text)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.announcement.schedule })).toBeVisible()
  })

  it('says the server refusal as a toast', async () => {
    const createAnnouncement = vi.fn(async () => {
      throw new ApiError(409, 'announcement.showing')
    })
    renderWithProviders(<AnnouncementsPanel slug={SLUG} live opensAt={null} />, {
      api: fakeApi({ createAnnouncement }),
    })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText(fr.announcement.text), 'Le gâteau arrive')
    await user.click(screen.getByRole('button', { name: fr.announcement.launchNow }))

    expect(await screen.findByText(fr.errors['announcement.showing'])).toBeVisible()
  })

  it('says an event that is not open yet will not show it', async () => {
    const opensAt = new Date(2026, 5, 25, 18, 0).toISOString()
    renderWithProviders(<AnnouncementsPanel slug={SLUG} live={false} opensAt={opensAt} />, {
      api: fakeApi(),
    })

    // A draft may be prepared, and the panel says the wall shows nothing before the doors open.
    expect(await screen.findByText(fr.announcement.notLive)).toBeVisible()
  })
})
